-- Scheduling remains committed if derived notification work is temporarily unavailable.
DO $$
DECLARE item RECORD; old_check TEXT; original_checks JSONB:='[]'::jsonb;
BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('platform_audit_events','platform_audit_events_action_key_check','action_key','''interview.scheduled'', ''notification.interview.intent.recorded'', ''notification.interview.enqueue.deferred'', ''notification.interview.suppressed'''),
 ('platform_outbox_jobs','platform_outbox_jobs_job_type_check','job_type','''notification.interview.scheduled'''),
 ('platform_notifications','platform_notifications_notification_type_check','notification_type','''interview.scheduled'''),
 ('platform_notifications','platform_notifications_target_key_check','target_key','''interview.record'', ''company.assurance.case''')
 ) AS extensions(table_name,constraint_name,column_name,values_sql)
 LOOP
  SELECT pg_get_constraintdef(oid) INTO old_check FROM pg_constraint
   WHERE conrelid=item.table_name::regclass AND conname=item.constraint_name;
  IF old_check IS NULL THEN RAISE EXCEPTION 'Required notification constraint missing'; END IF;
  original_checks:=original_checks||jsonb_build_array(jsonb_build_object('table',item.table_name,
   'constraint',item.constraint_name,'definition',old_check));
  old_check:=regexp_replace(old_check,'^CHECK \((.*)\)$','\1');
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',item.table_name,item.constraint_name);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((%s) OR %I IN (%s))',
    item.table_name,item.constraint_name,old_check,item.column_name,item.values_sql);
 END LOOP;
 EXECUTE format('CREATE FUNCTION platform_interview_notification_rollback_constraints() RETURNS JSONB LANGUAGE sql IMMUTABLE AS %L',
  'SELECT '||quote_literal(original_checks::TEXT)||'::jsonb');
END;
$$;
ALTER TABLE interview_requests ADD COLUMN schedule_event_id TEXT NULL
 REFERENCES platform_audit_events(audit_event_id) ON DELETE RESTRICT;
CREATE INDEX platform_interview_notification_audit_idx
 ON platform_audit_events(action_key,target_reference,audit_sequence);

-- Every candidate is derived from the immutable event and its current scheduled revision.
CREATE FUNCTION platform_interview_notification_recipients(event_ref TEXT)
RETURNS TABLE(account_id TEXT,role TEXT,tenant_id TEXT,membership_id TEXT,target_key TEXT,target_reference TEXT)
LANGUAGE sql VOLATILE AS $$
 WITH current_schedule AS (
  SELECT requests.*,cases.order_id
  FROM platform_audit_events events
  JOIN interview_requests requests ON requests.schedule_event_id=events.audit_event_id
   AND requests.interview_request_id=events.target_reference
  JOIN assurance_cases cases ON cases.case_id=requests.case_id AND cases.tenant_id=requests.tenant_id
   AND cases.worker_account_id=requests.worker_account_id
  WHERE events.audit_event_id=event_ref AND events.action_key='interview.scheduled'
   AND events.outcome='succeeded' AND events.actor_role='assessor'
   AND events.actor_account_id=requests.assessor_account_id
   AND events.metadata->>'tenantRef'=requests.tenant_id
   AND events.metadata->>'caseRef'=requests.case_id
   AND events.metadata->>'workerRef'=requests.worker_account_id
   AND (events.metadata->>'scheduledAt')::timestamptz=requests.scheduled_at
   AND requests.status IN ('ASSIGNED','WAITING_ROOM') AND requests.scheduled_at IS NOT NULL
   AND requests.scheduled_at+INTERVAL '4 hours'>clock_timestamp()
 ), candidates AS (
  SELECT worker_account_id AS account_id,'worker'::TEXT AS role,NULL::TEXT AS tenant_id,
   NULL::TEXT AS membership_id,'interview.record'::TEXT AS target_key,interview_request_id AS target_reference
  FROM current_schedule
  UNION ALL
  SELECT assessor_account_id,'assessor',NULL,NULL,'interview.record',interview_request_id FROM current_schedule
  UNION ALL
  SELECT memberships.account_id,'company',memberships.tenant_id,memberships.membership_id,
   'company.assurance.case',current_schedule.order_id || '#' || current_schedule.case_id
  FROM current_schedule JOIN auth_tenant_memberships memberships ON memberships.tenant_id=current_schedule.tenant_id
  JOIN platform_tenants tenants ON tenants.tenant_id=memberships.tenant_id
  JOIN auth_tenant_role_permission_ceiling ceiling ON ceiling.membership_role=memberships.membership_role
   AND ceiling.permission_key='company.orders.read'
  WHERE memberships.portal_role='company' AND memberships.membership_status='active'
   AND tenants.tenant_status='active'
   AND NOT EXISTS (SELECT 1 FROM auth_tenant_permission_overrides overrides
    WHERE overrides.membership_id=memberships.membership_id
     AND overrides.permission_key='company.orders.read' AND overrides.effect='deny')
 )
 SELECT candidates.* FROM candidates JOIN auth_accounts accounts USING(account_id)
 JOIN auth_account_roles roles ON roles.account_id=candidates.account_id AND roles.role=candidates.role
 WHERE accounts.account_status='active'
