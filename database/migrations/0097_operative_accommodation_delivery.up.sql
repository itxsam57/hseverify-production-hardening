CREATE TABLE assessment_attempt_accommodations(
 attempt_id TEXT PRIMARY KEY REFERENCES assessment_attempts(attempt_id) ON DELETE RESTRICT,
 case_id TEXT NOT NULL REFERENCES assurance_cases(case_id) ON DELETE RESTRICT,
 worker_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
 accommodation_ids JSONB NOT NULL CHECK(jsonb_typeof(accommodation_ids)='array'),
 extra_break_seconds INTEGER NOT NULL CHECK(extra_break_seconds BETWEEN 0 AND 3600),
 snapshotted_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE assessment_accommodation_breaks(
 break_id TEXT PRIMARY KEY CHECK(break_id ~ '^assessment_break_[A-Za-z0-9_-]{24}$'),
 attempt_id TEXT NOT NULL REFERENCES assessment_attempt_accommodations(attempt_id) ON DELETE RESTRICT,
 worker_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
 auth_session_id TEXT NOT NULL REFERENCES auth_sessions(session_id) ON DELETE RESTRICT,
 phase_index INTEGER NOT NULL CHECK(phase_index BETWEEN 0 AND 50),
 mutation_key TEXT NOT NULL CHECK(char_length(mutation_key) BETWEEN 16 AND 160),
 duration_seconds INTEGER NOT NULL CHECK(duration_seconds BETWEEN 1 AND 3600),
 started_at TIMESTAMPTZ NOT NULL,
 ends_at TIMESTAMPTZ NOT NULL CHECK(EXTRACT(EPOCH FROM ends_at-started_at)=duration_seconds),
 UNIQUE(attempt_id,mutation_key)
);
CREATE INDEX assessment_accommodation_breaks_attempt_idx ON assessment_accommodation_breaks(attempt_id,started_at);
CREATE TRIGGER assessment_accommodation_snapshot_immutable BEFORE UPDATE OR DELETE ON assessment_attempt_accommodations FOR EACH ROW EXECUTE FUNCTION reject_assessment_timing_mutation();
CREATE TRIGGER assessment_accommodation_break_immutable BEFORE UPDATE OR DELETE ON assessment_accommodation_breaks FOR EACH ROW EXECUTE FUNCTION reject_assessment_timing_mutation();

CREATE TABLE interview_accommodation_support_snapshots(
 interview_session_id TEXT PRIMARY KEY REFERENCES interview_runtime_sessions(interview_session_id) ON DELETE RESTRICT,
 interview_request_id TEXT NOT NULL REFERENCES interview_requests(interview_request_id) ON DELETE RESTRICT,
 case_id TEXT NOT NULL REFERENCES assurance_cases(case_id) ON DELETE RESTRICT,
 tenant_id TEXT NOT NULL REFERENCES platform_tenants(tenant_id) ON DELETE RESTRICT,
 worker_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
 assessor_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
 captions BOOLEAN NOT NULL,interpreter BOOLEAN NOT NULL,
 source_language TEXT NOT NULL CHECK(char_length(source_language) BETWEEN 1 AND 160),
 target_language TEXT NULL CHECK(target_language IS NULL OR char_length(target_language) BETWEEN 1 AND 160),
 accommodation_ids JSONB NOT NULL CHECK(jsonb_typeof(accommodation_ids)='array'),
 snapshotted_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE interview_accommodation_support_messages(
 message_id TEXT PRIMARY KEY CHECK(message_id ~ '^interview_support_[A-Za-z0-9_-]{24}$'),
 sequence_no BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
 interview_session_id TEXT NOT NULL REFERENCES interview_accommodation_support_snapshots(interview_session_id) ON DELETE RESTRICT,
 actor_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
 auth_session_id TEXT NOT NULL REFERENCES auth_sessions(session_id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind IN ('CAPTION','INTERPRETATION')),
 source_text TEXT NOT NULL CHECK(char_length(source_text) BETWEEN 2 AND 2000),
 translated_text TEXT NULL CHECK((kind='CAPTION' AND translated_text IS NULL) OR (kind='INTERPRETATION' AND char_length(translated_text) BETWEEN 2 AND 2000)),
 mutation_key TEXT NOT NULL CHECK(char_length(mutation_key) BETWEEN 16 AND 160),
 created_at TIMESTAMPTZ NOT NULL,
 UNIQUE(interview_session_id,mutation_key)
);
CREATE FUNCTION reject_interview_support_mutation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Interview accommodation support records are append-only'; END;
$$;
CREATE TRIGGER interview_support_snapshot_immutable BEFORE UPDATE OR DELETE ON interview_accommodation_support_snapshots FOR EACH ROW EXECUTE FUNCTION reject_interview_support_mutation();
CREATE TRIGGER interview_support_message_immutable BEFORE UPDATE OR DELETE ON interview_accommodation_support_messages FOR EACH ROW EXECUTE FUNCTION reject_interview_support_mutation();
