DROP TRIGGER IF EXISTS platform_secure_files_no_delete
  ON platform_secure_files;
DROP TRIGGER IF EXISTS platform_secure_files_guard_update
  ON platform_secure_files;
DROP TRIGGER IF EXISTS platform_secure_files_validate_insert
  ON platform_secure_files;

DROP FUNCTION IF EXISTS platform_secure_file_reject_delete();
DROP FUNCTION IF EXISTS platform_secure_file_guard_update();
DROP FUNCTION IF EXISTS platform_secure_file_validate_insert();

DROP TABLE IF EXISTS platform_secure_files;

-- Subunit 1 owns only the secure-file metadata/storage-authority layer.
-- M1.05 audit, outbox, notification and email vocabularies are untouched.
