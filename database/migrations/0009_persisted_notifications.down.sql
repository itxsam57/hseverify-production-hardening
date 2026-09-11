DROP TRIGGER IF EXISTS platform_notifications_no_delete
  ON platform_notifications;
DROP TRIGGER IF EXISTS platform_notifications_guard_update
  ON platform_notifications;
DROP TRIGGER IF EXISTS platform_notifications_validate_insert
  ON platform_notifications;

DROP FUNCTION IF EXISTS platform_notification_reject_delete();
DROP FUNCTION IF EXISTS platform_notification_guard_update();
DROP FUNCTION IF EXISTS platform_notification_validate_projection();

DROP TABLE IF EXISTS platform_notifications;

-- Notification, outbox and audit facts are durable history. The expanded
-- outbox job type and audit action/target vocabularies intentionally remain
-- valid after this storage rollback so already-recorded immutable history is
-- never invalidated. Reapplication replaces the same constraints
-- deterministically.