$$;

CREATE FUNCTION platform_enqueue_interview_notifications(event_ref TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE source_event platform_audit_events%ROWTYPE; recipient RECORD; dedup_key TEXT; queued_job TEXT;
 count_queued INTEGER:=0; eligible_count INTEGER:=0;
BEGIN
 SELECT * INTO source_event FROM platform_audit_events WHERE audit_event_id=event_ref FOR UPDATE;
 IF NOT FOUND OR source_event.action_key<>'interview.scheduled' OR source_event.outcome<>'succeeded'
  OR source_event.actor_role<>'assessor' THEN RAISE EXCEPTION 'Invalid scheduling source'; END IF;
 IF EXISTS(SELECT 1 FROM platform_audit_events WHERE action_key='notification.interview.intent.recorded'
  AND target_reference=event_ref) THEN RETURN 0; END IF;
 FOR recipient IN SELECT * FROM platform_interview_notification_recipients(event_ref)
 LOOP
  eligible_count:=eligible_count+1;
  dedup_key:=encode(sha256(convert_to('notification.interview.scheduled:'||event_ref||':'||
   recipient.account_id||':'||recipient.role||':'||coalesce(recipient.membership_id,'platform'),'UTF8')),'hex');
  queued_job:=NULL;
  INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,
    enqueued_by_account_id,enqueued_by_role,tenant_id,membership_id)
  VALUES('job_'||substr(dedup_key,1,24),'notification.interview.scheduled',1,dedup_key,
   jsonb_build_object('eventRef',event_ref,'recipientRef',recipient.account_id,'recipientRole',recipient.role,
    'membershipRef',recipient.membership_id),source_event.actor_account_id,'assessor',NULL,NULL)
  ON CONFLICT(job_type,idempotency_key) DO NOTHING RETURNING job_id INTO queued_job;
  IF queued_job IS NOT NULL THEN
   count_queued:=count_queued+1;
   INSERT INTO platform_audit_events(audit_event_id,source_kind,actor_account_id,actor_role,
     action_key,outcome,target_type,target_reference,metadata)
   VALUES('audit_'||queued_job,'native',source_event.actor_account_id,'assessor','outbox.job.enqueued',
    'succeeded','job',queued_job,jsonb_build_object('jobType','notification.interview.scheduled','sourceEventRef',event_ref));
  END IF;
 END LOOP;
 INSERT INTO platform_audit_events(audit_event_id,source_kind,actor_account_id,actor_role,
   action_key,outcome,target_type,target_reference,metadata)
 VALUES('audit_'||encode(sha256(convert_to('interview-intent:'||event_ref,'UTF8')),'hex'),'native',
  source_event.actor_account_id,'assessor','notification.interview.intent.recorded','succeeded','resource',event_ref,
  jsonb_build_object('eligibleRecipients',eligible_count,'suppressed',eligible_count=0));
 RETURN count_queued;
EXCEPTION WHEN OTHERS THEN
 -- This handler rolls back the entire recipient set and completion marker, not the source operation.
 BEGIN
  INSERT INTO platform_audit_events(audit_event_id,source_kind,actor_account_id,actor_role,
    action_key,outcome,target_type,target_reference,metadata)
  SELECT 'audit_'||encode(sha256(convert_to(event_ref||clock_timestamp()::TEXT,'UTF8')),'hex'),
   'native',actor_account_id,actor_role,'notification.interview.enqueue.deferred','failed','resource',event_ref,
   jsonb_build_object('reason','notification_enqueue_unavailable')
  FROM platform_audit_events WHERE audit_event_id=event_ref AND action_key='interview.scheduled';
 EXCEPTION WHEN OTHERS THEN NULL; END;
 RETURN -1;
END;
$$;

-- Preserve the established foundation/security validator for every existing type.
DROP TRIGGER platform_notifications_validate_insert ON platform_notifications;
CREATE TRIGGER platform_notifications_validate_insert BEFORE INSERT ON platform_notifications
 FOR EACH ROW WHEN (NEW.notification_type<>'interview.scheduled')
 EXECUTE FUNCTION platform_notification_validate_projection();

