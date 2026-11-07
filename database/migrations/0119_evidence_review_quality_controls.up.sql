CREATE TABLE reviewer_capacity_locks(account_id TEXT PRIMARY KEY REFERENCES auth_accounts(account_id) ON DELETE RESTRICT);
INSERT INTO reviewer_capacity_locks(account_id) SELECT account_id FROM auth_accounts;
CREATE FUNCTION hse_review_capacity_account_insert() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN INSERT INTO reviewer_capacity_locks(account_id) VALUES(NEW.account_id); RETURN NEW; END;$$;
CREATE TRIGGER review_capacity_account_insert AFTER INSERT ON auth_accounts FOR EACH ROW EXECUTE FUNCTION hse_review_capacity_account_insert();
-- Operational capacity is explicit and adjustable; it is not a competency or risk threshold.
CREATE TABLE reviewer_capacity_revisions (
 capacity_id TEXT PRIMARY KEY CHECK(capacity_id ~ '^review_capacity_[A-Za-z0-9_-]{24}$'),
 capacity_sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
 account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
 max_open_reviews INTEGER NOT NULL CHECK(max_open_reviews BETWEEN 1 AND 250),
 reason TEXT NOT NULL CHECK(char_length(trim(reason)) BETWEEN 5 AND 2000),
 recorded_by_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX reviewer_capacity_current_idx ON reviewer_capacity_revisions(account_id,capacity_sequence DESC);
CREATE TABLE review_quality_defaults (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
 max_open_reviews INTEGER NOT NULL DEFAULT 25 CHECK(max_open_reviews BETWEEN 1 AND 250)
);
INSERT INTO review_quality_defaults(singleton,max_open_reviews) VALUES(TRUE,25);

CREATE TABLE evidence_review_quality_requirements (
 requirement_id TEXT PRIMARY KEY CHECK(requirement_id ~ '^quality_requirement_[A-Za-z0-9_-]{24}$'),
 task_id TEXT NOT NULL UNIQUE REFERENCES evidence_review_tasks(task_id) ON DELETE RESTRICT,
 source_version_id TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(char_length(trim(reason)) BETWEEN 5 AND 2000),
 selected_by_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
 selected_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE evidence_review_quality_selections (
 task_id TEXT PRIMARY KEY REFERENCES evidence_review_tasks(task_id) ON DELETE RESTRICT,
 source_version_id TEXT NOT NULL,
 framework_version_id TEXT NOT NULL REFERENCES assurance_framework_revisions(framework_version_id) ON DELETE RESTRICT,
 policy_snapshot_id TEXT NULL REFERENCES assurance_case_policy_snapshots(snapshot_id) ON DELETE RESTRICT,
 required_by_policy BOOLEAN NOT NULL,
 sampling_percent INTEGER NOT NULL CHECK(sampling_percent BETWEEN 0 AND 100),
 sample_draw INTEGER NOT NULL CHECK(sample_draw BETWEEN 0 AND 99),
 sampled BOOLEAN NOT NULL,
 selected_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK(sampled=(sample_draw<sampling_percent))
);
CREATE TABLE evidence_review_quality_rounds (
 quality_review_id TEXT PRIMARY KEY CHECK(quality_review_id ~ '^quality_review_[A-Za-z0-9_-]{24}$'),
 task_id TEXT NOT NULL REFERENCES evidence_review_tasks(task_id) ON DELETE RESTRICT,
 source_version_id TEXT NOT NULL,
 framework_version_id TEXT NOT NULL REFERENCES assurance_framework_revisions(framework_version_id) ON DELETE RESTRICT,
 round_no INTEGER NOT NULL CHECK(round_no>0),
 verifier_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id) ON DELETE RESTRICT,
 outcome TEXT NOT NULL CHECK(outcome IN ('APPROVED','REJECTED','CHANGES_REQUESTED')),
 reason TEXT NOT NULL CHECK(char_length(trim(reason)) BETWEEN 5 AND 4000),
 confirm_trade BOOLEAN NOT NULL DEFAULT FALSE,
 assessor_visible BOOLEAN NOT NULL DEFAULT FALSE,
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(task_id,round_no),
 UNIQUE(task_id,verifier_account_id)
);
CREATE INDEX evidence_review_quality_rounds_actor_idx ON evidence_review_quality_rounds(verifier_account_id,task_id);
CREATE FUNCTION hse_review_quality_history_locked() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Review quality and conflict history is append-only.' USING ERRCODE='55000'; END;$$;
CREATE TRIGGER reviewer_capacity_history_locked BEFORE UPDATE OR DELETE ON reviewer_capacity_revisions FOR EACH ROW EXECUTE FUNCTION hse_review_quality_history_locked();
CREATE TRIGGER evidence_review_quality_requirement_locked BEFORE UPDATE OR DELETE ON evidence_review_quality_requirements FOR EACH ROW EXECUTE FUNCTION hse_review_quality_history_locked();
CREATE TRIGGER evidence_review_quality_selection_locked BEFORE UPDATE OR DELETE ON evidence_review_quality_selections FOR EACH ROW EXECUTE FUNCTION hse_review_quality_history_locked();
CREATE TRIGGER evidence_review_quality_round_locked BEFORE UPDATE OR DELETE ON evidence_review_quality_rounds FOR EACH ROW EXECUTE FUNCTION hse_review_quality_history_locked();
CREATE TRIGGER scoring_conflict_history_locked BEFORE UPDATE OR DELETE ON scoring_conflict_declarations FOR EACH ROW EXECUTE FUNCTION hse_review_quality_history_locked();

CREATE FUNCTION platform_reviewer_open_reviews(p_account TEXT) RETURNS INTEGER LANGUAGE sql STABLE AS $$
 SELECT ((SELECT COUNT(*) FROM evidence_review_tasks WHERE assigned_verifier_account_id=p_account AND task_status='ASSIGNED')+
 (SELECT COUNT(*) FROM written_score_reviews review JOIN assurance_cases cases ON cases.case_id=review.case_id AND cases.assessment_reference=review.attempt_id AND cases.closed_at IS NULL
 WHERE review.reviewer_account_id=p_account AND review.status='DRAFT' AND NOT EXISTS(SELECT 1 FROM scoring_conflict_declarations conflict WHERE conflict.review_id=review.review_id AND conflict.reviewer_account_id=p_account)))::integer;
$$;
CREATE FUNCTION platform_reviewer_capacity_limit(p_account TEXT) RETURNS INTEGER LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT max_open_reviews FROM reviewer_capacity_revisions WHERE account_id=p_account ORDER BY capacity_sequence DESC LIMIT 1),(SELECT max_open_reviews FROM review_quality_defaults WHERE singleton=TRUE));
$$;
