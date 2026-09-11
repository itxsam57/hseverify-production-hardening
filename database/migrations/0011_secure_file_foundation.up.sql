CREATE TABLE IF NOT EXISTS platform_secure_files (
  file_sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  file_id TEXT PRIMARY KEY CHECK (
    file_id ~ '^secure_file_[A-Za-z0-9_-]{24}$'
  ),
  schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
  reservation_key TEXT NOT NULL UNIQUE CHECK (
    char_length(reservation_key) = 64 AND
    reservation_key ~ '^[a-f0-9]{64}$'
  ),
  owner_account_id TEXT NOT NULL
    REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  owner_role TEXT NOT NULL CHECK (
    owner_role IN ('worker', 'company', 'assessor', 'verifier', 'admin', 'root')
  ),
  tenant_id TEXT NULL,
  membership_id TEXT NULL,
  storage_adapter_key TEXT NOT NULL CHECK (
    storage_adapter_key IN ('local_test')
  ),
  object_key TEXT NOT NULL UNIQUE CHECK (
    object_key ~ '^secure-files/[a-f0-9]{64}$'
  ),
  display_filename TEXT NOT NULL CHECK (
    char_length(display_filename) BETWEEN 1 AND 180 AND
    display_filename = btrim(display_filename) AND
    display_filename NOT IN ('.', '..') AND
    display_filename !~ '[\\/]' AND
    display_filename !~ '[[:cntrl:]]'
  ),
  lifecycle_status TEXT NOT NULL DEFAULT 'reserved' CHECK (
    lifecycle_status IN (
      'reserved',
      'quarantined',
      'scan_pending',
      'available',
      'unsafe',
      'scan_failed'
    )
  ),
  file_extension TEXT NULL CHECK (
    file_extension IS NULL OR file_extension IN ('pdf', 'png', 'jpg', 'jpeg')
  ),
  declared_mime TEXT NULL CHECK (
    declared_mime IS NULL OR declared_mime IN ('application/pdf', 'image/png', 'image/jpeg')
  ),
  detected_mime TEXT NULL CHECK (
    detected_mime IS NULL OR detected_mime IN ('application/pdf', 'image/png', 'image/jpeg')
  ),
  byte_size BIGINT NULL CHECK (byte_size IS NULL OR byte_size > 0),
  content_sha256 TEXT NULL CHECK (
    content_sha256 IS NULL OR (
      char_length(content_sha256) = 64 AND
      content_sha256 ~ '^[a-f0-9]{64}$'
    )
  ),
  quarantined_at TIMESTAMPTZ NULL,
  available_at TIMESTAMPTZ NULL,
  unsafe_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT platform_secure_file_tenant_scope_shape CHECK (
    (
      owner_role = 'company' AND
      tenant_id IS NOT NULL AND membership_id IS NOT NULL
    ) OR (
      owner_role <> 'company' AND
      tenant_id IS NULL AND membership_id IS NULL
    )
  ),
  CONSTRAINT platform_secure_file_content_shape CHECK (
    (
      lifecycle_status = 'reserved' AND
      file_extension IS NULL AND declared_mime IS NULL AND detected_mime IS NULL AND
      byte_size IS NULL AND content_sha256 IS NULL AND
      quarantined_at IS NULL AND available_at IS NULL AND unsafe_at IS NULL
    ) OR (
      lifecycle_status IN ('quarantined', 'scan_pending', 'scan_failed') AND
      file_extension IS NOT NULL AND declared_mime IS NOT NULL AND detected_mime IS NOT NULL AND
      byte_size IS NOT NULL AND content_sha256 IS NOT NULL AND
      quarantined_at IS NOT NULL AND available_at IS NULL AND unsafe_at IS NULL
    ) OR (
      lifecycle_status = 'available' AND
      file_extension IS NOT NULL AND declared_mime IS NOT NULL AND detected_mime IS NOT NULL AND
      byte_size IS NOT NULL AND content_sha256 IS NOT NULL AND
      quarantined_at IS NOT NULL AND available_at IS NOT NULL AND unsafe_at IS NULL
    ) OR (
      lifecycle_status = 'unsafe' AND
      file_extension IS NOT NULL AND declared_mime IS NOT NULL AND detected_mime IS NOT NULL AND
      byte_size IS NOT NULL AND content_sha256 IS NOT NULL AND
      quarantined_at IS NOT NULL AND available_at IS NULL AND unsafe_at IS NOT NULL
    )
  ),
  CONSTRAINT platform_secure_file_timestamp_order CHECK (
    updated_at >= created_at AND
    (quarantined_at IS NULL OR quarantined_at >= created_at) AND
    (available_at IS NULL OR available_at >= created_at) AND
    (unsafe_at IS NULL OR unsafe_at >= created_at)
  )
);

