ALTER TABLE scoped_share_access_logs
  DROP CONSTRAINT IF EXISTS scoped_share_access_logs_pkey;

ALTER TABLE scoped_share_access_logs
  DROP COLUMN IF EXISTS access_log_id;
