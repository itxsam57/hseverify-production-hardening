-- Masterplan completion: account security operations and staff calibration lifecycle.

ALTER TABLE auth_security_events
  DROP CONSTRAINT IF EXISTS auth_security_events_event_type_check;
ALTER TABLE auth_security_events
  ADD CONSTRAINT auth_security_events_event_type_check CHECK (
    event_type IN (
      'registration_started','otp_issued','otp_failed','otp_verified',
      'password_created','password_reset_requested','password_reset_completed',
      'password_changed','login_failed','login_succeeded','logout','session_revoked',
      'account_locked','account_unlocked','invitation_created','invitation_accepted',
      'mfa_enrolled','mfa_failed','mfa_succeeded','mfa_replaced',
      'mfa_recovery_codes_rotated','access_denied'
    )
  );

CREATE TABLE IF NOT EXISTS auth_mfa_recovery_codes (
  recovery_code_id TEXT PRIMARY KEY CHECK (recovery_code_id ~ '^mfa_recovery_[A-Za-z0-9_-]{24}$'),
  account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMPTZ NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_mfa_recovery_code_hash_uidx
  ON auth_mfa_recovery_codes(account_id, code_hash);
CREATE INDEX IF NOT EXISTS auth_mfa_recovery_codes_account_idx
  ON auth_mfa_recovery_codes(account_id, used_at, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_mfa_rotation_challenges (
  challenge_id TEXT PRIMARY KEY CHECK (challenge_id ~ '^mfa_rotation_[A-Za-z0-9_-]{24}$'),
  account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  encrypted_secret TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_mfa_rotation_active_uidx
  ON auth_mfa_rotation_challenges(account_id)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS staff_calibrations (
  calibration_id TEXT PRIMARY KEY CHECK (calibration_id ~ '^staff_calibration_[A-Za-z0-9_-]{24}$'),
  account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('verifier','assessor')),
  framework_reference TEXT NOT NULL CHECK (char_length(framework_reference) BETWEEN 2 AND 180),
  status TEXT NOT NULL CHECK (status IN ('CURRENT','EXPIRED','FAILED','SUSPENDED')),
  valid_from TIMESTAMPTZ NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  note TEXT NOT NULL CHECK (char_length(note) BETWEEN 5 AND 2000),
  recorded_by_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (valid_until > valid_from)
);
CREATE INDEX IF NOT EXISTS staff_calibrations_live_idx
  ON staff_calibrations(account_id, role, framework_reference, valid_until DESC, created_at DESC);


CREATE TABLE IF NOT EXISTS supervisor_observation_details (
  observation_id TEXT PRIMARY KEY REFERENCES supervisor_observations(observation_id) ON DELETE RESTRICT,
  framework_reference TEXT NOT NULL CHECK (char_length(trim(framework_reference)) BETWEEN 2 AND 180),
  task_reference TEXT NOT NULL CHECK (char_length(trim(task_reference)) BETWEEN 2 AND 240),
  checklist_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  restrictions TEXT NULL CHECK (restrictions IS NULL OR char_length(trim(restrictions)) <= 2000),
  supervisor_declaration TEXT NOT NULL CHECK (char_length(trim(supervisor_declaration)) BETWEEN 10 AND 1000),
  supervisor_signed_at TIMESTAMPTZ NOT NULL,
  worker_acknowledged_at TIMESTAMPTZ NULL,
  worker_comment TEXT NULL CHECK (worker_comment IS NULL OR char_length(trim(worker_comment)) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS supervisor_observation_details_ack_idx
  ON supervisor_observation_details(worker_acknowledged_at, created_at DESC);
