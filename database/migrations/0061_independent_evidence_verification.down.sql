-- Local/test rollback only. Independent review history is retained in normal operation.
-- Rollback is intentionally unavailable once platform-scoped tasks exist because accepted review
-- history must not be deleted to satisfy an older schema.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM evidence_review_tasks
    WHERE tenant_id IS NULL OR case_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot roll back independent evidence review support while platform-scoped review history exists.';
  END IF;
END $$;

DROP INDEX IF EXISTS evidence_review_independent_queue_idx;
DROP INDEX IF EXISTS evidence_review_independent_version_unique_idx;

ALTER TABLE evidence_review_tasks
  DROP CONSTRAINT IF EXISTS evidence_review_tasks_scope_shape_check;

ALTER TABLE evidence_review_tasks
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN case_id SET NOT NULL;
