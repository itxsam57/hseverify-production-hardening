-- Local/test rollback may remove only empty timing structures.
-- Accepted blueprint policies and attempt clocks must never be discarded.
LOCK TABLE assessment_blueprint_delivery_settings, assessment_attempt_time_policies, assessment_attempt_clocks IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM assessment_attempt_time_policies LIMIT 1)
     OR EXISTS (SELECT 1 FROM assessment_attempt_clocks LIMIT 1)
     OR EXISTS (SELECT 1 FROM assessment_blueprint_delivery_settings WHERE timing_config_json IS NOT NULL LIMIT 1) THEN
    RAISE EXCEPTION 'Cannot remove accepted assessment timing history.';
  END IF;
END $$;

DROP TABLE assessment_attempt_clocks;
DROP TABLE assessment_attempt_time_policies;
DROP TRIGGER assessment_delivery_settings_immutable ON assessment_blueprint_delivery_settings;
ALTER TABLE assessment_blueprint_delivery_settings DROP COLUMN timing_config_json;
DROP FUNCTION reject_assessment_timing_mutation();
