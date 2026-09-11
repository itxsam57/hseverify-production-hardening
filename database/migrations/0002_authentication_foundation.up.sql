CREATE TABLE IF NOT EXISTS auth_accounts (
  account_id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL UNIQUE,
  phone_e164 TEXT NULL UNIQUE,
  display_name TEXT NOT NULL,
  account_status TEXT NOT NULL CHECK (
    account_status IN (
      'pending_email',
      'pending_phone',
      'active',
      'locked',
      'disabled'
    )
  ),
  password_hash TEXT NULL,
  worker_reference TEXT NULL UNIQUE,
  email_verified_at TIMESTAMPTZ NULL,
  phone_verified_at TIMESTAMPTZ NULL,
  failed_sign_in_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_sign_in_count >= 0),
  locked_until TIMESTAMPTZ NULL,
  password_set_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT auth_accounts_phone_verification_requires_phone CHECK (
    phone_verified_at IS NULL OR phone_e164 IS NOT NULL
  ),
  CONSTRAINT auth_accounts_verified_access_state_check CHECK (
    account_status NOT IN ('active', 'locked') OR (
      email_verified_at IS NOT NULL AND
      (phone_e164 IS NULL OR phone_verified_at IS NOT NULL)
    )
  ),
  CONSTRAINT auth_accounts_lock_state_check CHECK (
    (account_status = 'locked' AND locked_until IS NOT NULL) OR
    (account_status <> 'locked' AND locked_until IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS auth_account_roles (
  account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (
    role IN ('worker', 'company', 'assessor', 'verifier', 'admin', 'root')
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, role)
);

CREATE TABLE IF NOT EXISTS auth_otp_challenges (
  challenge_id TEXT PRIMARY KEY,
  account_id TEXT NULL REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (
    purpose IN (
      'registration_email',
      'registration_phone',
      'password_reset',
      'privileged_login'
    )
  ),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'phone')),
  destination_hash TEXT NOT NULL,
  delivery_hint TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts_remaining INTEGER NOT NULL CHECK (attempts_remaining >= 0),
  resend_available_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  invalidated_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT auth_otp_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT auth_otp_resend_window_check CHECK (
    resend_available_at >= created_at AND resend_available_at < expires_at
  ),
  CONSTRAINT auth_otp_terminal_state_check CHECK (
    consumed_at IS NULL OR invalidated_at IS NULL
  )
);

CREATE INDEX IF NOT EXISTS auth_otp_account_purpose_idx
  ON auth_otp_challenges (account_id, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS auth_otp_expiry_idx
  ON auth_otp_challenges (expires_at, consumed_at, invalidated_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  active_role TEXT NOT NULL CHECK (
    active_role IN ('worker', 'company', 'assessor', 'verifier', 'admin', 'root')
  ),
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  user_agent_hash TEXT NULL,
  ip_address_hash TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  revocation_reason TEXT NULL,
  CONSTRAINT auth_sessions_assigned_role_fk
    FOREIGN KEY (account_id, active_role)
    REFERENCES auth_account_roles (account_id, role)
    ON DELETE CASCADE,
  CONSTRAINT auth_sessions_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT auth_sessions_revocation_state_check CHECK (
    (revoked_at IS NULL AND revocation_reason IS NULL) OR
    (revoked_at IS NOT NULL AND revocation_reason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS auth_sessions_account_idx
  ON auth_sessions (account_id, revoked_at, expires_at DESC);
CREATE INDEX IF NOT EXISTS auth_sessions_token_idx
  ON auth_sessions (token_hash, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS auth_staff_invitations (
  invitation_id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL,
  role TEXT NOT NULL CHECK (
    role IN ('company', 'assessor', 'verifier', 'admin', 'root')
  ),
  token_hash TEXT NOT NULL UNIQUE,
  invitation_status TEXT NOT NULL CHECK (
    invitation_status IN ('pending', 'accepted', 'revoked', 'expired')
  ),
  invited_by_account_id TEXT NULL REFERENCES auth_accounts(account_id) ON DELETE SET NULL,
  accepted_by_account_id TEXT NULL REFERENCES auth_accounts(account_id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT auth_staff_invitation_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT auth_staff_invitation_terminal_state_check CHECK (
    accepted_at IS NULL OR revoked_at IS NULL
  )
);

CREATE INDEX IF NOT EXISTS auth_staff_invitation_lookup_idx
  ON auth_staff_invitations (email_normalized, role, invitation_status, expires_at);

CREATE TABLE IF NOT EXISTS auth_mfa_factors (
  factor_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  factor_type TEXT NOT NULL CHECK (factor_type IN ('totp')),
  encrypted_secret TEXT NOT NULL,
  factor_status TEXT NOT NULL CHECK (
    factor_status IN ('pending', 'active', 'revoked')
  ),
  last_accepted_counter BIGINT NULL CHECK (
    last_accepted_counter IS NULL OR last_accepted_counter >= 0
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_active_mfa_factor_idx
  ON auth_mfa_factors (account_id, factor_type)
  WHERE factor_status IN ('pending', 'active');

CREATE TABLE IF NOT EXISTS auth_security_events (
  event_id TEXT PRIMARY KEY,
  account_id TEXT NULL REFERENCES auth_accounts(account_id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'registration_started',
      'otp_issued',
      'otp_failed',
      'otp_verified',
      'password_created',
      'password_reset_requested',
      'password_reset_completed',
      'login_failed',
      'login_succeeded',
      'logout',
      'session_revoked',
      'account_locked',
      'account_unlocked',
      'invitation_created',
      'invitation_accepted',
      'mfa_enrolled',
      'mfa_failed',
      'mfa_succeeded',
      'access_denied'
    )
  ),
  active_role TEXT NULL CHECK (
    active_role IS NULL OR
    active_role IN ('worker', 'company', 'assessor', 'verifier', 'admin', 'root')
  ),
  request_fingerprint_hash TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS auth_security_events_account_idx
  ON auth_security_events (account_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS auth_security_events_type_idx
  ON auth_security_events (event_type, occurred_at DESC);
