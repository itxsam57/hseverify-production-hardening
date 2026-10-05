-- Durable expiry intent and explicit automatic submission history.
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
    IF old_check IS NULL THEN RAISE EXCEPTION 'Required expiry constraint is missing'; END IF;
    old_check := regexp_replace(old_check, '^CHECK \((.*)\)$', '\1');
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',item.table_name,item.constraint_name);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((%s) OR %I=%L)',
      item.table_name,item.constraint_name,old_check,item.column_name,item.value);
  END LOOP;
END;
$$;
ALTER TABLE assessment_attempts DROP CONSTRAINT assessment_attempts_completion_state_check;
ALTER TABLE assessment_attempts ADD CONSTRAINT assessment_attempts_completion_state_check CHECK (
  (status IN ('IN_PROGRESS','INTERRUPTED','REVIEW_REQUIRED','INVALIDATED','REPLACED') AND submitted_at IS NULL) OR
  (status IN ('SUBMITTED','AUTO_SUBMITTED') AND submitted_at IS NOT NULL AND current_position=question_count)
);

-- Native reconciliation is a system action, never an invented Worker session.
ALTER TABLE platform_outbox_jobs ALTER COLUMN enqueued_by_account_id DROP NOT NULL;
ALTER TABLE platform_outbox_jobs ALTER COLUMN enqueued_by_role DROP NOT NULL;
ALTER TABLE platform_outbox_jobs ADD COLUMN enqueued_system_component TEXT NULL;
ALTER TABLE platform_outbox_jobs ADD CONSTRAINT platform_outbox_enqueue_origin CHECK (
  (enqueued_by_account_id IS NOT NULL AND enqueued_by_role IS NOT NULL AND enqueued_system_component IS NULL) OR
  (enqueued_by_account_id IS NULL AND enqueued_by_role IS NULL AND
   enqueued_system_component IS NOT NULL AND enqueued_system_component='outbox-worker' AND job_type='assessment.attempt.expiry' AND
   tenant_id IS NULL AND membership_id IS NULL)
);
CREATE FUNCTION reject_assessment_expiry_origin_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.enqueued_system_component,NEW.enqueued_by_account_id,NEW.enqueued_by_role)
     IS DISTINCT FROM ROW(OLD.enqueued_system_component,OLD.enqueued_by_account_id,OLD.enqueued_by_role) THEN
    RAISE EXCEPTION 'Outbox enqueue origin is immutable.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assessment_expiry_origin_immutable BEFORE UPDATE ON platform_outbox_jobs
  FOR EACH ROW EXECUTE FUNCTION reject_assessment_expiry_origin_mutation();

DO $$
DECLARE
  item RECORD; phase INTEGER; last_phase INTEGER; deadline TIMESTAMPTZ;
  deadline_text TEXT; business_key TEXT; dedup TEXT; inserted_job TEXT;
BEGIN
  FOR item IN
    SELECT attempts.attempt_id,policies.timing_mode,policies.phase_durations_json,
           latest.phase_index,latest.deadline_at
      FROM assessment_attempts attempts
      JOIN assessment_attempt_time_policies policies USING(attempt_id)
      JOIN LATERAL (
        SELECT phase_index,deadline_at FROM assessment_attempt_clocks
         WHERE attempt_id=attempts.attempt_id ORDER BY phase_index DESC LIMIT 1
      ) latest ON TRUE
     WHERE attempts.status IN ('IN_PROGRESS','INTERRUPTED')
  LOOP
    deadline := item.deadline_at;
    last_phase := CASE WHEN item.timing_mode='COMBINED' THEN 0
                       ELSE jsonb_array_length(item.phase_durations_json) END;
    FOR phase IN item.phase_index..last_phase LOOP
      IF phase<>item.phase_index THEN
        deadline := deadline + make_interval(secs => (item.phase_durations_json->>(phase-1))::integer);
      END IF;
      deadline_text := to_char(deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
      IF EXISTS (
        SELECT 1 FROM platform_outbox_jobs WHERE job_type='assessment.attempt.expiry'
          AND payload->>'attemptRef'=item.attempt_id
          AND payload->>'phaseIndex'=phase::text AND payload->>'deadlineAt'=deadline_text
      ) THEN CONTINUE; END IF;
      business_key := item.attempt_id || ':' || phase::text || ':' || deadline_text;
      dedup := encode(sha256(convert_to(
        'assessment.attempt.expiry:1:system:outbox-worker:' || business_key,'UTF8')),'hex');
      INSERT INTO platform_outbox_jobs(
        job_id,job_type,schema_version,idempotency_key,payload,
        enqueued_by_account_id,enqueued_by_role,enqueued_system_component,next_attempt_at
      ) VALUES('job_'||substring(dedup,1,24),'assessment.attempt.expiry',1,dedup,
        jsonb_build_object('attemptRef',item.attempt_id,'phaseIndex',phase,'deadlineAt',deadline_text),
        NULL,NULL,'outbox-worker',deadline)
      ON CONFLICT(job_type,idempotency_key) DO NOTHING RETURNING job_id INTO inserted_job;
      IF inserted_job IS NOT NULL THEN
        INSERT INTO platform_audit_events(
          audit_event_id,source_kind,actor_account_id,actor_role,action_key,outcome,
          target_type,target_reference,metadata
        ) VALUES('audit_'||substring(dedup,1,24),'native',NULL,NULL,'outbox.job.enqueued','succeeded',
          'job',inserted_job,jsonb_build_object(
            'systemComponent','outbox-worker','cause','assessment-expiry-migration','schemaVersion',1
          ));
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
