-- Restore the original current-submitted-version-only duplicate-signal contract.
CREATE OR REPLACE FUNCTION worker_identity_duplicate_signal_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_identity_id TEXT;
  candidate_current_version_id TEXT;
  candidate_version_status TEXT;
BEGIN
  SELECT identity_id
  INTO target_identity_id
  FROM worker_identity_duplicate_checks
  WHERE check_id = NEW.check_id;

  SELECT
    versions.identity_version_id,
    versions.version_status
  INTO
    candidate_current_version_id,
    candidate_version_status
  FROM worker_identities AS identities
  JOIN worker_identity_versions AS versions
    ON versions.identity_id = identities.identity_id
   AND versions.version_number = identities.current_version_number
  WHERE identities.identity_id = NEW.candidate_identity_id;

  IF target_identity_id IS NULL OR
     NEW.candidate_identity_id = target_identity_id OR
     candidate_current_version_id IS NULL OR
     candidate_current_version_id <> NEW.candidate_identity_version_id OR
     candidate_version_status <> 'submitted' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Duplicate signal must reference another identity current submitted version.';
  END IF;

  NEW.created_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
