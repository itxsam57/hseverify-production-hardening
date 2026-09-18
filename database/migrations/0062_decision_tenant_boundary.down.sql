ALTER TABLE platform_decision_overrides
  DROP CONSTRAINT IF EXISTS platform_decision_overrides_tenant_decision_fkey;

ALTER TABLE platform_decision_overrides
  ADD CONSTRAINT platform_decision_overrides_decision_id_fkey
  FOREIGN KEY (decision_id)
  REFERENCES platform_decisions(decision_id);

ALTER TABLE platform_decision_overrides
  DROP COLUMN IF EXISTS tenant_id;

ALTER TABLE platform_decisions
  DROP CONSTRAINT IF EXISTS platform_decisions_tenant_decision_unique;

ALTER TABLE platform_decisions
  ADD CONSTRAINT platform_decisions_tenant_decision_unique UNIQUE (decision_id);

DROP INDEX IF EXISTS platform_decisions_tenant_case_lookup;

ALTER TABLE platform_decisions
  DROP COLUMN IF EXISTS tenant_id;
