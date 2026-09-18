ALTER TABLE platform_decision_overrides
  ADD COLUMN IF NOT EXISTS mfa_verified_at timestamptz;

ALTER TABLE platform_decision_overrides
  ADD COLUMN IF NOT EXISTS notification_required boolean NOT NULL DEFAULT true;

UPDATE platform_decision_overrides
SET mfa_verified_at = created_at
WHERE mfa_verified_at IS NULL;

ALTER TABLE platform_decision_overrides
  ALTER COLUMN mfa_verified_at SET NOT NULL;
