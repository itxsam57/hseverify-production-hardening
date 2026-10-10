ALTER TABLE retention_jobs DROP COLUMN IF EXISTS completed_at, DROP COLUMN IF EXISTS execution_result;
DROP TABLE IF EXISTS privacy_execution_events;
DROP FUNCTION IF EXISTS hse_privacy_execution_validate();
