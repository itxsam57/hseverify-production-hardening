-- M1.12 optional public concern evidence.
--
-- M1.06 remains authoritative for file validation, private object storage,
-- quarantine and malware-scan lifecycle. M1.12 adds only a narrowly-scoped,
-- non-login service principal for public concern intake plus immutable candidate
-- history. Ordinary Worker/Company secure-file ownership remains unchanged.
--
-- Cross-brick secure-file identifiers intentionally remain opaque references rather
-- than hard foreign keys. Trusted services and the candidate guard revalidate the
-- live M1.06 file, owner and lifecycle before mutation. This preserves immutable
-- M1.12 history without blocking independent rollback/reapply of the older M1.06
-- secure-file brick.

INSERT INTO auth_accounts (
  account_id, email_normalized, display_name, account_status,
  password_hash, created_at, updated_at
) VALUES (
  'account_public_concern_intake_system',
  'public-concern-intake@system.hseverify.invalid',
  'Public concern intake system',
  'disabled', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT (account_id) DO NOTHING;

INSERT INTO auth_account_roles (account_id, role, created_at)
VALUES ('account_public_concern_intake_system', 'root', CURRENT_TIMESTAMP)
ON CONFLICT (account_id, role) DO NOTHING;

CREATE OR REPLACE FUNCTION hse_public_concern_system_account_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Public concern system account cannot be deleted.'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.account_status <> 'disabled'
     OR NEW.password_hash IS NOT NULL
     OR NEW.phone_e164 IS NOT NULL
     OR NEW.email_verified_at IS NOT NULL
     OR NEW.phone_verified_at IS NOT NULL
     OR NEW.worker_reference IS NOT NULL THEN
    RAISE EXCEPTION 'Public concern system account cannot become interactive.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auth_public_concern_system_account_guard ON auth_accounts;
CREATE TRIGGER auth_public_concern_system_account_guard
BEFORE UPDATE OR DELETE ON auth_accounts
FOR EACH ROW
WHEN (OLD.account_id = 'account_public_concern_intake_system')
EXECUTE FUNCTION hse_public_concern_system_account_guard();

CREATE OR REPLACE FUNCTION hse_public_concern_system_session_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.account_id = 'account_public_concern_intake_system' THEN
    RAISE EXCEPTION 'Public concern system account cannot authenticate.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auth_public_concern_system_session_guard ON auth_sessions;
CREATE TRIGGER auth_public_concern_system_session_guard
BEFORE INSERT OR UPDATE ON auth_sessions
FOR EACH ROW EXECUTE FUNCTION hse_public_concern_system_session_guard();

-- Preserve M1.06 owner validation for every ordinary account. Only the exact
-- disabled service-principal/root/non-tenant tuple is accepted without a live user.
CREATE OR REPLACE FUNCTION platform_secure_file_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  eligible_owner BOOLEAN;
BEGIN
  IF NEW.owner_account_id = 'account_public_concern_intake_system' THEN
    IF NEW.owner_role <> 'root'
       OR NEW.tenant_id IS NOT NULL
       OR NEW.membership_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'Public concern secure file ownership is invalid.';
    END IF;
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM auth_accounts AS accounts
    JOIN auth_account_roles AS roles
      ON roles.account_id = accounts.account_id
     AND roles.role = NEW.owner_role
    WHERE accounts.account_id = NEW.owner_account_id
      AND accounts.account_status = 'active'
  ) INTO eligible_owner;

  IF NOT eligible_owner THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'Secure file owner must be an active account with the assigned role.';
  END IF;

  IF NEW.owner_role = 'company' AND NOT EXISTS (
    SELECT 1
    FROM auth_tenant_memberships AS memberships
    JOIN platform_tenants AS tenants
      ON tenants.tenant_id = memberships.tenant_id
    WHERE memberships.membership_id = NEW.membership_id
      AND memberships.tenant_id = NEW.tenant_id
      AND memberships.account_id = NEW.owner_account_id
      AND memberships.portal_role = 'company'
      AND memberships.membership_status = 'active'
      AND tenants.tenant_status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'Company secure file ownership requires the active trusted tenant membership.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public_verification_concern_evidence_candidates (
  candidate_id TEXT PRIMARY KEY
    CONSTRAINT public_verification_concern_evidence_candidates_id_check
    CHECK (candidate_id ~ '^public_concern_evidence_[A-Za-z0-9_-]{24}$'),
  concern_id TEXT NOT NULL
    REFERENCES public_verification_concerns(concern_id) ON DELETE RESTRICT,
  secure_file_id TEXT NOT NULL UNIQUE
    CONSTRAINT public_verification_concern_evidence_secure_file_id_check
    CHECK (secure_file_id ~ '^secure_file_[A-Za-z0-9_-]{24}$'),
  candidate_status TEXT NOT NULL DEFAULT 'pending'
    CONSTRAINT public_verification_concern_evidence_candidates_status_check
    CHECK (candidate_status IN ('pending', 'bound', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalized_at TIMESTAMPTZ NULL,
  CONSTRAINT public_verification_concern_evidence_candidates_state_check
    CHECK (
      (candidate_status = 'pending' AND finalized_at IS NULL)
      OR (candidate_status IN ('bound', 'rejected') AND finalized_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS public_verification_concern_evidence_candidates_concern_idx
  ON public_verification_concern_evidence_candidates (
    concern_id, created_at DESC, candidate_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS public_verification_concern_evidence_one_bound_idx
  ON public_verification_concern_evidence_candidates (concern_id)
  WHERE candidate_status = 'bound';

CREATE OR REPLACE FUNCTION hse_guard_public_verification_concern_evidence_candidate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  secure_status TEXT;
  concern_status TEXT;
  secure_owner TEXT;
  secure_role TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Public verification concern evidence history cannot be deleted.'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.candidate_id <> OLD.candidate_id
       OR NEW.concern_id <> OLD.concern_id
       OR NEW.secure_file_id <> OLD.secure_file_id
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'Public verification concern evidence provenance is immutable.'
        USING ERRCODE = '55000';
    END IF;
    IF OLD.candidate_status <> 'pending'
       OR NEW.candidate_status NOT IN ('bound', 'rejected') THEN
      RAISE EXCEPTION 'Public verification concern evidence transition is invalid.'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  SELECT intake_status INTO concern_status
  FROM public_verification_concerns WHERE concern_id = NEW.concern_id;
  IF concern_status IS DISTINCT FROM 'received' THEN
    RAISE EXCEPTION 'Public verification concern evidence requires a received concern.'
      USING ERRCODE = '55000';
  END IF;

  SELECT lifecycle_status, owner_account_id, owner_role
    INTO secure_status, secure_owner, secure_role
  FROM platform_secure_files WHERE file_id = NEW.secure_file_id;
  IF secure_status IS NULL THEN
    RAISE EXCEPTION 'Public verification concern evidence secure file is missing.'
      USING ERRCODE = '55000';
  END IF;
  IF secure_owner <> 'account_public_concern_intake_system'
     OR secure_role <> 'root' THEN
    RAISE EXCEPTION 'Public verification concern evidence secure-file authority is invalid.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.candidate_status = 'bound' AND secure_status <> 'available' THEN
    RAISE EXCEPTION 'Public verification concern evidence is not available.'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.candidate_status = 'rejected'
     AND secure_status NOT IN ('unsafe', 'scan_failed') THEN
    RAISE EXCEPTION 'Public verification concern evidence is not terminal.'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS public_verification_concern_evidence_candidate_guard
  ON public_verification_concern_evidence_candidates;
CREATE TRIGGER public_verification_concern_evidence_candidate_guard
BEFORE INSERT OR UPDATE OR DELETE
ON public_verification_concern_evidence_candidates
FOR EACH ROW EXECUTE FUNCTION hse_guard_public_verification_concern_evidence_candidate();

CREATE OR REPLACE FUNCTION hse_finalize_public_verification_concern_evidence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_account_id <> 'account_public_concern_intake_system'
     OR NEW.owner_role <> 'root'
     OR NEW.lifecycle_status = OLD.lifecycle_status THEN
    RETURN NEW;
  END IF;

  IF NEW.lifecycle_status = 'available' THEN
    UPDATE public_verification_concern_evidence_candidates
       SET candidate_status = 'bound', finalized_at = CURRENT_TIMESTAMP
     WHERE secure_file_id = NEW.file_id AND candidate_status = 'pending';
  ELSIF NEW.lifecycle_status IN ('unsafe', 'scan_failed') THEN
    UPDATE public_verification_concern_evidence_candidates
       SET candidate_status = 'rejected', finalized_at = CURRENT_TIMESTAMP
     WHERE secure_file_id = NEW.file_id AND candidate_status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS public_verification_concern_evidence_scan_finalize
  ON platform_secure_files;
CREATE TRIGGER public_verification_concern_evidence_scan_finalize
AFTER UPDATE OF lifecycle_status ON platform_secure_files
FOR EACH ROW EXECUTE FUNCTION hse_finalize_public_verification_concern_evidence();
