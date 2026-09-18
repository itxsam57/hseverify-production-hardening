ALTER TABLE platform_decision_overrides
  DROP COLUMN IF EXISTS mfa_verified_at;

ALTER TABLE platform_decision_overrides
  DROP COLUMN IF EXISTS notification_required;
