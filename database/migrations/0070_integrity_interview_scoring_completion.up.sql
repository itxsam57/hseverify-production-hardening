-- Masterplan completion: integrity, scoring assistance and interview runtime.

CREATE TABLE IF NOT EXISTS assessment_integrity_sessions (
  attempt_id TEXT PRIMARY KEY REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  case_id TEXT NOT NULL REFERENCES assurance_cases(case_id) ON DELETE RESTRICT,
  worker_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  monitoring_state TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (monitoring_state IN ('ACTIVE','DEGRADED','RECOVERED','STOPPED')),
  provider_state TEXT NOT NULL DEFAULT 'BUILT_IN'
    CHECK (provider_state IN ('BUILT_IN','EXTERNAL_READY','DEGRADED','UNAVAILABLE')),
  degradation_reason TEXT NULL CHECK (degradation_reason IS NULL OR char_length(degradation_reason) <= 1000),
  started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_event_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  stopped_at TIMESTAMPTZ NULL,
  CHECK (
    (monitoring_state='STOPPED' AND stopped_at IS NOT NULL) OR
    (monitoring_state<>'STOPPED' AND stopped_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS assessment_integrity_worker_idx
  ON assessment_integrity_sessions(worker_account_id,last_event_at DESC);

ALTER TABLE integrity_capture_events
  ADD COLUMN IF NOT EXISTS worker_account_id TEXT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS case_id TEXT NULL REFERENCES assurance_cases(case_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'browser'
    CHECK (source IN ('browser','camera','microphone','screen','network','device','candidate_report','provider')),
  ADD COLUMN IF NOT EXISTS provider_state TEXT NOT NULL DEFAULT 'BUILT_IN'
    CHECK (provider_state IN ('BUILT_IN','EXTERNAL_READY','DEGRADED','UNAVAILABLE'));
CREATE INDEX IF NOT EXISTS integrity_capture_events_worker_idx
  ON integrity_capture_events(worker_account_id,occurred_at DESC);

CREATE TABLE IF NOT EXISTS recording_assets (
  recording_asset_id TEXT PRIMARY KEY
    CHECK (recording_asset_id ~ '^recording_asset_[A-Za-z0-9_-]{24}$'),
  purpose TEXT NOT NULL CHECK (purpose IN ('ASSESSMENT_INTEGRITY','INTERVIEW')),
  attempt_id TEXT NULL REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
  interview_request_id TEXT NULL,
  case_id TEXT NOT NULL REFERENCES assurance_cases(case_id) ON DELETE RESTRICT,
  tenant_id TEXT NULL,
  worker_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  captured_by_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('CAMERA','MICROPHONE','SCREEN','VIDEO_AUDIO','AUDIO_ONLY','COMPOSITE')),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('video/webm','audio/webm','video/mp4','audio/ogg','audio/mp4')),
  object_key TEXT NOT NULL UNIQUE CHECK (object_key ~ '^secure-files/[a-f0-9]{64}$'),
  ingest_key_hash TEXT NOT NULL UNIQUE CHECK (ingest_key_hash ~ '^[a-f0-9]{64}$'),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 536870912),
  content_sha256 TEXT NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'STORED'
    CHECK (status IN ('STORED','PROCESSING','AVAILABLE','FAILED','PURGED')),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  retention_until TIMESTAMPTZ NOT NULL,
  legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ended_at >= started_at),
  CHECK (retention_until > created_at),
  CHECK (
    (purpose='ASSESSMENT_INTEGRITY' AND attempt_id IS NOT NULL AND interview_request_id IS NULL AND tenant_id IS NULL) OR
    (purpose='INTERVIEW' AND attempt_id IS NULL AND interview_request_id IS NOT NULL AND tenant_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS recording_assets_attempt_idx
  ON recording_assets(attempt_id,created_at DESC) WHERE attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS recording_assets_interview_idx
  ON recording_assets(tenant_id,interview_request_id,created_at DESC)
  WHERE interview_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS recording_assets_retention_idx
  ON recording_assets(retention_until,status)
  WHERE legal_hold=FALSE AND status<>'PURGED';

CREATE TABLE IF NOT EXISTS written_scoring_assistance (
  assistance_id TEXT PRIMARY KEY
    CHECK (assistance_id ~ '^scoring_assist_[A-Za-z0-9_-]{24}$'),
  review_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  provider_key TEXT NOT NULL CHECK (char_length(provider_key) BETWEEN 2 AND 80),
  model_reference TEXT NOT NULL CHECK (char_length(model_reference) BETWEEN 2 AND 160),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  suggestion_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'GENERATED'
    CHECK (status IN ('GENERATED','ACCEPTED_AS_GUIDANCE','REJECTED','STALE')),
  reviewer_account_id TEXT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  reviewer_reason TEXT NULL CHECK (reviewer_reason IS NULL OR char_length(trim(reviewer_reason)) BETWEEN 5 AND 2000),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMPTZ NULL,
  CHECK (
    (status='GENERATED' AND reviewer_account_id IS NULL AND reviewer_reason IS NULL AND reviewed_at IS NULL) OR
    (status<>'GENERATED' AND reviewer_account_id IS NOT NULL AND reviewer_reason IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS written_scoring_assistance_review_idx
  ON written_scoring_assistance(review_id,generated_at DESC);

CREATE TABLE IF NOT EXISTS assessor_assignment_profiles (
  assessor_account_id TEXT PRIMARY KEY REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  trade_scopes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(trade_scopes)='array'),
  qualification_scopes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(qualification_scopes)='array'),
  languages JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(languages)='array'),
  jurisdictions JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(jurisdictions)='array'),
  risk_levels JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(risk_levels)='array'),
  availability_json JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(availability_json)='object'),
  max_active_interviews INTEGER NOT NULL DEFAULT 8 CHECK (max_active_interviews BETWEEN 1 AND 100),
  profile_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (profile_status IN ('ACTIVE','PAUSED')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS interview_assignment_conflicts (
  conflict_id TEXT PRIMARY KEY CHECK (conflict_id ~ '^interview_conflict_[A-Za-z0-9_-]{24}$'),
  assessor_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  worker_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (char_length(trim(reason)) BETWEEN 5 AND 2000),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMPTZ NULL,
  CHECK ((active AND ended_at IS NULL) OR (NOT active AND ended_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS interview_assignment_conflict_lookup
  ON interview_assignment_conflicts(assessor_account_id,worker_account_id,active);

ALTER TABLE interview_requests
  ADD COLUMN IF NOT EXISTS trade_scope TEXT NULL,
  ADD COLUMN IF NOT EXISTS qualification_scope TEXT NULL,
  ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'STANDARD'
    CHECK (risk_level IN ('STANDARD','HIGH','CRITICAL')),
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'English',
  ADD COLUMN IF NOT EXISTS jurisdiction TEXT NOT NULL DEFAULT 'GLOBAL',
  ADD COLUMN IF NOT EXISTS recording_policy TEXT NOT NULL DEFAULT 'NOTES_ONLY'
    CHECK (recording_policy IN ('VIDEO_AUDIO','AUDIO_ONLY','NOTES_ONLY','PROHIBITED')),
  ADD COLUMN IF NOT EXISTS recording_retention_days INTEGER NOT NULL DEFAULT 30
    CHECK (recording_retention_days BETWEEN 1 AND 3650),
  ADD COLUMN IF NOT EXISTS recording_consent_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS recording_consented_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS no_show_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS technical_issue TEXT NULL
    CHECK (technical_issue IS NULL OR char_length(technical_issue) <= 2000);

CREATE TABLE IF NOT EXISTS interview_assignment_decisions (
  assignment_decision_id TEXT PRIMARY KEY
    CHECK (assignment_decision_id ~ '^interview_assignment_[A-Za-z0-9_-]{24}$'),
  interview_request_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  assessor_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  selected BOOLEAN NOT NULL,
  eligibility_json JSONB NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 1000),
  rationale TEXT NOT NULL CHECK (char_length(trim(rationale)) BETWEEN 5 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id,interview_request_id)
    REFERENCES interview_requests(tenant_id,interview_request_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS interview_assignment_decisions_request_idx
  ON interview_assignment_decisions(tenant_id,interview_request_id,selected,score DESC);

CREATE TABLE IF NOT EXISTS interview_runtime_sessions (
  interview_session_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  interview_request_id TEXT NOT NULL,
  worker_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  assessor_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'CLAIMED'
    CHECK (status IN ('CLAIMED','WAITING_ROOM','READY','ADMITTED','ACTIVE','PAUSED','ENDED','NO_SHOW','TECHNICAL_HOLD')),
  claimed_at TIMESTAMPTZ NULL,
  worker_ready_at TIMESTAMPTZ NULL,
  admitted_at TIMESTAMPTZ NULL,
  started_at TIMESTAMPTZ NULL,
  pause_reason TEXT NULL CHECK (pause_reason IS NULL OR char_length(pause_reason) BETWEEN 5 AND 2000),
  paused_at TIMESTAMPTZ NULL,
  ended_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id,interview_request_id),
  FOREIGN KEY (tenant_id,interview_request_id)
    REFERENCES interview_requests(tenant_id,interview_request_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS interview_runtime_events (
  event_id TEXT PRIMARY KEY CHECK (event_id ~ '^interview_event_[A-Za-z0-9_-]{24}$'),
  interview_session_id TEXT NOT NULL REFERENCES interview_runtime_sessions(interview_session_id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'CLAIMED','WORKER_READY','ADMITTED','STARTED','PAUSED','RESUMED',
    'TECHNICAL_ISSUE','NO_SHOW','ENDED','RECORDING_STARTED','RECORDING_STOPPED'
  )),
  actor_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  reason TEXT NULL CHECK (reason IS NULL OR char_length(reason) <= 2000),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS interview_runtime_events_session_idx
  ON interview_runtime_events(interview_session_id,occurred_at,event_id);

CREATE TABLE IF NOT EXISTS interview_question_sets (
  question_set_id TEXT PRIMARY KEY CHECK (question_set_id ~ '^interview_questions_[A-Za-z0-9_-]{24}$'),
  tenant_id TEXT NOT NULL,
  interview_request_id TEXT NOT NULL,
  version_no INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  source_context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  questions_json JSONB NOT NULL CHECK (jsonb_typeof(questions_json)='array'),
  created_by_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id,interview_request_id,version_no),
  FOREIGN KEY (tenant_id,interview_request_id)
    REFERENCES interview_requests(tenant_id,interview_request_id) ON DELETE RESTRICT
);
