CREATE UNIQUE INDEX IF NOT EXISTS auth_active_otp_challenge_idx
  ON auth_otp_challenges (account_id, purpose)
  WHERE consumed_at IS NULL
    AND invalidated_at IS NULL
    AND account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_registration_flows (
  flow_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  current_step TEXT NOT NULL CHECK (
    current_step IN ('pending_email', 'pending_phone', 'complete', 'cancelled')
  ),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  cancelled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT auth_registration_flow_expiry_check
    CHECK (expires_at > created_at),
  CONSTRAINT auth_registration_flow_completion_check
    CHECK (
      (current_step = 'complete' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
      OR
      (current_step = 'cancelled' AND cancelled_at IS NOT NULL AND completed_at IS NULL)
      OR
      (current_step IN ('pending_email', 'pending_phone') AND completed_at IS NULL AND cancelled_at IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_active_registration_account_idx
  ON auth_registration_flows (account_id)
  WHERE current_step IN ('pending_email', 'pending_phone');

CREATE INDEX IF NOT EXISTS auth_registration_token_lookup_idx
  ON auth_registration_flows (token_hash, expires_at, current_step);

CREATE TABLE IF NOT EXISTS auth_sandbox_deliveries (
  delivery_id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL UNIQUE REFERENCES auth_otp_challenges(challenge_id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'phone')),
  destination_hash TEXT NOT NULL,
  delivery_hint TEXT NOT NULL,
  encrypted_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  opened_at TIMESTAMPTZ NULL,
  CONSTRAINT auth_sandbox_delivery_opened_check
    CHECK (opened_at IS NULL OR opened_at >= created_at)
);

CREATE INDEX IF NOT EXISTS auth_sandbox_delivery_lookup_idx
  ON auth_sandbox_deliveries (channel, destination_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS auth_rate_limit_buckets (
  action TEXT NOT NULL CHECK (
    action IN ('worker_registration_start')
  ),
  bucket_key TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 1),
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (action, bucket_key)
);

CREATE INDEX IF NOT EXISTS auth_rate_limit_window_idx
  ON auth_rate_limit_buckets (action, window_started_at);
