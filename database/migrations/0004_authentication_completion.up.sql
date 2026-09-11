CREATE TABLE IF NOT EXISTS auth_recovery_flows (
  flow_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  active_role TEXT NOT NULL CHECK (
    active_role IN ('worker', 'company', 'assessor', 'verifier', 'admin', 'root')
  ),
  token_hash TEXT NOT NULL UNIQUE,
  challenge_id TEXT NOT NULL REFERENCES auth_otp_challenges(challenge_id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT auth_recovery_flow_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT auth_recovery_flow_consumed_check CHECK (
    consumed_at IS NULL OR consumed_at >= created_at
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_active_recovery_account_idx
  ON auth_recovery_flows (account_id)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS auth_recovery_token_lookup_idx
  ON auth_recovery_flows (token_hash, expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS auth_staff_enrollment_flows (
  flow_id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL REFERENCES auth_staff_invitations(invitation_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  account_id TEXT NULL REFERENCES auth_accounts(account_id) ON DELETE SET NULL,
  factor_id TEXT NULL REFERENCES auth_mfa_factors(factor_id) ON DELETE SET NULL,
  current_step TEXT NOT NULL CHECK (
    current_step IN ('profile', 'totp', 'complete', 'cancelled')
  ),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  cancelled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT auth_staff_enrollment_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT auth_staff_enrollment_state_check CHECK (
    (
      current_step = 'profile' AND
      account_id IS NULL AND factor_id IS NULL AND
      completed_at IS NULL AND cancelled_at IS NULL
    ) OR (
      current_step = 'totp' AND
      account_id IS NOT NULL AND factor_id IS NOT NULL AND
      completed_at IS NULL AND cancelled_at IS NULL
    ) OR (
      current_step = 'complete' AND
      account_id IS NOT NULL AND factor_id IS NOT NULL AND
      completed_at IS NOT NULL AND cancelled_at IS NULL
    ) OR (
      current_step = 'cancelled' AND
      completed_at IS NULL AND cancelled_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_active_staff_enrollment_invitation_idx
  ON auth_staff_enrollment_flows (invitation_id)
  WHERE current_step IN ('profile', 'totp');

CREATE INDEX IF NOT EXISTS auth_staff_enrollment_token_lookup_idx
  ON auth_staff_enrollment_flows (token_hash, expires_at, current_step);

CREATE TABLE IF NOT EXISTS auth_access_rate_limits (
  action TEXT NOT NULL CHECK (
    action IN ('sign_in', 'password_reset', 'staff_invitation', 'root_bootstrap')
  ),
  bucket_key TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 1),
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (action, bucket_key)
);

CREATE INDEX IF NOT EXISTS auth_access_rate_limit_window_idx
  ON auth_access_rate_limits (action, window_started_at);

CREATE OR REPLACE FUNCTION hse_expire_conflicting_staff_invitations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE auth_staff_invitations
  SET invitation_status = 'expired'
  WHERE invitation_status = 'pending'
    AND expires_at <= CURRENT_TIMESTAMP
    AND (
      (
        email_normalized = NEW.email_normalized
        AND role = NEW.role
      ) OR (
        NEW.role = 'root'
        AND NEW.invited_by_account_id IS NULL
        AND role = 'root'
        AND invited_by_account_id IS NULL
      )
    );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auth_expire_conflicting_staff_invitations
  ON auth_staff_invitations;
CREATE TRIGGER auth_expire_conflicting_staff_invitations
BEFORE INSERT ON auth_staff_invitations
FOR EACH ROW
EXECUTE FUNCTION hse_expire_conflicting_staff_invitations();

CREATE UNIQUE INDEX IF NOT EXISTS auth_pending_staff_invitation_idx
  ON auth_staff_invitations (email_normalized, role)
  WHERE invitation_status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS auth_single_pending_root_bootstrap_idx
  ON auth_staff_invitations ((role))
  WHERE role = 'root'
    AND invitation_status = 'pending'
    AND invited_by_account_id IS NULL;
