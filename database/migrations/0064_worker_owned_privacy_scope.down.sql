DROP INDEX IF EXISTS privacy_requests_tenant_idx;

ALTER TABLE retention_jobs
  DROP COLUMN IF EXISTS tenant_id;

ALTER TABLE accessibility_accommodations
  DROP COLUMN IF EXISTS tenant_id;

ALTER TABLE privacy_requests
  DROP COLUMN IF EXISTS tenant_id;