CREATE FUNCTION platform_interview_notification_validate_projection()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE job platform_outbox_jobs%ROWTYPE; source_event platform_audit_events%ROWTYPE; recipient RECORD;
BEGIN
 SELECT * INTO job FROM platform_outbox_jobs WHERE job_id=NEW.source_job_id;
 IF NOT FOUND OR job.job_type<>'notification.interview.scheduled' OR job.schema_version<>1
  OR job.enqueued_by_role<>'assessor' OR job.enqueued_system_component IS NOT NULL
  OR job.tenant_id IS NOT NULL OR job.membership_id IS NOT NULL
  OR jsonb_typeof(job.payload)<>'object'
  OR job.payload - ARRAY['eventRef','recipientRef','recipientRole','membershipRef'] <> '{}'::jsonb
  OR NOT (job.payload ?& ARRAY['eventRef','recipientRef','recipientRole','membershipRef'])
 THEN RAISE EXCEPTION 'Invalid interview notification source job' USING ERRCODE='23514'; END IF;
 SELECT * INTO source_event FROM platform_audit_events WHERE audit_event_id=job.payload->>'eventRef';
 IF NOT FOUND OR source_event.action_key<>'interview.scheduled' OR source_event.outcome<>'succeeded'
  OR source_event.actor_role<>'assessor'
  OR source_event.actor_account_id IS DISTINCT FROM job.enqueued_by_account_id
 THEN RAISE EXCEPTION 'Invalid interview notification source event' USING ERRCODE='23514'; END IF;
 SELECT * INTO recipient FROM platform_interview_notification_recipients(source_event.audit_event_id)
 WHERE account_id=job.payload->>'recipientRef' AND role=job.payload->>'recipientRole'
  AND membership_id IS NOT DISTINCT FROM job.payload->>'membershipRef';
 IF NOT FOUND OR NEW.recipient_account_id IS DISTINCT FROM recipient.account_id
  OR NEW.recipient_role IS DISTINCT FROM recipient.role OR NEW.tenant_id IS DISTINCT FROM recipient.tenant_id
  OR NEW.membership_id IS DISTINCT FROM recipient.membership_id
  OR NEW.target_key IS DISTINCT FROM recipient.target_key OR NEW.target_reference IS DISTINCT FROM recipient.target_reference
  OR NEW.notification_type<>'interview.scheduled' OR NEW.schema_version<>1
  OR NEW.title<>'Interview scheduled'
  OR NEW.body<>'An interview has been scheduled. Open the record for the current time and preparation details.'
  OR NEW.metadata IS DISTINCT FROM jsonb_build_object('eventRef',source_event.audit_event_id)
  OR NEW.read_at IS NOT NULL
 THEN RAISE EXCEPTION 'Interview notification does not match its authorized source' USING ERRCODE='23514'; END IF;
 NEW.created_at:=CURRENT_TIMESTAMP;NEW.updated_at:=NEW.created_at;RETURN NEW;
END;
$$;
CREATE TRIGGER platform_interview_notifications_validate_insert BEFORE INSERT ON platform_notifications
 FOR EACH ROW WHEN (NEW.notification_type='interview.scheduled')
 EXECUTE FUNCTION platform_interview_notification_validate_projection();

CREATE FUNCTION platform_project_interview_notification(job_ref TEXT)
RETURNS TABLE(created BOOLEAN,suppressed BOOLEAN) LANGUAGE plpgsql AS $$
DECLARE job platform_outbox_jobs%ROWTYPE; recipient RECORD; projected_id TEXT; projection_ref TEXT;
BEGIN
 SELECT * INTO job FROM platform_outbox_jobs WHERE job_id=job_ref;
 IF NOT FOUND OR job.job_type<>'notification.interview.scheduled' THEN
  RAISE EXCEPTION 'Invalid interview notification job' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM platform_notifications WHERE source_job_id=job_ref) THEN RETURN QUERY SELECT FALSE,FALSE;RETURN;END IF;
 SELECT * INTO recipient FROM platform_interview_notification_recipients(job.payload->>'eventRef')
 WHERE account_id=job.payload->>'recipientRef' AND role=job.payload->>'recipientRole'
  AND membership_id IS NOT DISTINCT FROM job.payload->>'membershipRef';
 IF NOT FOUND THEN RETURN QUERY SELECT FALSE,TRUE;RETURN;END IF;
 projection_ref:=encode(sha256(convert_to(job_ref||':interview.scheduled:'||recipient.account_id||':'||
  recipient.role||':'||coalesce(recipient.tenant_id,'platform'),'UTF8')),'hex');
 INSERT INTO platform_notifications(notification_id,notification_type,schema_version,source_job_id,projection_key,
  recipient_account_id,recipient_role,tenant_id,membership_id,title,body,metadata,target_key,target_reference)
 VALUES('notification_'||substr(projection_ref,1,24),'interview.scheduled',1,job_ref,projection_ref,recipient.account_id,
  recipient.role,recipient.tenant_id,recipient.membership_id,'Interview scheduled',
  'An interview has been scheduled. Open the record for the current time and preparation details.',
  jsonb_build_object('eventRef',job.payload->>'eventRef'),recipient.target_key,recipient.target_reference)
 ON CONFLICT(projection_key) DO NOTHING RETURNING notification_id INTO projected_id;
 RETURN QUERY SELECT projected_id IS NOT NULL,FALSE;
END;
$$;
