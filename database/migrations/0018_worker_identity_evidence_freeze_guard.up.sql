-- M1.07 Subunit 3 hardening: replacement is allowed only while the bound
-- identity version is still the current editable Worker version. This closes the
-- direct-SQL path that could otherwise supersede evidence after submission.

CREATE OR REPLACE FUNCTION worker_identity_evidence_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  identity_owner TEXT;
  identity_status TEXT;
  current_version_number INTEGER;
  bound_version_number INTEGER;
  bound_version_status TEXT;
BEGIN
  SELECT
    identities.worker_account_id,
    identities.lifecycle_status,
    identities.current_version_number,
    versions.version_number,
    versions.version_status
  INTO
    identity_owner,
    identity_status,
    current_version_number,
    bound_version_number,
    bound_version_status
  FROM worker_identity_versions AS versions
  JOIN worker_identities AS identities
    ON identities.identity_id = versions.identity_id
  WHERE versions.identity_version_id = OLD.identity_version_id;

  IF identity_owner IS NULL OR
     identity_owner <> OLD.worker_account_id OR
     bound_version_status <> 'draft' OR
     current_version_number <> bound_version_number OR
     identity_status NOT IN ('draft', 'correction_pending') THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Worker identity evidence can change only on the current editable Worker version.';
  END IF;

  IF NEW.binding_id IS DISTINCT FROM OLD.binding_id OR
     NEW.identity_version_id IS DISTINCT FROM OLD.identity_version_id OR
     NEW.worker_account_id IS DISTINCT FROM OLD.worker_account_id OR
     NEW.purpose IS DISTINCT FROM OLD.purpose OR
     NEW.secure_file_id IS DISTINCT FROM OLD.secure_file_id OR
     NEW.document_type IS DISTINCT FROM OLD.document_type OR
     NEW.document_number IS DISTINCT FROM OLD.document_number OR
     NEW.issue_date IS DISTINCT FROM OLD.issue_date OR
     NEW.expiry_date IS DISTINCT FROM OLD.expiry_date OR
     NEW.supersedes_binding_id IS DISTINCT FROM OLD.supersedes_binding_id OR
     NEW.created_by_account_id IS DISTINCT FROM OLD.created_by_account_id OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Worker identity evidence provenance and metadata are immutable.';
  END IF;

  IF OLD.binding_status <> 'active' OR NEW.binding_status <> 'superseded' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Worker identity evidence transition is invalid.';
  END IF;

  NEW.superseded_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
