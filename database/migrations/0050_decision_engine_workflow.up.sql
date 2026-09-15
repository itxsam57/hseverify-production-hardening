CREATE TABLE IF NOT EXISTS platform_decisions (
  decision_id text PRIMARY KEY,
  case_id text NOT NULL,
  state text NOT NULL,
  reason_code text NOT NULL,
  explanation text NOT NULL,
  rule_version text NOT NULL,
  input_references jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS platform_decisions_case_lookup
  ON platform_decisions(case_id);

CREATE TABLE IF NOT EXISTS platform_decision_overrides (
  override_id text PRIMARY KEY,
  decision_id text NOT NULL REFERENCES platform_decisions(decision_id),
  previous_state text NOT NULL,
  new_state text NOT NULL,
  reason text NOT NULL,
  evidence_reference text NOT NULL,
  actor_reference text NOT NULL,
  confirmed boolean NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS platform_decision_overrides_decision_lookup
  ON platform_decision_overrides(decision_id);
