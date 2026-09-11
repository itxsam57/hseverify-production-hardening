-- M1.07 Subunit 6: Correction Versions, Worker Identity UX and Cumulative Acceptance.
-- Corrections are new version lineage. Accepted submitted identity versions and evidence
-- are never rewritten or deleted. Reviewer-facing queues remain outside this brick.

ALTER TABLE platform_audit_events
  DROP CONSTRAINT IF EXISTS platform_audit_events_action_key_check;
ALTER TABLE platform_audit_events
  ADD CONSTRAINT platform_audit_events_action_key_check CHECK (
    action_key IN (
      'authentication.registration.started',
      'authentication.otp.issued',
      'authentication.otp.failed',
      'authentication.otp.verified',
      'authentication.password.created',
      'authentication.password_reset.requested',
      'authentication.password_reset.completed',
      'authentication.login.failed',
      'authentication.login.succeeded',
      'authentication.logout',
      'authentication.session.revoked',
      'authentication.account.locked',
      'authentication.account.unlocked',
      'authentication.invitation.created',
      'authentication.invitation.accepted',
      'authentication.mfa.enrolled',
      'authentication.mfa.failed',
      'authentication.mfa.succeeded',
      'authorization.access.denied',
      'outbox.job.enqueued',
      'outbox.job.claimed',
      'outbox.job.lease_reclaimed',
      'outbox.job.succeeded',
      'outbox.job.retry_scheduled',
      'outbox.job.terminal_failed',
      'notification.projected',
      'notification.read',
      'notification.deep_link.denied',
      'email.delivery.queued',
      'email.delivery.attempt.started',
      'email.delivery.delivered',
      'email.delivery.retry_scheduled',
      'email.delivery.terminal_failed',
      'secure_file.quarantined',
      'secure_file.scan.queued',
      'secure_file.scan.available',
      'secure_file.scan.unsafe',
      'secure_file.scan.failed',
      'secure_file.access.authorized',
      'secure_file.access.served',
      'worker_identity.created',
      'worker_identity.status.changed',
      'worker_identity.duplicate.evaluated',
      'worker_identity.duplicate.disposition.recorded',
      'worker_identity.worker_id.issued'
    )
  );

CREATE TABLE IF NOT EXISTS worker_identity_correction_requests (
  correction_request_id TEXT PRIMARY KEY CHECK (
    correction_request_id ~ '^identity_correction_[A-Za-z0-9_-]{24}$'
  ),
  identity_id TEXT NOT NULL
    REFERENCES worker_identities(identity_id) ON DELETE RESTRICT,
  correction_version_id TEXT NOT NULL UNIQUE
    REFERENCES worker_identity_versions(identity_version_id) ON DELETE RESTRICT,
  parent_version_id TEXT NOT NULL
    REFERENCES worker_identity_versions(identity_version_id) ON DELETE RESTRICT,
  worker_account_id TEXT NOT NULL CHECK (
    char_length(worker_account_id) BETWEEN 8 AND 160
  ),
  reason TEXT NOT NULL CHECK (
    char_length(reason) BETWEEN 20 AND 1000 AND
    reason = btrim(reason) AND
    reason !~ '[[:cntrl:]]'
  ),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT worker_identity_correction_distinct_versions CHECK (
    correction_version_id <> parent_version_id
  )
);

CREATE INDEX IF NOT EXISTS worker_identity_corrections_identity_latest_idx
  ON worker_identity_correction_requests (
    identity_id,
    requested_at DESC,
    correction_request_id
  );

CREATE TABLE IF NOT EXISTS worker_identity_correction_decisions (
  correction_decision_id TEXT PRIMARY KEY CHECK (
    correction_decision_id ~ '^correction_decision_[A-Za-z0-9_-]{24}$'
  ),
  correction_request_id TEXT NOT NULL UNIQUE
    REFERENCES worker_identity_correction_requests(correction_request_id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  reason_code TEXT NOT NULL CHECK (
    reason_code ~ '^[a-z][a-z0-9_]{2,79}$'
  ),
  decided_by_component TEXT NOT NULL CHECK (
    decided_by_component = 'identity-assurance'
  ),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worker_identity_correction_evidence_origins (
  origin_id TEXT PRIMARY KEY CHECK (
    origin_id ~ '^correction_evidence_[A-Za-z0-9_-]{24}$'
  ),
  correction_request_id TEXT NOT NULL
    REFERENCES worker_identity_correction_requests(correction_request_id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK (
    purpose IN ('identity_document', 'profile_photo', 'selfie')
  ),
  source_binding_id TEXT NOT NULL
    REFERENCES worker_identity_evidence_bindings(binding_id) ON DELETE RESTRICT,
  carried_binding_id TEXT NOT NULL UNIQUE
    REFERENCES worker_identity_evidence_bindings(binding_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT worker_identity_correction_origin_unique
    UNIQUE (correction_request_id, purpose)
);

CREATE OR REPLACE FUNCTION worker_identity_correction_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'Worker identity correction history is immutable.';
END;
$$;

DROP TRIGGER IF EXISTS worker_identity_correction_requests_no_mutation
  ON worker_identity_correction_requests;
CREATE TRIGGER worker_identity_correction_requests_no_mutation
BEFORE UPDATE OR DELETE ON worker_identity_correction_requests
FOR EACH ROW
EXECUTE FUNCTION worker_identity_correction_reject_mutation();

DROP TRIGGER IF EXISTS worker_identity_correction_decisions_no_mutation
  ON worker_identity_correction_decisions;
CREATE TRIGGER worker_identity_correction_decisions_no_mutation
BEFORE UPDATE OR DELETE ON worker_identity_correction_decisions
FOR EACH ROW
EXECUTE FUNCTION worker_identity_correction_reject_mutation();

DROP TRIGGER IF EXISTS worker_identity_correction_origins_no_mutation
  ON worker_identity_correction_evidence_origins;
CREATE TRIGGER worker_identity_correction_origins_no_mutation
BEFORE UPDATE OR DELETE ON worker_identity_correction_evidence_origins
FOR EACH ROW
EXECUTE FUNCTION worker_identity_correction_reject_mutation();

-- Corrections are append-only sequence history. Rejected versions still occupy
-- their version number, so a later correction uses MAX(version_number)+1 while
-- its parent remains the currently verified version.
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
