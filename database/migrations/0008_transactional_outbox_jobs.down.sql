DROP TRIGGER IF EXISTS platform_outbox_attempts_no_delete
  ON platform_outbox_job_attempts;
DROP TRIGGER IF EXISTS platform_outbox_jobs_no_delete
  ON platform_outbox_jobs;
DROP FUNCTION IF EXISTS platform_outbox_reject_delete();

DROP TABLE IF EXISTS platform_outbox_job_attempts;
DROP TABLE IF EXISTS platform_outbox_jobs;

-- Audit facts are immutable. The expanded action/target vocabulary remains
-- available after an outbox-storage rollback so already-recorded lifecycle
-- facts are never deleted or made invalid. Reapplication is deterministic
-- because the up migration replaces these constraints with the same values.
