DROP TABLE IF EXISTS interview_question_sets;
DROP TABLE IF EXISTS interview_runtime_events;
DROP TABLE IF EXISTS interview_runtime_sessions;
DROP TABLE IF EXISTS interview_assignment_decisions;
DROP TABLE IF EXISTS interview_assignment_conflicts;
DROP TABLE IF EXISTS assessor_assignment_profiles;
DROP TABLE IF EXISTS written_scoring_assistance;
DROP TABLE IF EXISTS recording_assets;

DROP INDEX IF EXISTS integrity_capture_events_worker_idx;
ALTER TABLE integrity_capture_events
  DROP COLUMN IF EXISTS provider_state,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS case_id,
  DROP COLUMN IF EXISTS worker_account_id;
DROP TABLE IF EXISTS assessment_integrity_sessions;

ALTER TABLE interview_requests
  DROP COLUMN IF EXISTS technical_issue,
  DROP COLUMN IF EXISTS no_show_at,
  DROP COLUMN IF EXISTS ready_at,
  DROP COLUMN IF EXISTS recording_consented_at,
  DROP COLUMN IF EXISTS recording_consent_required,
  DROP COLUMN IF EXISTS recording_retention_days,
  DROP COLUMN IF EXISTS recording_policy,
  DROP COLUMN IF EXISTS jurisdiction,
  DROP COLUMN IF EXISTS language,
  DROP COLUMN IF EXISTS risk_level,
  DROP COLUMN IF EXISTS qualification_scope,
  DROP COLUMN IF EXISTS trade_scope;