CREATE INDEX IF NOT EXISTS platform_secure_files_owner_idx
  ON platform_secure_files (
    owner_account_id,
    owner_role,
    file_sequence DESC
  );

CREATE INDEX IF NOT EXISTS platform_secure_files_company_scope_idx
  ON platform_secure_files (
    tenant_id,
    membership_id,
    owner_account_id,
    file_sequence DESC
  )
  WHERE owner_role = 'company';

CREATE INDEX IF NOT EXISTS platform_secure_files_status_idx
  ON platform_secure_files (lifecycle_status, file_sequence);

CREATE OR REPLACE FUNCTION platform_secure_file_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  eligible_owner BOOLEAN;
BEGIN
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
    RAISE EXCEPTION USING
      ERRCODE = '23514',
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
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Company secure file ownership requires the active trusted tenant membership.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION platform_secure_file_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.file_sequence IS DISTINCT FROM OLD.file_sequence OR
     NEW.file_id IS DISTINCT FROM OLD.file_id OR
     NEW.schema_version IS DISTINCT FROM OLD.schema_version OR
     NEW.reservation_key IS DISTINCT FROM OLD.reservation_key OR
     NEW.owner_account_id IS DISTINCT FROM OLD.owner_account_id OR
     NEW.owner_role IS DISTINCT FROM OLD.owner_role OR
     NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
     NEW.membership_id IS DISTINCT FROM OLD.membership_id OR
     NEW.storage_adapter_key IS DISTINCT FROM OLD.storage_adapter_key OR
     NEW.object_key IS DISTINCT FROM OLD.object_key OR
     NEW.display_filename IS DISTINCT FROM OLD.display_filename OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Secure file identity, ownership and storage provenance are immutable.';
  END IF;

  IF NOT (
    (OLD.lifecycle_status = 'reserved' AND NEW.lifecycle_status = 'quarantined') OR
    (OLD.lifecycle_status = 'quarantined' AND NEW.lifecycle_status = 'scan_pending') OR
    (OLD.lifecycle_status = 'scan_pending' AND NEW.lifecycle_status IN ('available', 'unsafe', 'scan_failed')) OR
    (OLD.lifecycle_status = 'scan_failed' AND NEW.lifecycle_status = 'scan_pending')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Secure file lifecycle transition is invalid.';
  END IF;

  IF OLD.lifecycle_status = 'reserved' AND NEW.lifecycle_status = 'quarantined' THEN
    IF NEW.file_extension IS NULL OR NEW.declared_mime IS NULL OR NEW.detected_mime IS NULL OR
       NEW.byte_size IS NULL OR NEW.content_sha256 IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Quarantined secure file requires complete validated content metadata.';
    END IF;
    NEW.quarantined_at := CURRENT_TIMESTAMP;
  ELSIF
    NEW.file_extension IS DISTINCT FROM OLD.file_extension OR
    NEW.declared_mime IS DISTINCT FROM OLD.declared_mime OR
    NEW.detected_mime IS DISTINCT FROM OLD.detected_mime OR
    NEW.byte_size IS DISTINCT FROM OLD.byte_size OR
    NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256 OR
    NEW.quarantined_at IS DISTINCT FROM OLD.quarantined_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Secure file validated content provenance is immutable after quarantine.';
  END IF;

  IF NEW.lifecycle_status = 'available' THEN
    NEW.available_at := CURRENT_TIMESTAMP;
    NEW.unsafe_at := NULL;
  ELSIF NEW.lifecycle_status = 'unsafe' THEN
    NEW.available_at := NULL;
    NEW.unsafe_at := CURRENT_TIMESTAMP;
  ELSE
    NEW.available_at := NULL;
    NEW.unsafe_at := NULL;
  END IF;

  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION platform_secure_file_reject_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'Secure file history cannot be deleted.';
END;
$$;

CREATE TRIGGER platform_secure_files_validate_insert
BEFORE INSERT ON platform_secure_files
FOR EACH ROW
EXECUTE FUNCTION platform_secure_file_validate_insert();

CREATE TRIGGER platform_secure_files_guard_update
BEFORE UPDATE ON platform_secure_files
FOR EACH ROW
EXECUTE FUNCTION platform_secure_file_guard_update();

CREATE TRIGGER platform_secure_files_no_delete
BEFORE DELETE ON platform_secure_files
FOR EACH ROW
EXECUTE FUNCTION platform_secure_file_reject_delete();
