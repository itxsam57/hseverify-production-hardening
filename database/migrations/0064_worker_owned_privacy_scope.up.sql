-- Preserve global worker ownership while adding optional company context.
ALTER TABLE privacy_requests
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

ALTER TABLE accessibility_accommodations
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Retention jobs remain tenant-bound in the application contract. The column is
-- nullable only so an existing unscoped row cannot make this additive migration fail.
ALTER TABLE retention_jobs
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE INDEX IF NOT EXISTS privacy_requests_tenant_idx
  ON privacy_requests(tenant_id, worker_id, created_at DESC);
