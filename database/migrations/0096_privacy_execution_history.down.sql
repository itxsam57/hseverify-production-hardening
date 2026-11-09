-- Refuse rollback before dropping any bounded privacy fulfilment receipt.
LOCK TABLE privacy_execution_events, retention_jobs IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM privacy_execution_events)
    OR EXISTS (SELECT 1 FROM retention_jobs WHERE completed_at IS NOT NULL OR execution_result <> '{}'::jsonb) THEN
  RAISE EXCEPTION 'Privacy execution and retention completion history must be retained; rollback refused.' USING ERRCODE='55000';
 END IF;
END;
$$;
ALTER TABLE retention_jobs DROP COLUMN IF EXISTS completed_at, DROP COLUMN IF EXISTS execution_result;
DROP TABLE IF EXISTS privacy_execution_events;
DROP FUNCTION IF EXISTS hse_privacy_execution_validate();
