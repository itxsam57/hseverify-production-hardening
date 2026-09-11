-- M1.07 Subunit 3: Secure Identity Document, Profile Photo and Selfie Evidence Binding.
-- Evidence bytes remain exclusively in the accepted M1.06 secure-file domain.
-- This layer stores only opaque secure-file references plus identity metadata.
--
-- The secure_file_id is deliberately NOT a foreign key to platform_secure_files.
-- M1.06 owns an accepted independent local/test rollback boundary. Identity evidence
-- is durable history, so binding-time authority is revalidated transactionally and
-- by SQL without coupling identity-history lifetime to the secure-file table.

CREATE TABLE IF NOT EXISTS worker_identity_evidence_bindings (
  binding_id TEXT PRIMARY KEY CHECK (
    binding_id ~ '^identity_evidence_[A-Za-z0-9_-]{24}$'
  ),
  identity_version_id TEXT NOT NULL
    REFERENCES worker_identity_versions(identity_version_id) ON DELETE RESTRICT,
  worker_account_id TEXT NOT NULL CHECK (
    char_length(worker_account_id) BETWEEN 8 AND 160
  ),
  purpose TEXT NOT NULL CHECK (
    purpose IN ('identity_document', 'profile_photo', 'selfie')
  ),
  secure_file_id TEXT NOT NULL CHECK (
    secure_file_id ~ '^secure_file_[A-Za-z0-9_-]{24}$'
  ),
  document_type TEXT NULL CHECK (
    document_type IS NULL OR
    document_type IN ('passport', 'national_id', 'residence_permit')
  ),
  document_number TEXT NULL CHECK (
    document_number IS NULL OR (
      char_length(document_number) BETWEEN 3 AND 80 AND
      document_number = btrim(document_number) AND
      document_number !~ '[[:cntrl:]]'
    )
  ),
  issue_date DATE NULL,
  expiry_date DATE NULL,
  binding_status TEXT NOT NULL DEFAULT 'active' CHECK (
    binding_status IN ('active', 'superseded')
  ),
  supersedes_binding_id TEXT NULL
    REFERENCES worker_identity_evidence_bindings(binding_id) ON DELETE RESTRICT,
  created_by_account_id TEXT NOT NULL CHECK (
    char_length(created_by_account_id) BETWEEN 8 AND 160
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TIMESTAMPTZ NULL,
  CONSTRAINT worker_identity_evidence_metadata_shape CHECK (
    (
      purpose = 'identity_document' AND
      document_type IS NOT NULL AND
      document_number IS NOT NULL
    ) OR (
      purpose IN ('profile_photo', 'selfie') AND
      document_type IS NULL AND
      document_number IS NULL AND
      issue_date IS NULL AND
      expiry_date IS NULL
    )
  ),
  CONSTRAINT worker_identity_evidence_date_order CHECK (
    issue_date IS NULL OR expiry_date IS NULL OR issue_date <= expiry_date
  ),
  CONSTRAINT worker_identity_evidence_status_shape CHECK (
    (binding_status = 'active' AND superseded_at IS NULL) OR
    (binding_status = 'superseded' AND superseded_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS worker_identity_evidence_active_purpose_uidx
  ON worker_identity_evidence_bindings (identity_version_id, purpose)
  WHERE binding_status = 'active';

CREATE INDEX IF NOT EXISTS worker_identity_evidence_version_history_idx
  ON worker_identity_evidence_bindings (
    identity_version_id,
    purpose,
    created_at DESC,
    binding_id
  );

CREATE INDEX IF NOT EXISTS worker_identity_evidence_file_reference_idx
  ON worker_identity_evidence_bindings (secure_file_id, identity_version_id);

CREATE OR REPLACE FUNCTION worker_identity_evidence_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  identity_owner TEXT;
  identity_status TEXT;
  current_version_number INTEGER;
  bound_version_number INTEGER;
  bound_version_status TEXT;
  file_owner TEXT;
  file_role TEXT;
  file_tenant TEXT;
  file_membership TEXT;
  file_status TEXT;
  file_detected_mime TEXT;
BEGIN
  SELECT
    identities.worker_account_id,
    identities.lifecycle_status,
    identities.current_version_number,
    versions.version_number,
    versions.version_status
  INTO
    identity_owner,
    identity_status,
    current_version_number,
    bound_version_number,
    bound_version_status
  FROM worker_identity_versions AS versions
  JOIN worker_identities AS identities
    ON identities.identity_id = versions.identity_id
  WHERE versions.identity_version_id = NEW.identity_version_id;

  IF identity_owner IS NULL OR
     identity_owner <> NEW.worker_account_id OR
     NEW.created_by_account_id <> identity_owner OR
     bound_version_status <> 'draft' OR
     current_version_number <> bound_version_number OR
     identity_status NOT IN ('draft', 'correction_pending') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Worker identity evidence must belong to the current editable Worker version.';
  END IF;

  SELECT
    files.owner_account_id,
    files.owner_role,
    files.tenant_id,
    files.membership_id,
    files.lifecycle_status,
    files.detected_mime
  INTO
    file_owner,
    file_role,
    file_tenant,
    file_membership,
    file_status,
    file_detected_mime
  FROM platform_secure_files AS files
  WHERE files.file_id = NEW.secure_file_id;

  IF file_owner IS NULL OR
     file_owner <> identity_owner OR
     file_role <> 'worker' OR
     file_tenant IS NOT NULL OR
     file_membership IS NOT NULL OR
     file_status <> 'available' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Worker identity evidence requires an available secure file owned by the Worker.';
  END IF;

  IF NEW.purpose IN ('profile_photo', 'selfie') AND
     file_detected_mime NOT IN ('image/png', 'image/jpeg') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Worker identity photo and selfie evidence must be an available image.';
  END IF;

  IF NEW.purpose = 'identity_document' AND
     NEW.expiry_date IS NOT NULL AND NEW.expiry_date < CURRENT_DATE THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Expired identity documents cannot be bound to a submitted identity candidate.';
  END IF;

  IF NEW.binding_status <> 'active' OR NEW.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'New Worker identity evidence must begin active.';
  END IF;

  IF NEW.supersedes_binding_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM worker_identity_evidence_bindings AS previous
    WHERE previous.binding_id = NEW.supersedes_binding_id
      AND previous.identity_version_id = NEW.identity_version_id
      AND previous.purpose = NEW.purpose
      AND previous.binding_status = 'superseded'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Worker identity evidence replacement lineage is invalid.';
  END IF;

  NEW.created_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION worker_identity_evidence_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.binding_id IS DISTINCT FROM OLD.binding_id OR
     NEW.identity_version_id IS DISTINCT FROM OLD.identity_version_id OR
     NEW.worker_account_id IS DISTINCT FROM OLD.worker_account_id OR
     NEW.purpose IS DISTINCT FROM OLD.purpose OR
     NEW.secure_file_id IS DISTINCT FROM OLD.secure_file_id OR
     NEW.document_type IS DISTINCT FROM OLD.document_type OR
     NEW.document_number IS DISTINCT FROM OLD.document_number OR
     NEW.issue_date IS DISTINCT FROM OLD.issue_date OR
     NEW.expiry_date IS DISTINCT FROM OLD.expiry_date OR
     NEW.supersedes_binding_id IS DISTINCT FROM OLD.supersedes_binding_id OR
     NEW.created_by_account_id IS DISTINCT FROM OLD.created_by_account_id OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Worker identity evidence provenance and metadata are immutable.';
  END IF;

  IF OLD.binding_status <> 'active' OR NEW.binding_status <> 'superseded' THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Worker identity evidence transition is invalid.';
  END IF;

  NEW.superseded_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worker_identity_evidence_validate_insert
  ON worker_identity_evidence_bindings;
CREATE TRIGGER worker_identity_evidence_validate_insert
BEFORE INSERT ON worker_identity_evidence_bindings
FOR EACH ROW
EXECUTE FUNCTION worker_identity_evidence_validate_insert();

DROP TRIGGER IF EXISTS worker_identity_evidence_guard_update
  ON worker_identity_evidence_bindings;
CREATE TRIGGER worker_identity_evidence_guard_update
BEFORE UPDATE ON worker_identity_evidence_bindings
FOR EACH ROW
EXECUTE FUNCTION worker_identity_evidence_guard_update();

DROP TRIGGER IF EXISTS worker_identity_evidence_no_delete
  ON worker_identity_evidence_bindings;
CREATE TRIGGER worker_identity_evidence_no_delete
BEFORE DELETE ON worker_identity_evidence_bindings
FOR EACH ROW
EXECUTE FUNCTION worker_identity_reject_delete();

-- Extend the S2 submission boundary: a complete personal/contact draft is not
-- sufficient without one current, available identity document, profile photo and
-- selfie. Evidence rows themselves are immutable history, so submission only
-- reads the active bindings and their current M1.06 secure-file state.
CREATE OR REPLACE FUNCTION worker_identity_version_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ready_detail_count INTEGER;
  ready_evidence_count INTEGER;
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

  SELECT COUNT(DISTINCT evidence.purpose)
  INTO ready_evidence_count
  FROM worker_identity_evidence_bindings AS evidence
  JOIN worker_identities AS identities
    ON identities.identity_id = OLD.identity_id
   AND identities.worker_account_id = evidence.worker_account_id
  JOIN platform_secure_files AS files
    ON files.file_id = evidence.secure_file_id
   AND files.owner_account_id = evidence.worker_account_id
   AND files.owner_role = 'worker'
   AND files.tenant_id IS NULL
   AND files.membership_id IS NULL
   AND files.lifecycle_status = 'available'
  WHERE evidence.identity_version_id = OLD.identity_version_id
    AND evidence.binding_status = 'active'
    AND evidence.purpose IN ('identity_document', 'profile_photo', 'selfie')
    AND (
      evidence.purpose <> 'identity_document' OR
      evidence.expiry_date IS NULL OR
      evidence.expiry_date >= CURRENT_DATE
    )
    AND (
      evidence.purpose = 'identity_document' OR
      files.detected_mime IN ('image/png', 'image/jpeg')
    );

  IF ready_evidence_count <> 3 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Worker identity document, profile photo and selfie evidence are incomplete or unavailable.';
  END IF;

  RETURN NEW;
END;
$$;
