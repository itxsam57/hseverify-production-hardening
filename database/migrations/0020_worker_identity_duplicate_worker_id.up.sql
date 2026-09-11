-- M1.07 Subunit 5: Duplicate Signals, Recovery and Worker-ID Eligibility.
-- Duplicate matching stores only bounded signal types and opaque identity references;
-- compared email/phone/name/DOB/document values are never copied into signal rows.
-- Matching is not account-recovery authority and never merges identities.

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

CREATE TABLE IF NOT EXISTS worker_identity_duplicate_checks (
  check_id TEXT PRIMARY KEY CHECK (
    check_id ~ '^identity_duplicate_check_[A-Za-z0-9_-]{24}$'
  ),
  identity_id TEXT NOT NULL
    REFERENCES worker_identities(identity_id) ON DELETE RESTRICT,
  identity_version_id TEXT NOT NULL
    REFERENCES worker_identity_versions(identity_version_id) ON DELETE RESTRICT,
  worker_account_id TEXT NOT NULL CHECK (
    char_length(worker_account_id) BETWEEN 8 AND 160
  ),
  check_sequence INTEGER NOT NULL CHECK (
    check_sequence BETWEEN 1 AND 100000
  ),
  check_status TEXT NOT NULL CHECK (
    check_status IN ('clear', 'review_required')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT worker_identity_duplicate_check_sequence_unique
    UNIQUE (identity_version_id, check_sequence)
);

CREATE INDEX IF NOT EXISTS worker_identity_duplicate_checks_latest_idx
  ON worker_identity_duplicate_checks (
    identity_id,
    identity_version_id,
    check_sequence DESC,
    created_at DESC
  );

CREATE TABLE IF NOT EXISTS worker_identity_duplicate_signals (
  signal_id TEXT PRIMARY KEY CHECK (
    signal_id ~ '^identity_duplicate_signal_[A-Za-z0-9_-]{24}$'
  ),
  check_id TEXT NOT NULL
    REFERENCES worker_identity_duplicate_checks(check_id) ON DELETE RESTRICT,
  candidate_identity_id TEXT NOT NULL
    REFERENCES worker_identities(identity_id) ON DELETE RESTRICT,
  candidate_identity_version_id TEXT NOT NULL
    REFERENCES worker_identity_versions(identity_version_id) ON DELETE RESTRICT,
  signal_type TEXT NOT NULL CHECK (
    signal_type IN (
      'verified_email_exact',
      'verified_phone_exact',
      'identity_document_exact',
      'legal_name_dob_exact'
    )
  ),
  signal_strength TEXT NOT NULL CHECK (
    signal_strength IN ('high', 'medium')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT worker_identity_duplicate_signal_unique
    UNIQUE (check_id, candidate_identity_id, signal_type)
);

CREATE INDEX IF NOT EXISTS worker_identity_duplicate_signals_check_idx
  ON worker_identity_duplicate_signals (
    check_id,
    candidate_identity_id,
    signal_type
  );

CREATE TABLE IF NOT EXISTS worker_identity_duplicate_dispositions (
  disposition_id TEXT PRIMARY KEY CHECK (
    disposition_id ~ '^identity_duplicate_disposition_[A-Za-z0-9_-]{24}$'
  ),
  check_id TEXT NOT NULL
    REFERENCES worker_identity_duplicate_checks(check_id) ON DELETE RESTRICT,
  disposition_sequence INTEGER NOT NULL CHECK (
    disposition_sequence BETWEEN 1 AND 100000
  ),
  disposition TEXT NOT NULL CHECK (
    disposition IN (
      'continue',
      'recover_existing_account',
      'duplicate_review',
      'block_worker_id'
    )
  ),
  reason_code TEXT NOT NULL CHECK (
    char_length(reason_code) BETWEEN 2 AND 120 AND
    reason_code ~ '^[a-z0-9][a-z0-9._-]*$'
  ),
  authority_component TEXT NOT NULL DEFAULT 'identity-assurance' CHECK (
    authority_component = 'identity-assurance'
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT worker_identity_duplicate_disposition_sequence_unique
    UNIQUE (check_id, disposition_sequence)
);

CREATE INDEX IF NOT EXISTS worker_identity_duplicate_dispositions_latest_idx
  ON worker_identity_duplicate_dispositions (
    check_id,
    disposition_sequence DESC,
    created_at DESC
  );

CREATE TABLE IF NOT EXISTS worker_identity_worker_ids (
  permanent_worker_id TEXT PRIMARY KEY CHECK (
    permanent_worker_id ~ '^worker_id_[A-Za-z0-9_-]{24}$'
  ),
  identity_id TEXT NOT NULL UNIQUE
    REFERENCES worker_identities(identity_id) ON DELETE RESTRICT,
  identity_version_id TEXT NOT NULL UNIQUE
    REFERENCES worker_identity_versions(identity_version_id) ON DELETE RESTRICT,
  worker_account_id TEXT NOT NULL UNIQUE CHECK (
    char_length(worker_account_id) BETWEEN 8 AND 160
  ),
  issued_by_component TEXT NOT NULL DEFAULT 'identity-assurance' CHECK (
    issued_by_component = 'identity-assurance'
  ),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION worker_identity_eligibility_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'Worker identity duplicate and Worker-ID history is immutable.';
END;
$$;

CREATE OR REPLACE FUNCTION worker_identity_duplicate_check_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner_account_id TEXT;
  current_version_id TEXT;
  current_version_status TEXT;
  current_lifecycle_status TEXT;
  expected_sequence INTEGER;
BEGIN
  SELECT
    identities.worker_account_id,
    versions.identity_version_id,
    versions.version_status,
    identities.lifecycle_status
  INTO
    owner_account_id,
    current_version_id,
    current_version_status,
    current_lifecycle_status
  FROM worker_identities AS identities
  JOIN worker_identity_versions AS versions
    ON versions.identity_id = identities.identity_id
   AND versions.version_number = identities.current_version_number
  WHERE identities.identity_id = NEW.identity_id
  FOR UPDATE OF identities, versions;

  IF owner_account_id IS NULL OR
     owner_account_id <> NEW.worker_account_id OR
     current_version_id <> NEW.identity_version_id OR
     current_version_status <> 'submitted' OR
     current_lifecycle_status NOT IN ('manual_review', 'more_info', 'verified') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Duplicate evaluation requires the exact current submitted post-check Worker identity version.';
  END IF;

  SELECT COALESCE(MAX(check_sequence), 0) + 1
  INTO expected_sequence
  FROM worker_identity_duplicate_checks
  WHERE identity_version_id = NEW.identity_version_id;

  IF NEW.check_sequence <> expected_sequence THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'Duplicate evaluation sequence is stale.';
  END IF;

  NEW.created_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

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

CREATE OR REPLACE FUNCTION worker_identity_duplicate_disposition_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  check_identity_id TEXT;
  check_version_id TEXT;
  check_sequence_value INTEGER;
  check_status_value TEXT;
  expected_sequence INTEGER;
BEGIN
  SELECT identity_id, identity_version_id, check_sequence, check_status
  INTO check_identity_id, check_version_id, check_sequence_value, check_status_value
  FROM worker_identity_duplicate_checks
  WHERE check_id = NEW.check_id;

  IF check_identity_id IS NULL OR check_status_value <> 'review_required' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Duplicate disposition requires a review-required duplicate check.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM worker_identity_duplicate_checks AS newer
    WHERE newer.identity_id = check_identity_id
      AND newer.identity_version_id = check_version_id
      AND newer.check_sequence > check_sequence_value
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'Duplicate disposition cannot target a stale duplicate check.';
  END IF;

  SELECT COALESCE(MAX(disposition_sequence), 0) + 1
  INTO expected_sequence
  FROM worker_identity_duplicate_dispositions
  WHERE check_id = NEW.check_id;

  IF NEW.disposition_sequence <> expected_sequence OR
     NEW.authority_component <> 'identity-assurance' THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'Duplicate disposition sequence or authority is invalid.';
  END IF;

  NEW.created_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION worker_identity_worker_id_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner_account_id TEXT;
  current_version_id TEXT;
  current_version_status TEXT;
  current_lifecycle_status TEXT;
  latest_check_id TEXT;
  latest_check_status TEXT;
  latest_disposition TEXT;
BEGIN
  SELECT
    identities.worker_account_id,
    versions.identity_version_id,
    versions.version_status,
    identities.lifecycle_status
  INTO
    owner_account_id,
    current_version_id,
    current_version_status,
    current_lifecycle_status
  FROM worker_identities AS identities
  JOIN worker_identity_versions AS versions
    ON versions.identity_id = identities.identity_id
   AND versions.version_number = identities.current_version_number
  WHERE identities.identity_id = NEW.identity_id
  FOR UPDATE OF identities, versions;

  IF owner_account_id IS NULL OR
     owner_account_id <> NEW.worker_account_id OR
     current_version_id <> NEW.identity_version_id OR
     current_version_status <> 'submitted' OR
     current_lifecycle_status <> 'verified' OR
     NEW.issued_by_component <> 'identity-assurance' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Permanent Worker ID requires the exact current verified identity version.';
  END IF;

  SELECT checks.check_id, checks.check_status
  INTO latest_check_id, latest_check_status
  FROM worker_identity_duplicate_checks AS checks
  WHERE checks.identity_id = NEW.identity_id
    AND checks.identity_version_id = NEW.identity_version_id
  ORDER BY checks.check_sequence DESC
  LIMIT 1;

  IF latest_check_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Permanent Worker ID requires a current duplicate eligibility evaluation.';
  END IF;

  IF latest_check_status = 'review_required' THEN
    SELECT dispositions.disposition
    INTO latest_disposition
    FROM worker_identity_duplicate_dispositions AS dispositions
    WHERE dispositions.check_id = latest_check_id
    ORDER BY dispositions.disposition_sequence DESC
    LIMIT 1;

    IF latest_disposition IS DISTINCT FROM 'continue' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Permanent Worker ID is blocked by unresolved duplicate or recovery eligibility.';
    END IF;
  ELSIF latest_check_status <> 'clear' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Permanent Worker ID duplicate eligibility state is invalid.';
  END IF;

  NEW.issued_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worker_identity_duplicate_checks_validate_insert
  ON worker_identity_duplicate_checks;
CREATE TRIGGER worker_identity_duplicate_checks_validate_insert
BEFORE INSERT ON worker_identity_duplicate_checks
FOR EACH ROW
EXECUTE FUNCTION worker_identity_duplicate_check_validate_insert();

DROP TRIGGER IF EXISTS worker_identity_duplicate_checks_no_update
  ON worker_identity_duplicate_checks;
CREATE TRIGGER worker_identity_duplicate_checks_no_update
BEFORE UPDATE ON worker_identity_duplicate_checks
FOR EACH ROW
EXECUTE FUNCTION worker_identity_eligibility_reject_mutation();

DROP TRIGGER IF EXISTS worker_identity_duplicate_checks_no_delete
  ON worker_identity_duplicate_checks;
CREATE TRIGGER worker_identity_duplicate_checks_no_delete
BEFORE DELETE ON worker_identity_duplicate_checks
FOR EACH ROW
EXECUTE FUNCTION worker_identity_eligibility_reject_mutation();

DROP TRIGGER IF EXISTS worker_identity_duplicate_signals_validate_insert
  ON worker_identity_duplicate_signals;
CREATE TRIGGER worker_identity_duplicate_signals_validate_insert
BEFORE INSERT ON worker_identity_duplicate_signals
FOR EACH ROW
EXECUTE FUNCTION worker_identity_duplicate_signal_validate_insert();

DROP TRIGGER IF EXISTS worker_identity_duplicate_signals_no_update
  ON worker_identity_duplicate_signals;
CREATE TRIGGER worker_identity_duplicate_signals_no_update
BEFORE UPDATE ON worker_identity_duplicate_signals
FOR EACH ROW
EXECUTE FUNCTION worker_identity_eligibility_reject_mutation();

DROP TRIGGER IF EXISTS worker_identity_duplicate_signals_no_delete
  ON worker_identity_duplicate_signals;
CREATE TRIGGER worker_identity_duplicate_signals_no_delete
BEFORE DELETE ON worker_identity_duplicate_signals
FOR EACH ROW
EXECUTE FUNCTION worker_identity_eligibility_reject_mutation();

DROP TRIGGER IF EXISTS worker_identity_duplicate_dispositions_validate_insert
  ON worker_identity_duplicate_dispositions;
CREATE TRIGGER worker_identity_duplicate_dispositions_validate_insert
BEFORE INSERT ON worker_identity_duplicate_dispositions
FOR EACH ROW
EXECUTE FUNCTION worker_identity_duplicate_disposition_validate_insert();

DROP TRIGGER IF EXISTS worker_identity_duplicate_dispositions_no_update
  ON worker_identity_duplicate_dispositions;
CREATE TRIGGER worker_identity_duplicate_dispositions_no_update
BEFORE UPDATE ON worker_identity_duplicate_dispositions
FOR EACH ROW
EXECUTE FUNCTION worker_identity_eligibility_reject_mutation();

DROP TRIGGER IF EXISTS worker_identity_duplicate_dispositions_no_delete
  ON worker_identity_duplicate_dispositions;
CREATE TRIGGER worker_identity_duplicate_dispositions_no_delete
BEFORE DELETE ON worker_identity_duplicate_dispositions
FOR EACH ROW
EXECUTE FUNCTION worker_identity_eligibility_reject_mutation();

DROP TRIGGER IF EXISTS worker_identity_worker_ids_validate_insert
  ON worker_identity_worker_ids;
CREATE TRIGGER worker_identity_worker_ids_validate_insert
BEFORE INSERT ON worker_identity_worker_ids
FOR EACH ROW
EXECUTE FUNCTION worker_identity_worker_id_validate_insert();

DROP TRIGGER IF EXISTS worker_identity_worker_ids_no_update
  ON worker_identity_worker_ids;
CREATE TRIGGER worker_identity_worker_ids_no_update
BEFORE UPDATE ON worker_identity_worker_ids
FOR EACH ROW
EXECUTE FUNCTION worker_identity_eligibility_reject_mutation();

DROP TRIGGER IF EXISTS worker_identity_worker_ids_no_delete
  ON worker_identity_worker_ids;
CREATE TRIGGER worker_identity_worker_ids_no_delete
BEFORE DELETE ON worker_identity_worker_ids
FOR EACH ROW
EXECUTE FUNCTION worker_identity_eligibility_reject_mutation();
