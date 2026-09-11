-- M1.07 Subunit 2: Worker Identity Draft and Verified Contact Binding.
-- Editable personal facts live on the identity version, not Worker Profile JSON.
-- Verified contacts are copied only from live authentication authority by SQL.
-- No identity-history table physically references rollback-owned auth tables.
-- Ordinary partial draft saves are revision-traceable but are not immutable
-- security-audit events; the material submit/lifecycle transition remains audited.

CREATE TABLE IF NOT EXISTS worker_identity_version_drafts (
  identity_version_id TEXT PRIMARY KEY
    REFERENCES worker_identity_versions(identity_version_id) ON DELETE RESTRICT,
  draft_revision INTEGER NOT NULL DEFAULT 1 CHECK (
    draft_revision BETWEEN 1 AND 100000
  ),
  legal_first_name TEXT NULL CHECK (
    legal_first_name IS NULL OR char_length(legal_first_name) BETWEEN 1 AND 120
  ),
  legal_last_name TEXT NULL CHECK (
    legal_last_name IS NULL OR char_length(legal_last_name) BETWEEN 1 AND 120
  ),
  previous_legal_name TEXT NULL CHECK (
    previous_legal_name IS NULL OR char_length(previous_legal_name) BETWEEN 1 AND 160
  ),
  date_of_birth DATE NULL,
  nationality TEXT NULL CHECK (
    nationality IS NULL OR char_length(nationality) BETWEEN 2 AND 100
  ),
  country_of_residence TEXT NULL CHECK (
    country_of_residence IS NULL OR char_length(country_of_residence) BETWEEN 2 AND 100
  ),
  verified_email_normalized TEXT NOT NULL CHECK (
    char_length(verified_email_normalized) BETWEEN 3 AND 320
  ),
  email_verified_at TIMESTAMPTZ NOT NULL,
  verified_phone_e164 TEXT NOT NULL CHECK (
    char_length(verified_phone_e164) BETWEEN 8 AND 24
  ),
  phone_verified_at TIMESTAMPTZ NOT NULL,
  contact_snapshot_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS worker_identity_version_drafts_updated_idx
  ON worker_identity_version_drafts (updated_at DESC, identity_version_id);

CREATE OR REPLACE FUNCTION worker_identity_draft_guard_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  identity_owner_account_id TEXT;
  identity_status TEXT;
  identity_current_version INTEGER;
  version_number_value INTEGER;
  version_status_value TEXT;
  account_email TEXT;
  account_email_verified_at TIMESTAMPTZ;
  account_phone TEXT;
  account_phone_verified_at TIMESTAMPTZ;
BEGIN
  SELECT
    identities.worker_account_id,
    identities.lifecycle_status,
    identities.current_version_number,
    versions.version_number,
    versions.version_status,
    accounts.email_normalized,
    accounts.email_verified_at,
    accounts.phone_e164,
    accounts.phone_verified_at
  INTO
    identity_owner_account_id,
    identity_status,
    identity_current_version,
    version_number_value,
    version_status_value,
    account_email,
    account_email_verified_at,
    account_phone,
    account_phone_verified_at
  FROM worker_identity_versions AS versions
  JOIN worker_identities AS identities
    ON identities.identity_id = versions.identity_id
  JOIN auth_accounts AS accounts
    ON accounts.account_id = identities.worker_account_id
   AND accounts.account_status = 'active'
  JOIN auth_account_roles AS roles
    ON roles.account_id = accounts.account_id
   AND roles.role = 'worker'
  WHERE versions.identity_version_id = NEW.identity_version_id;

  IF identity_owner_account_id IS NULL OR
     version_status_value <> 'draft' OR
     identity_current_version <> version_number_value OR
     identity_status NOT IN ('draft', 'correction_pending') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Worker identity draft must belong to the current editable Worker version.';
  END IF;

  IF account_email IS NULL OR account_email_verified_at IS NULL OR
     account_phone IS NULL OR account_phone_verified_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Worker identity requires verified email and phone contacts.';
  END IF;

  IF NEW.date_of_birth IS NOT NULL AND NEW.date_of_birth > CURRENT_DATE THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Worker identity date of birth cannot be in the future.';
  END IF;

  NEW.verified_email_normalized := account_email;
  NEW.email_verified_at := account_email_verified_at;
  NEW.verified_phone_e164 := account_phone;
  NEW.phone_verified_at := account_phone_verified_at;
  NEW.contact_snapshot_at := CURRENT_TIMESTAMP;

  IF TG_OP = 'INSERT' THEN
    IF NEW.draft_revision <> 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = '40001',
        MESSAGE = 'Initial Worker identity draft revision must be 1.';
    END IF;
    NEW.created_at := CURRENT_TIMESTAMP;
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
  END IF;

  IF NEW.identity_version_id IS DISTINCT FROM OLD.identity_version_id OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Worker identity draft version ownership is immutable.';
  END IF;

  IF NEW.draft_revision <> OLD.draft_revision + 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'Worker identity draft revision is stale.';
  END IF;

  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worker_identity_version_drafts_guard_write
  ON worker_identity_version_drafts;
CREATE TRIGGER worker_identity_version_drafts_guard_write
BEFORE INSERT OR UPDATE ON worker_identity_version_drafts
FOR EACH ROW
EXECUTE FUNCTION worker_identity_draft_guard_write();

DROP TRIGGER IF EXISTS worker_identity_version_drafts_no_delete
  ON worker_identity_version_drafts;
CREATE TRIGGER worker_identity_version_drafts_no_delete
BEFORE DELETE ON worker_identity_version_drafts
FOR EACH ROW
EXECUTE FUNCTION worker_identity_reject_delete();

-- Extend the accepted S1 version transition guard. Submission now requires a
-- complete S2 personal-details record and a contact snapshot that still matches
-- the current live Worker authentication authority.
CREATE OR REPLACE FUNCTION worker_identity_version_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ready_detail_count INTEGER;
BEGIN
  IF OLD.version_status = 'submitted' OR OLD.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Submitted Worker identity versions are immutable.';
  END IF;

  IF NEW.identity_version_id IS DISTINCT FROM OLD.identity_version_id OR
     NEW.identity_id IS DISTINCT FROM OLD.identity_id OR
     NEW.version_number IS DISTINCT FROM OLD.version_number OR
     NEW.parent_version_id IS DISTINCT FROM OLD.parent_version_id OR
     NEW.version_kind IS DISTINCT FROM OLD.version_kind OR
     NEW.created_by_account_id IS DISTINCT FROM OLD.created_by_account_id OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Worker identity version lineage is immutable.';
  END IF;

  IF OLD.version_status <> 'draft' OR
     NEW.version_status <> 'submitted' OR
     NEW.submitted_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Worker identity version transition is invalid.';
  END IF;

  SELECT COUNT(*)
  INTO ready_detail_count
  FROM worker_identity_version_drafts AS drafts
  JOIN worker_identities AS identities
    ON identities.identity_id = OLD.identity_id
   AND identities.current_version_number = OLD.version_number
  JOIN auth_accounts AS accounts
    ON accounts.account_id = identities.worker_account_id
   AND accounts.account_status = 'active'
  JOIN auth_account_roles AS roles
    ON roles.account_id = accounts.account_id
   AND roles.role = 'worker'
  WHERE drafts.identity_version_id = OLD.identity_version_id
    AND drafts.legal_first_name IS NOT NULL
    AND drafts.legal_last_name IS NOT NULL
    AND drafts.date_of_birth IS NOT NULL
    AND drafts.date_of_birth <= CURRENT_DATE
    AND drafts.nationality IS NOT NULL
    AND drafts.country_of_residence IS NOT NULL
    AND accounts.email_verified_at IS NOT NULL
    AND accounts.phone_e164 IS NOT NULL
    AND accounts.phone_verified_at IS NOT NULL
    AND drafts.verified_email_normalized = accounts.email_normalized
    AND drafts.email_verified_at = accounts.email_verified_at
    AND drafts.verified_phone_e164 = accounts.phone_e164
    AND drafts.phone_verified_at = accounts.phone_verified_at;

  IF ready_detail_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Worker identity personal details and verified contacts are incomplete or stale.';
  END IF;

  RETURN NEW;
END;
$$;
