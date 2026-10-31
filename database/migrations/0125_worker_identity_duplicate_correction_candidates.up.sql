-- Preserve the verified parent identity while a correction is pending.
-- The current correction may be draft or submitted, but is not verified.
CREATE OR REPLACE FUNCTION worker_identity_duplicate_signal_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_identity_id TEXT;
  candidate_effective_version_id TEXT;
  candidate_effective_version_status TEXT;
BEGIN
  SELECT identity_id INTO target_identity_id
  FROM worker_identity_duplicate_checks
  WHERE check_id = NEW.check_id;

  SELECT
    effective.identity_version_id,
    effective.version_status
  INTO candidate_effective_version_id, candidate_effective_version_status
  FROM worker_identities AS identities
  JOIN worker_identity_versions AS current_version
    ON current_version.identity_id = identities.identity_id
   AND current_version.version_number = identities.current_version_number
  JOIN worker_identity_versions AS effective
    ON effective.identity_id = identities.identity_id
   AND effective.identity_version_id = CASE
     WHEN identities.lifecycle_status = 'correction_pending'
      AND current_version.version_kind = 'correction'
     THEN current_version.parent_version_id
     ELSE current_version.identity_version_id
   END
  WHERE identities.identity_id = NEW.candidate_identity_id;

  IF target_identity_id IS NULL OR
     NEW.candidate_identity_id = target_identity_id OR
     candidate_effective_version_id IS NULL OR
     candidate_effective_version_id <> NEW.candidate_identity_version_id OR
     candidate_effective_version_status <> 'submitted' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Duplicate signal must reference another identity latest verified or current submitted version.';
  END IF;

  NEW.created_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
