-- Retain accepted automatic submissions, scheduled jobs and truthful system timelines.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM assessment_attempts WHERE status='AUTO_SUBMITTED')
     OR EXISTS (SELECT 1 FROM platform_outbox_jobs WHERE job_type='assessment.attempt.expiry')
     OR EXISTS (SELECT 1 FROM assurance_case_timeline_events WHERE actor_role='system') THEN
    RAISE EXCEPTION 'Cannot remove accepted assessment expiry history.';
  END IF;
END;
$$;
DROP TRIGGER assessment_expiry_origin_immutable ON platform_outbox_jobs;
DROP FUNCTION reject_assessment_expiry_origin_mutation();
ALTER TABLE platform_outbox_jobs DROP CONSTRAINT platform_outbox_enqueue_origin;
ALTER TABLE platform_outbox_jobs DROP COLUMN enqueued_system_component;
ALTER TABLE platform_outbox_jobs ALTER COLUMN enqueued_by_account_id SET NOT NULL;
ALTER TABLE platform_outbox_jobs ALTER COLUMN enqueued_by_role SET NOT NULL;

DO $$
DECLARE item RECORD; old_check TEXT;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('platform_outbox_jobs','platform_outbox_jobs_job_type_check','job_type','assessment.attempt.expiry'),
    ('platform_audit_events','platform_audit_events_action_key_check','action_key','assessment.section.auto_submitted'),
    ('assessment_attempts','assessment_attempts_status_check','status','AUTO_SUBMITTED'),
    ('assurance_case_timeline_events','assurance_case_timeline_events_actor_role_check','actor_role','system')
  ) AS extensions(table_name,constraint_name,column_name,value)
  LOOP
    SELECT pg_get_constraintdef(oid) INTO old_check FROM pg_constraint
      WHERE conrelid=item.table_name::regclass AND conname=item.constraint_name;
    old_check := regexp_replace(old_check, '^CHECK \((.*)\)$', '\1');
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',item.table_name,item.constraint_name);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((%s) AND %I<>%L)',
      item.table_name,item.constraint_name,old_check,item.column_name,item.value);
  END LOOP;
END;
$$;
ALTER TABLE assessment_attempts DROP CONSTRAINT assessment_attempts_completion_state_check;
ALTER TABLE assessment_attempts ADD CONSTRAINT assessment_attempts_completion_state_check CHECK (
  (status IN ('IN_PROGRESS','INTERRUPTED','REVIEW_REQUIRED','INVALIDATED','REPLACED') AND submitted_at IS NULL) OR
  (status='SUBMITTED' AND submitted_at IS NOT NULL AND current_position=question_count)
);
