ALTER TABLE auth_rate_limit_buckets
  DROP CONSTRAINT IF EXISTS auth_rate_limit_buckets_action_check;

ALTER TABLE auth_rate_limit_buckets
  ADD CONSTRAINT auth_rate_limit_buckets_action_check
  CHECK (action IN ('worker_registration_start', 'company_registration_start'));

CREATE TABLE IF NOT EXISTS company_registration_flows (
  flow_id TEXT PRIMARY KEY CHECK (flow_id ~ '^company_registration_[A-Za-z0-9_-]{24}$'),
  account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id) ON DELETE RESTRICT,
  membership_id TEXT NOT NULL REFERENCES auth_tenant_memberships(membership_id) ON DELETE RESTRICT,
  case_id TEXT NOT NULL UNIQUE,
  factor_id TEXT NOT NULL REFERENCES auth_mfa_factors(factor_id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  current_step TEXT NOT NULL CHECK (
    current_step IN ('pending_email', 'pending_mfa', 'complete', 'cancelled')
  ),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  cancelled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT company_registration_flow_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT company_registration_flow_state_check CHECK (
    (current_step IN ('pending_email', 'pending_mfa') AND completed_at IS NULL AND cancelled_at IS NULL)
    OR (current_step = 'complete' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (current_step = 'cancelled' AND completed_at IS NULL AND cancelled_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS company_registration_active_account_idx
  ON company_registration_flows (account_id)
  WHERE current_step IN ('pending_email', 'pending_mfa');

CREATE INDEX IF NOT EXISTS company_registration_token_idx
  ON company_registration_flows (token_hash, expires_at, current_step);

CREATE TABLE IF NOT EXISTS company_verification_cases (
  case_id TEXT PRIMARY KEY CHECK (case_id ~ '^company_verification_[A-Za-z0-9_-]{24}$'),
  tenant_id TEXT NOT NULL UNIQUE REFERENCES platform_tenants(tenant_id) ON DELETE RESTRICT,
  owner_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  current_version_id TEXT NULL,
  case_status TEXT NOT NULL DEFAULT 'draft' CHECK (
    case_status IN ('draft', 'submitted', 'under_review', 'changes_requested', 'verified', 'rejected', 'withdrawn')
  ),
  lock_version INTEGER NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at TIMESTAMPTZ NULL,
  verified_at TIMESTAMPTZ NULL,
  rejected_at TIMESTAMPTZ NULL,
  withdrawn_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS company_verification_versions (
  version_id TEXT PRIMARY KEY CHECK (version_id ~ '^company_verification_version_[A-Za-z0-9_-]{24}$'),
  case_id TEXT NOT NULL REFERENCES company_verification_cases(case_id) ON DELETE RESTRICT,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  parent_version_id TEXT NULL REFERENCES company_verification_versions(version_id) ON DELETE RESTRICT,
  version_status TEXT NOT NULL DEFAULT 'draft' CHECK (
    version_status IN ('draft', 'submitted', 'changes_requested', 'verified', 'rejected', 'withdrawn')
  ),
  draft_revision INTEGER NOT NULL DEFAULT 0 CHECK (draft_revision >= 0),
  legal_name TEXT NULL CHECK (legal_name IS NULL OR char_length(legal_name) BETWEEN 2 AND 180),
  trading_name TEXT NULL CHECK (trading_name IS NULL OR char_length(trading_name) BETWEEN 2 AND 180),
  registration_number TEXT NULL CHECK (registration_number IS NULL OR char_length(registration_number) BETWEEN 2 AND 120),
  country TEXT NULL CHECK (country IS NULL OR char_length(country) BETWEEN 2 AND 120),
  industry TEXT NULL CHECK (industry IS NULL OR char_length(industry) BETWEEN 2 AND 160),
  company_size TEXT NULL CHECK (
    company_size IS NULL OR company_size IN ('1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001+')
  ),
  website TEXT NULL CHECK (website IS NULL OR char_length(website) BETWEEN 5 AND 240),
  authorized_representative TEXT NULL CHECK (
    authorized_representative IS NULL OR char_length(authorized_representative) BETWEEN 2 AND 160
  ),
  business_email_normalized TEXT NULL CHECK (
    business_email_normalized IS NULL OR char_length(business_email_normalized) BETWEEN 3 AND 254
  ),
  business_phone_e164 TEXT NULL CHECK (
    business_phone_e164 IS NULL OR business_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  terms_accepted_at TIMESTAMPTZ NULL,
  privacy_accepted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at TIMESTAMPTZ NULL,
  terminal_at TIMESTAMPTZ NULL,
  UNIQUE (case_id, version_number),
  CONSTRAINT company_verification_version_lineage_check CHECK (
    (version_number = 1 AND parent_version_id IS NULL)
    OR (version_number > 1 AND parent_version_id IS NOT NULL)
  ),
  CONSTRAINT company_verification_version_timestamps_check CHECK (
    (version_status = 'draft' AND submitted_at IS NULL AND terminal_at IS NULL)
    OR (version_status = 'submitted' AND submitted_at IS NOT NULL AND terminal_at IS NULL)
    OR (version_status IN ('changes_requested', 'verified', 'rejected', 'withdrawn') AND submitted_at IS NOT NULL AND terminal_at IS NOT NULL)
  )
);

ALTER TABLE company_verification_cases
  ADD CONSTRAINT company_verification_current_version_fk
  FOREIGN KEY (current_version_id)
  REFERENCES company_verification_versions(version_id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS company_verification_case_status_idx
  ON company_verification_cases (case_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS company_verification_version_case_idx
  ON company_verification_versions (case_id, version_number DESC);

CREATE TABLE IF NOT EXISTS company_verification_evidence (
  binding_id TEXT PRIMARY KEY CHECK (binding_id ~ '^company_evidence_[A-Za-z0-9_-]{24}$'),
  case_id TEXT NOT NULL REFERENCES company_verification_cases(case_id) ON DELETE RESTRICT,
  version_id TEXT NOT NULL REFERENCES company_verification_versions(version_id) ON DELETE RESTRICT,
  secure_file_id TEXT NOT NULL CHECK (secure_file_id ~ '^secure_file_[A-Za-z0-9_-]{24}$'),
  evidence_label TEXT NOT NULL CHECK (char_length(evidence_label) BETWEEN 2 AND 100),
  binding_status TEXT NOT NULL DEFAULT 'active' CHECK (binding_status IN ('active', 'superseded')),
  replaced_binding_id TEXT NULL REFERENCES company_verification_evidence(binding_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TIMESTAMPTZ NULL,
  CONSTRAINT company_verification_evidence_state_check CHECK (
    (binding_status = 'active' AND superseded_at IS NULL)
    OR (binding_status = 'superseded' AND superseded_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS company_verification_active_evidence_idx
  ON company_verification_evidence (version_id, evidence_label)
  WHERE binding_status = 'active';

CREATE INDEX IF NOT EXISTS company_verification_evidence_version_idx
  ON company_verification_evidence (version_id, created_at DESC);

CREATE TABLE IF NOT EXISTS company_verification_duplicate_signals (
  signal_id TEXT PRIMARY KEY CHECK (signal_id ~ '^company_duplicate_[A-Za-z0-9_-]{24}$'),
  case_id TEXT NOT NULL REFERENCES company_verification_cases(case_id) ON DELETE RESTRICT,
  version_id TEXT NOT NULL REFERENCES company_verification_versions(version_id) ON DELETE RESTRICT,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('registration_number', 'legal_name')),
  strength TEXT NOT NULL CHECK (strength IN ('exact', 'similar')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (version_id, signal_type, strength)
);

CREATE OR REPLACE FUNCTION hse_guard_company_verification_version_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Company verification version history is immutable.' USING ERRCODE = '23514';
  END IF;

  IF OLD.version_status <> 'draft' AND (
    NEW.case_id IS DISTINCT FROM OLD.case_id OR
    NEW.version_number IS DISTINCT FROM OLD.version_number OR
    NEW.parent_version_id IS DISTINCT FROM OLD.parent_version_id OR
    NEW.draft_revision IS DISTINCT FROM OLD.draft_revision OR
    NEW.legal_name IS DISTINCT FROM OLD.legal_name OR
    NEW.trading_name IS DISTINCT FROM OLD.trading_name OR
    NEW.registration_number IS DISTINCT FROM OLD.registration_number OR
    NEW.country IS DISTINCT FROM OLD.country OR
    NEW.industry IS DISTINCT FROM OLD.industry OR
    NEW.company_size IS DISTINCT FROM OLD.company_size OR
    NEW.website IS DISTINCT FROM OLD.website OR
    NEW.authorized_representative IS DISTINCT FROM OLD.authorized_representative OR
    NEW.business_email_normalized IS DISTINCT FROM OLD.business_email_normalized OR
    NEW.business_phone_e164 IS DISTINCT FROM OLD.business_phone_e164 OR
    NEW.terms_accepted_at IS DISTINCT FROM OLD.terms_accepted_at OR
    NEW.privacy_accepted_at IS DISTINCT FROM OLD.privacy_accepted_at OR
    NEW.created_at IS DISTINCT FROM OLD.created_at OR
    NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
  ) THEN
    RAISE EXCEPTION 'Submitted Company verification details are immutable.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_verification_version_history_guard
  ON company_verification_versions;
CREATE TRIGGER company_verification_version_history_guard
BEFORE UPDATE OR DELETE ON company_verification_versions
FOR EACH ROW
EXECUTE FUNCTION hse_guard_company_verification_version_history();

CREATE OR REPLACE FUNCTION hse_guard_company_verification_evidence_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Company verification evidence history is immutable.' USING ERRCODE = '23514';
  END IF;

  SELECT version_status INTO current_status
  FROM company_verification_versions
  WHERE version_id = NEW.version_id;

  IF current_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Submitted Company verification evidence is immutable.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_verification_evidence_history_guard
  ON company_verification_evidence;
CREATE TRIGGER company_verification_evidence_history_guard
BEFORE INSERT OR UPDATE OR DELETE ON company_verification_evidence
FOR EACH ROW
EXECUTE FUNCTION hse_guard_company_verification_evidence_history();
