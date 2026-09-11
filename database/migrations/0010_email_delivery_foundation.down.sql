DROP TRIGGER IF EXISTS platform_email_attempts_no_delete
  ON platform_email_delivery_attempts;
DROP TRIGGER IF EXISTS platform_email_attempts_guard_update
  ON platform_email_delivery_attempts;
DROP TRIGGER IF EXISTS platform_email_attempts_validate_insert
  ON platform_email_delivery_attempts;
DROP TRIGGER IF EXISTS platform_email_deliveries_no_delete
  ON platform_email_deliveries;
DROP TRIGGER IF EXISTS platform_email_deliveries_guard_update
  ON platform_email_deliveries;
DROP TRIGGER IF EXISTS platform_email_deliveries_validate_insert
  ON platform_email_deliveries;

DROP FUNCTION IF EXISTS platform_email_attempt_reject_delete();
DROP FUNCTION IF EXISTS platform_email_attempt_guard_update();
DROP FUNCTION IF EXISTS platform_email_attempt_validate_insert();
DROP FUNCTION IF EXISTS platform_email_delivery_reject_delete();
DROP FUNCTION IF EXISTS platform_email_delivery_guard_update();
DROP FUNCTION IF EXISTS platform_email_delivery_validate_insert();

DROP TABLE IF EXISTS platform_email_delivery_attempts;
DROP TABLE IF EXISTS platform_email_deliveries;

-- Email delivery, outbox and audit facts are durable history. The expanded
-- outbox job type and audit action/target vocabularies intentionally remain
-- valid after this storage rollback so already-recorded immutable history is
-- never invalidated. Reapplication replaces the same constraints
-- deterministically.
