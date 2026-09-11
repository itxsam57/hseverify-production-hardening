-- M2.02 Evidence Verification Queues.
-- Cross-brick case, Worker, identity, evidence and secure-file references remain opaque.
-- Live services revalidate them so retained review history cannot block lower-brick rollback.

CREATE TABLE IF NOT EXISTS supervisor_observations (
  observation_id TEXT PRIMARY KEY CHECK (observation_id ~ '^supervisor_observation_[A-Za-z0-9_-]{24}$'),
  tenant_id TEXT NOT NULL CHECK (tenant_id ~ '^tenant_[A-Za-z0-9_-]{24}$'),
  case_id TEXT NOT NULL CHECK (case_id ~ '^assurance_case_[A-Za-z0-9_-]{24}$'),
  worker_account_id TEXT NOT NULL CHECK (char_length(worker_account_id) BETWEEN 8 AND 160),
  competency_reference TEXT NOT NULL CHECK (char_length(competency_reference) BETWEEN 2 AND 160),
  observer_membership_id TEXT NOT NULL CHECK (char_length(observer_membership_id) BETWEEN 8 AND 160),
  observed_at TIMESTAMPTZ NOT NULL,
  observation_text TEXT NOT NULL CHECK (char_length(observation_text) BETWEEN 20 AND 6000),
  outcome TEXT NOT NULL CHECK (outcome IN ('demonstrated','partially_demonstrated','not_demonstrated')),
  observation_status TEXT NOT NULL DEFAULT 'submitted' CHECK (observation_status IN ('submitted','superseded')),
  supersedes_observation_id TEXT NULL CHECK (supersedes_observation_id IS NULL OR supersedes_observation_id ~ '^supervisor_observation_[A-Za-z0-9_-]{24}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TIMESTAMPTZ NULL,
  CHECK ((observation_status='submitted' AND superseded_at IS NULL) OR (observation_status='superseded' AND superseded_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS supervisor_observations_case_idx ON supervisor_observations(tenant_id,case_id,worker_account_id,created_at DESC);

CREATE TABLE IF NOT EXISTS evidence_review_tasks (
  task_id TEXT PRIMARY KEY CHECK (task_id ~ '^evidence_review_[A-Za-z0-9_-]{24}$'),
  tenant_id TEXT NOT NULL CHECK (tenant_id ~ '^tenant_[A-Za-z0-9_-]{24}$'),
  case_id TEXT NOT NULL CHECK (case_id ~ '^assurance_case_[A-Za-z0-9_-]{24}$'),
  worker_account_id TEXT NOT NULL CHECK (char_length(worker_account_id) BETWEEN 8 AND 160),
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('identity','qualification','experience','employment','skill','supervisor_observation')),
  source_record_id TEXT NOT NULL CHECK (char_length(source_record_id) BETWEEN 8 AND 180),
  source_version_id TEXT NOT NULL CHECK (char_length(source_version_id) BETWEEN 8 AND 180),
  secure_file_id TEXT NULL CHECK (secure_file_id IS NULL OR secure_file_id ~ '^secure_file_[A-Za-z0-9_-]{24}$'),
  evidence_label TEXT NOT NULL CHECK (char_length(evidence_label) BETWEEN 1 AND 240),
  task_status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (task_status IN ('QUEUED','ASSIGNED','APPROVED','REJECTED','CHANGES_REQUESTED','SUPERSEDED','CANCELLED')),
  assigned_verifier_account_id TEXT NULL CHECK (assigned_verifier_account_id IS NULL OR char_length(assigned_verifier_account_id) BETWEEN 8 AND 160),
  claimed_at TIMESTAMPTZ NULL,
  decided_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((task_status='QUEUED' AND assigned_verifier_account_id IS NULL AND claimed_at IS NULL AND decided_at IS NULL)
      OR (task_status='ASSIGNED' AND assigned_verifier_account_id IS NOT NULL AND claimed_at IS NOT NULL AND decided_at IS NULL)
      OR (task_status IN ('APPROVED','REJECTED','CHANGES_REQUESTED') AND assigned_verifier_account_id IS NOT NULL AND claimed_at IS NOT NULL AND decided_at IS NOT NULL)
      OR task_status IN ('SUPERSEDED','CANCELLED')),
  UNIQUE(case_id,evidence_kind,source_version_id)
);
CREATE INDEX IF NOT EXISTS evidence_review_queue_idx ON evidence_review_tasks(task_status,created_at,task_id);
CREATE INDEX IF NOT EXISTS evidence_review_assignee_idx ON evidence_review_tasks(assigned_verifier_account_id,task_status,updated_at DESC);

CREATE TABLE IF NOT EXISTS evidence_review_conflicts (
  conflict_id TEXT PRIMARY KEY CHECK (conflict_id ~ '^review_conflict_[A-Za-z0-9_-]{24}$'),
  task_id TEXT NOT NULL CHECK (task_id ~ '^evidence_review_[A-Za-z0-9_-]{24}$'),
  verifier_account_id TEXT NOT NULL CHECK (char_length(verifier_account_id) BETWEEN 8 AND 160),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 4000),
  declared_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(task_id,verifier_account_id)
);

CREATE TABLE IF NOT EXISTS evidence_review_decisions (
  decision_id TEXT PRIMARY KEY CHECK (decision_id ~ '^review_decision_[A-Za-z0-9_-]{24}$'),
  task_id TEXT NOT NULL UNIQUE CHECK (task_id ~ '^evidence_review_[A-Za-z0-9_-]{24}$'),
  source_version_id TEXT NOT NULL CHECK (char_length(source_version_id) BETWEEN 8 AND 180),
  verifier_account_id TEXT NOT NULL CHECK (char_length(verifier_account_id) BETWEEN 8 AND 160),
  outcome TEXT NOT NULL CHECK (outcome IN ('APPROVED','REJECTED','CHANGES_REQUESTED')),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 4000),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION hse_evidence_review_history_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Evidence review conflict/decision history is append-only.' USING ERRCODE='55000';
END; $$;
DROP TRIGGER IF EXISTS evidence_review_decisions_append_only ON evidence_review_decisions;
CREATE TRIGGER evidence_review_decisions_append_only BEFORE UPDATE OR DELETE ON evidence_review_decisions FOR EACH ROW EXECUTE FUNCTION hse_evidence_review_history_append_only();
DROP TRIGGER IF EXISTS evidence_review_conflicts_append_only ON evidence_review_conflicts;
CREATE TRIGGER evidence_review_conflicts_append_only BEFORE UPDATE OR DELETE ON evidence_review_conflicts FOR EACH ROW EXECUTE FUNCTION hse_evidence_review_history_append_only();
