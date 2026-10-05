-- Immutable time policies and server-owned attempt clocks.
ALTER TABLE assessment_blueprint_delivery_settings
  ADD COLUMN timing_config_json JSONB NULL CHECK (
    timing_config_json IS NULL OR (
      jsonb_typeof(timing_config_json)='object' AND
      timing_config_json->>'mode' IN ('COMBINED','SEPARATE')
    )
  );
CREATE FUNCTION reject_assessment_timing_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Assessment timing history is append-only';
END;
$$;
CREATE TRIGGER assessment_delivery_settings_immutable
  BEFORE UPDATE OR DELETE ON assessment_blueprint_delivery_settings
  FOR EACH ROW EXECUTE FUNCTION reject_assessment_timing_mutation();
CREATE TABLE assessment_attempt_time_policies (
  attempt_id TEXT PRIMARY KEY REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  blueprint_version_id TEXT NOT NULL REFERENCES assessment_blueprint_versions(blueprint_version_id) ON DELETE RESTRICT,
  timing_mode TEXT NOT NULL CHECK (timing_mode IN ('COMBINED','SEPARATE')),
  time_multiplier NUMERIC NOT NULL CHECK (time_multiplier BETWEEN 1 AND 2),
  phase_durations_json JSONB NOT NULL CHECK (jsonb_typeof(phase_durations_json)='array'),
  snapshotted_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE assessment_attempt_clocks (
  attempt_id TEXT NOT NULL REFERENCES assessment_attempt_time_policies(attempt_id) ON DELETE RESTRICT,
  phase_index INTEGER NOT NULL CHECK (phase_index BETWEEN 0 AND 50),
  started_at TIMESTAMPTZ NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL CHECK (deadline_at > started_at),
  PRIMARY KEY(attempt_id,phase_index)
);
CREATE TRIGGER assessment_time_policy_immutable BEFORE UPDATE OR DELETE ON assessment_attempt_time_policies
  FOR EACH ROW EXECUTE FUNCTION reject_assessment_timing_mutation();
CREATE TRIGGER assessment_clock_immutable BEFORE UPDATE OR DELETE ON assessment_attempt_clocks
  FOR EACH ROW EXECUTE FUNCTION reject_assessment_timing_mutation();
