ALTER TABLE platform_decisions
  ADD COLUMN IF NOT EXISTS tenant_id text;

UPDATE platform_decisions
SET tenant_id = 'platform-system'
WHERE tenant_id IS NULL;

ALTER TABLE platform_decisions
  ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE platform_decision_overrides
  ADD COLUMN IF NOT EXISTS tenant_id text;

UPDATE platform_decision_overrides
SET tenant_id = 'platform-system'
WHERE tenant_id IS NULL;

ALTER TABLE platform_decision_overrides
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS platform_decisions_tenant_case_lookup
  ON platform_decisions(tenant_id, case_id);

ALTER TABLE platform_decisions
  DROP CONSTRAINT IF EXISTS platform_decisions_tenant_decision_unique;

ALTER TABLE platform_decisions
  ADD CONSTRAINT platform_decisions_tenant_decision_unique UNIQUE (tenant_id, decision_id);

ALTER TABLE platform_decision_overrides
  DROP CONSTRAINT IF EXISTS platform_decision_overrides_decision_id_fkey;

ALTER TABLE platform_decision_overrides
  ADD CONSTRAINT platform_decision_overrides_tenant_decision_fkey
  FOREIGN KEY (tenant_id, decision_id)
  REFERENCES platform_decisions(tenant_id, decision_id);
