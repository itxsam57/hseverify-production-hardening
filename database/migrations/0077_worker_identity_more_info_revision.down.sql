-- Refuse rollback once revision history exists; never discard submitted identity evidence.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM worker_identity_versions WHERE version_kind='initial' AND version_number>1) THEN
    RAISE EXCEPTION 'Cannot roll back additional-information revisions while history exists.';
  END IF;
END $$;
ALTER TABLE worker_identity_versions DROP CONSTRAINT worker_identity_versions_lineage_shape;
ALTER TABLE worker_identity_versions ADD CONSTRAINT worker_identity_versions_lineage_shape CHECK (
  (version_number=1 AND version_kind='initial' AND parent_version_id IS NULL) OR
  (version_number>1 AND version_kind='correction' AND parent_version_id IS NOT NULL)
);

CREATE OR REPLACE FUNCTION worker_identity_transition_allowed(
  old_status TEXT,
  new_status TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE old_status
    WHEN 'draft' THEN new_status IN ('submitted')
    WHEN 'submitted' THEN new_status IN ('automated_checks', 'withdrawn')
    WHEN 'automated_checks' THEN new_status IN ('manual_review', 'more_info', 'rejected')
    WHEN 'manual_review' THEN new_status IN ('verified', 'more_info', 'rejected', 'escalated')
    WHEN 'more_info' THEN new_status IN ('manual_review')
    WHEN 'verified' THEN new_status IN ('correction_pending', 'expired_document', 'suspended')
    WHEN 'correction_pending' THEN new_status IN ('verified')
    WHEN 'suspended' THEN new_status IN ('verified', 'reinstated', 'closed')
    ELSE FALSE
  END;
$$;

CREATE OR REPLACE FUNCTION worker_identity_version_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  identity_owner_account_id TEXT;
  identity_status TEXT;
  identity_current_version INTEGER;
  parent_identity_id TEXT;
  parent_version_number INTEGER;
  parent_version_status TEXT;
  latest_version_number INTEGER;
BEGIN
  SELECT worker_account_id, lifecycle_status, current_version_number
  INTO identity_owner_account_id, identity_status, identity_current_version
  FROM worker_identities
  WHERE identity_id = NEW.identity_id;

  IF identity_owner_account_id IS NULL OR
     NEW.created_by_account_id IS DISTINCT FROM identity_owner_account_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Worker identity version creator must own the identity.';
  END IF;

  IF NEW.version_number = 1 THEN
    IF identity_status <> 'draft' OR identity_current_version <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Initial Worker identity version can only be created for a new draft identity.';
    END IF;
    RETURN NEW;
  END IF;

  SELECT COALESCE(MAX(version_number), 0)
  INTO latest_version_number
  FROM worker_identity_versions
  WHERE identity_id = NEW.identity_id;

  IF NEW.version_kind <> 'correction' OR
     NEW.version_status <> 'draft' OR
     NEW.submitted_at IS NOT NULL OR
     identity_status <> 'verified' OR
     NEW.version_number <> latest_version_number + 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Worker identity correction lineage is invalid.';
  END IF;

  SELECT identity_id, version_number, version_status
  INTO parent_identity_id, parent_version_number, parent_version_status
  FROM worker_identity_versions
  WHERE identity_version_id = NEW.parent_version_id;

  IF parent_identity_id IS NULL OR
     parent_identity_id <> NEW.identity_id OR
     parent_version_number <> identity_current_version OR
     parent_version_status <> 'submitted' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Worker identity correction parent must be the current verified submitted version.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION worker_identity_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_current_version_id TEXT;
BEGIN
  IF NEW.identity_id IS DISTINCT FROM OLD.identity_id OR
     NEW.worker_account_id IS DISTINCT FROM OLD.worker_account_id OR
     NEW.schema_version IS DISTINCT FROM OLD.schema_version OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Worker identity ownership and creation provenance are immutable.';
  END IF;

  IF NEW.lock_version <> OLD.lock_version + 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'Worker identity optimistic lock version is invalid.';
  END IF;

  IF NOT worker_identity_transition_allowed(
    OLD.lifecycle_status,
    NEW.lifecycle_status
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Worker identity lifecycle transition is invalid.';
  END IF;

  -- Returning from correction_pending to verified is valid only when the exact
  -- current correction has been submitted and has one immutable decision. An
  -- accepted correction keeps the correction version current; a rejected one
  -- restores its recorded parent. This closes direct-SQL lifecycle bypasses.
  IF OLD.lifecycle_status = 'correction_pending' AND
     NEW.lifecycle_status = 'verified' THEN
    SELECT versions.identity_version_id
    INTO old_current_version_id
    FROM worker_identity_versions AS versions
    WHERE versions.identity_id = OLD.identity_id
      AND versions.version_number = OLD.current_version_number;

    IF old_current_version_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM worker_identity_correction_requests AS requests
      JOIN worker_identity_correction_decisions AS decisions
        ON decisions.correction_request_id = requests.correction_request_id
      JOIN worker_identity_versions AS correction
        ON correction.identity_version_id = requests.correction_version_id
       AND correction.identity_id = OLD.identity_id
       AND correction.version_number = OLD.current_version_number
       AND correction.version_status = 'submitted'
      JOIN worker_identity_versions AS parent
        ON parent.identity_version_id = requests.parent_version_id
       AND parent.identity_id = OLD.identity_id
       AND parent.version_status = 'submitted'
      WHERE requests.identity_id = OLD.identity_id
        AND requests.worker_account_id = OLD.worker_account_id
        AND requests.correction_version_id = old_current_version_id
        AND (
          (decisions.decision = 'accepted' AND
           NEW.current_version_number = OLD.current_version_number) OR
          (decisions.decision = 'rejected' AND
           NEW.current_version_number = parent.version_number)
        )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'Worker identity correction decision does not authorize verification.';
    END IF;
  END IF;

  IF NEW.current_version_number IS DISTINCT FROM OLD.current_version_number THEN
    IF OLD.lifecycle_status = 'verified' AND
       NEW.lifecycle_status = 'correction_pending' AND
       EXISTS (
         SELECT 1
         FROM worker_identity_versions AS correction
         JOIN worker_identity_correction_requests AS requests
           ON requests.correction_version_id = correction.identity_version_id
          AND requests.identity_id = OLD.identity_id
          AND requests.worker_account_id = OLD.worker_account_id
         JOIN worker_identity_versions AS parent
           ON parent.identity_version_id = requests.parent_version_id
         WHERE correction.identity_id = OLD.identity_id
           AND correction.version_number = NEW.current_version_number
           AND correction.version_kind = 'correction'
           AND correction.version_status = 'draft'
           AND parent.identity_id = OLD.identity_id
           AND parent.version_number = OLD.current_version_number
           AND parent.version_status = 'submitted'
       ) THEN
      NULL;
    ELSIF OLD.lifecycle_status = 'correction_pending' AND
          NEW.lifecycle_status = 'verified' THEN
      -- Exact accepted/rejected pointer semantics were validated above.
      NULL;
    ELSE
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'Worker identity current-version movement is invalid.';
    END IF;
  END IF;

  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
