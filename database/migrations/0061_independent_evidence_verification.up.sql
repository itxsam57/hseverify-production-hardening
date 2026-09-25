-- Independent Worker evidence verification queue.
-- Review tasks may now be platform-scoped (no Company tenant/case) or Assurance Case scoped.
-- This closes the gap where a Worker could submit identity/qualification evidence but no Verifier
-- could ever receive it until a Company created an Assurance Case.

ALTER TABLE evidence_review_tasks
  ALTER COLUMN tenant_id DROP NOT NULL,
  ALTER COLUMN case_id DROP NOT NULL;

ALTER TABLE evidence_review_tasks
  DROP CONSTRAINT IF EXISTS evidence_review_tasks_scope_shape_check;

ALTER TABLE evidence_review_tasks
  ADD CONSTRAINT evidence_review_tasks_scope_shape_check CHECK (
    (tenant_id IS NULL AND case_id IS NULL)
    OR
    (tenant_id IS NOT NULL AND case_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS evidence_review_independent_version_unique_idx
  ON evidence_review_tasks (worker_account_id, evidence_kind, source_version_id)
  WHERE tenant_id IS NULL AND case_id IS NULL;

CREATE INDEX IF NOT EXISTS evidence_review_independent_queue_idx
  ON evidence_review_tasks (task_status, created_at, task_id)
  WHERE tenant_id IS NULL AND case_id IS NULL;
