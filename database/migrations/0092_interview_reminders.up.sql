-- Reuse the existing durable worker, recipient scope and email history for chosen reminders.
DO $$
DECLARE item RECORD; old_check TEXT; saved_constraints JSONB:='[]'::jsonb;
 saved_functions JSONB:='[]'::jsonb; saved_triggers JSONB:='[]'::jsonb; definition TEXT;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('platform_audit_events','platform_audit_events_action_key_check','action_key','''notification.interview.reminder.intent.recorded'', ''notification.interview.reminder.enqueue.deferred'', ''email.interview.reminder.intent.recorded'', ''email.interview.reminder.enqueue.deferred'''),
  ('platform_outbox_jobs','platform_outbox_jobs_job_type_check','job_type','''notification.interview.reminder'', ''email.interview.reminder'''),
  ('platform_notifications','platform_notifications_notification_type_check','notification_type','''interview.reminder'''),
  ('platform_email_deliveries','platform_email_deliveries_delivery_type_check','delivery_type','''interview.reminder''')
 ) AS extensions(table_name,constraint_name,column_name,values_sql)
 LOOP
  SELECT pg_get_constraintdef(oid) INTO old_check FROM pg_constraint
   WHERE conrelid=item.table_name::regclass AND conname=item.constraint_name;
  IF old_check IS NULL THEN RAISE EXCEPTION 'Required reminder constraint missing'; END IF;
  saved_constraints:=saved_constraints||jsonb_build_array(jsonb_build_object(
   'table',item.table_name,'constraint',item.constraint_name,'definition',old_check));
  old_check:=regexp_replace(old_check,'^CHECK \((.*)\)$','\1');
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',item.table_name,item.constraint_name);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((%s) OR %I IN (%s))',
   item.table_name,item.constraint_name,old_check,item.column_name,item.values_sql);
 END LOOP;
 FOR item IN SELECT unnest(ARRAY['platform_email_attempt_validate_insert()',
  'platform_email_attempt_guard_update()']) AS reference
 LOOP
  SELECT pg_get_functiondef(item.reference::regprocedure) INTO definition;
  saved_functions:=saved_functions||jsonb_build_array(jsonb_build_object(
   'reference',item.reference,'definition',definition));
  IF position('''interview.scheduled''' IN definition)=0 THEN
   RAISE EXCEPTION 'Expected fixed interview email attempt contract missing'; END IF;
  definition:=replace(definition,'''email.interview.scheduled''',
   '''email.interview.scheduled'',''email.interview.reminder''');
  definition:=replace(definition,'delivery.delivery_type = ''interview.scheduled''',
   'delivery.delivery_type IN (''interview.scheduled'',''interview.reminder'')');
  definition:=replace(definition,'deliveries.delivery_type=''interview.scheduled''',
   'deliveries.delivery_type IN (''interview.scheduled'',''interview.reminder'')');
  EXECUTE definition;
 END LOOP;
 FOR item IN SELECT tgname,pg_get_triggerdef(oid) AS definition FROM pg_trigger
  WHERE NOT tgisinternal AND tgname IN ('platform_notifications_validate_insert',
   'platform_email_deliveries_validate_insert','platform_email_deliveries_guard_update',
   'platform_interview_emails_guard_update')
 LOOP
  saved_triggers:=saved_triggers||jsonb_build_array(jsonb_build_object(
   'name',item.tgname,'definition',item.definition));
 END LOOP;
 IF jsonb_array_length(saved_triggers)<>4 THEN RAISE EXCEPTION 'Reminder parent triggers missing'; END IF;
 EXECUTE format('CREATE FUNCTION platform_interview_reminder_rollback_contract() RETURNS JSONB LANGUAGE sql IMMUTABLE AS %L',
  'SELECT '||quote_literal(jsonb_build_object('constraints',saved_constraints,
   'functions',saved_functions,'triggers',saved_triggers)::TEXT)||'::jsonb');
END;
$$;

CREATE FUNCTION platform_interview_reminder_recipients(event_ref TEXT)
RETURNS TABLE(account_id TEXT,role TEXT,tenant_id TEXT,membership_id TEXT,target_key TEXT,target_reference TEXT)
LANGUAGE sql VOLATILE AS $$
 SELECT eligible.* FROM platform_interview_notification_recipients(event_ref) eligible
 JOIN platform_audit_events source ON source.audit_event_id=event_ref
 JOIN interview_requests requests ON requests.interview_request_id=source.target_reference
  AND requests.schedule_event_id=source.audit_event_id
 JOIN assurance_cases cases ON cases.case_id=requests.case_id AND cases.tenant_id=requests.tenant_id
  AND cases.interview_reference=requests.interview_request_id AND cases.case_status='Interview pending'
 WHERE requests.reminder_at IS NOT NULL
  AND (source.metadata->>'reminderAt')::timestamptz=requests.reminder_at
  AND requests.reminder_at<requests.scheduled_at AND requests.scheduled_at>clock_timestamp()
  AND NOT EXISTS(SELECT 1 FROM interview_runtime_sessions runtime
   WHERE runtime.interview_request_id=requests.interview_request_id
    AND runtime.status IN ('ACTIVE','PAUSED','ENDED','NO_SHOW','TECHNICAL_HOLD'))
$$;

CREATE FUNCTION platform_enqueue_interview_reminder_notifications(event_ref TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE source_event platform_audit_events%ROWTYPE; recipient RECORD; dedup_key TEXT; queued_job TEXT;
 count_queued INTEGER:=0; eligible_count INTEGER:=0; reminder_due TIMESTAMPTZ;
BEGIN
 SELECT * INTO source_event FROM platform_audit_events WHERE audit_event_id=event_ref FOR UPDATE;
 IF NOT FOUND OR source_event.action_key<>'interview.scheduled' OR source_event.outcome<>'succeeded'
  OR source_event.actor_role<>'assessor' THEN RAISE EXCEPTION 'Invalid scheduling source'; END IF;
 reminder_due:=(source_event.metadata->>'reminderAt')::timestamptz;
 IF reminder_due IS NULL THEN RETURN 0; END IF;
 IF EXISTS(SELECT 1 FROM platform_audit_events WHERE action_key='notification.interview.reminder.intent.recorded'
  AND target_reference=event_ref) THEN RETURN 0; END IF;
 FOR recipient IN SELECT * FROM platform_interview_reminder_recipients(event_ref)
 LOOP
  eligible_count:=eligible_count+1;
  dedup_key:=encode(sha256(convert_to('notification.interview.reminder:'||event_ref||':'||
   recipient.account_id||':'||recipient.role||':'||coalesce(recipient.membership_id,'platform'),'UTF8')),'hex');
  queued_job:=NULL;
  INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,
    enqueued_by_account_id,enqueued_by_role,tenant_id,membership_id,next_attempt_at)
  VALUES('job_'||substr(dedup_key,1,24),'notification.interview.reminder',1,dedup_key,
   jsonb_build_object('eventRef',event_ref,'recipientRef',recipient.account_id,'recipientRole',recipient.role,
    'membershipRef',recipient.membership_id),source_event.actor_account_id,'assessor',NULL,NULL,reminder_due)
  ON CONFLICT(job_type,idempotency_key) DO NOTHING RETURNING job_id INTO queued_job;
  IF queued_job IS NOT NULL THEN
   count_queued:=count_queued+1;
   INSERT INTO platform_audit_events(audit_event_id,source_kind,actor_account_id,actor_role,
     action_key,outcome,target_type,target_reference,metadata)
   VALUES('audit_'||queued_job,'native',source_event.actor_account_id,'assessor','outbox.job.enqueued',
    'succeeded','job',queued_job,jsonb_build_object('jobType','notification.interview.reminder','sourceEventRef',event_ref));
  END IF;
 END LOOP;
 INSERT INTO platform_audit_events(audit_event_id,source_kind,actor_account_id,actor_role,
   action_key,outcome,target_type,target_reference,metadata)
 VALUES('audit_'||encode(sha256(convert_to('interview-reminder-intent:'||event_ref,'UTF8')),'hex'),'native',
  source_event.actor_account_id,'assessor','notification.interview.reminder.intent.recorded','succeeded','resource',event_ref,
  jsonb_build_object('eligibleRecipients',eligible_count,'suppressed',eligible_count=0));
 RETURN count_queued;
EXCEPTION WHEN OTHERS THEN
 -- This handler rolls back the entire recipient set and completion marker, not the source operation.
 BEGIN
  INSERT INTO platform_audit_events(audit_event_id,source_kind,actor_account_id,actor_role,
    action_key,outcome,target_type,target_reference,metadata)
  SELECT 'audit_'||encode(sha256(convert_to(event_ref||clock_timestamp()::TEXT,'UTF8')),'hex'),
   'native',actor_account_id,actor_role,'notification.interview.reminder.enqueue.deferred','failed','resource',event_ref,
   jsonb_build_object('reason','notification_enqueue_unavailable')
  FROM platform_audit_events WHERE audit_event_id=event_ref AND action_key='interview.scheduled';
 EXCEPTION WHEN OTHERS THEN NULL; END;
 RETURN -1;
END;
$$;

CREATE FUNCTION platform_enqueue_interview_reminder_emails(event_ref TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE source_event platform_audit_events%ROWTYPE; recipient RECORD; dedup_key TEXT; queued_job TEXT;
 count_queued INTEGER:=0; eligible_count INTEGER:=0; reminder_due TIMESTAMPTZ;
BEGIN
 SELECT * INTO source_event FROM platform_audit_events WHERE audit_event_id=event_ref FOR UPDATE;
 IF NOT FOUND OR source_event.action_key<>'interview.scheduled' OR source_event.outcome<>'succeeded'
  OR source_event.actor_role<>'assessor' THEN RAISE EXCEPTION 'Invalid scheduling source'; END IF;
 reminder_due:=(source_event.metadata->>'reminderAt')::timestamptz;
 IF reminder_due IS NULL THEN RETURN 0; END IF;
 IF EXISTS(SELECT 1 FROM platform_audit_events WHERE action_key='email.interview.reminder.intent.recorded'
  AND target_reference=event_ref) THEN RETURN 0; END IF;
 FOR recipient IN SELECT eligible.*,accounts.email_normalized
  FROM platform_interview_reminder_recipients(event_ref) eligible
  JOIN auth_accounts accounts ON accounts.account_id=eligible.account_id
  WHERE accounts.email_verified_at IS NOT NULL
 LOOP
  eligible_count:=eligible_count+1;
  dedup_key:=encode(sha256(convert_to('email.interview.reminder:'||event_ref||':'||
   recipient.account_id||':'||recipient.role||':'||coalesce(recipient.membership_id,'platform'),'UTF8')),'hex');
  queued_job:=NULL;
  INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,
    enqueued_by_account_id,enqueued_by_role,tenant_id,membership_id,next_attempt_at)
  VALUES('job_'||substr(dedup_key,1,24),'email.interview.reminder',1,dedup_key,
   jsonb_build_object('eventRef',event_ref,'recipientRef',recipient.account_id,'recipientRole',recipient.role,
    'membershipRef',recipient.membership_id),source_event.actor_account_id,'assessor',NULL,NULL,reminder_due)
  ON CONFLICT(job_type,idempotency_key) DO NOTHING RETURNING job_id INTO queued_job;
  IF queued_job IS NOT NULL THEN
   INSERT INTO platform_email_deliveries(delivery_id,delivery_type,schema_version,source_job_id,delivery_key,
    recipient_account_id,recipient_role,tenant_id,membership_id,recipient_address_hash)
   VALUES('email_delivery_'||substr(dedup_key,1,24),'interview.reminder',1,queued_job,dedup_key,
    recipient.account_id,recipient.role,recipient.tenant_id,recipient.membership_id,
    encode(sha256(convert_to(lower(btrim(recipient.email_normalized)),'UTF8')),'hex'));
   count_queued:=count_queued+1;
   INSERT INTO platform_audit_events(audit_event_id,source_kind,actor_account_id,actor_role,
     action_key,outcome,target_type,target_reference,metadata)
   VALUES('audit_'||queued_job,'native',source_event.actor_account_id,'assessor','outbox.job.enqueued',
    'succeeded','job',queued_job,jsonb_build_object('jobType','email.interview.reminder','sourceEventRef',event_ref));
   INSERT INTO platform_audit_events(audit_event_id,source_kind,actor_account_id,actor_role,
    action_key,outcome,target_type,target_reference,metadata)
   VALUES('audit_email_'||queued_job,'native',source_event.actor_account_id,'assessor','email.delivery.queued',
    'succeeded','email_delivery','email_delivery_'||substr(dedup_key,1,24),
    jsonb_build_object('deliveryType','interview.reminder','sourceJobId',queued_job,'recipientRole',recipient.role));
  END IF;
 END LOOP;
 INSERT INTO platform_audit_events(audit_event_id,source_kind,actor_account_id,actor_role,
   action_key,outcome,target_type,target_reference,metadata)
 VALUES('audit_'||encode(sha256(convert_to('interview-reminder-email-intent:'||event_ref,'UTF8')),'hex'),'native',
  source_event.actor_account_id,'assessor','email.interview.reminder.intent.recorded','succeeded','resource',event_ref,
  jsonb_build_object('eligibleRecipients',eligible_count,'suppressed',eligible_count=0));
 RETURN count_queued;
EXCEPTION WHEN OTHERS THEN
 -- This handler rolls back the entire recipient set and completion marker, not the source operation.
 BEGIN
  INSERT INTO platform_audit_events(audit_event_id,source_kind,actor_account_id,actor_role,
    action_key,outcome,target_type,target_reference,metadata)
  SELECT 'audit_'||encode(sha256(convert_to(event_ref||clock_timestamp()::TEXT,'UTF8')),'hex'),
   'native',actor_account_id,actor_role,'email.interview.reminder.enqueue.deferred','failed','resource',event_ref,
   jsonb_build_object('reason','email_enqueue_unavailable')
  FROM platform_audit_events WHERE audit_event_id=event_ref AND action_key='interview.scheduled';
 EXCEPTION WHEN OTHERS THEN NULL; END;
 RETURN -1;
END;
$$;

CREATE FUNCTION platform_interview_reminder_validate_projection()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE job platform_outbox_jobs%ROWTYPE; source_event platform_audit_events%ROWTYPE; recipient RECORD;
BEGIN
 SELECT * INTO job FROM platform_outbox_jobs WHERE job_id=NEW.source_job_id;
 IF NOT FOUND OR job.job_type<>'notification.interview.reminder' OR job.schema_version<>1
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
 SELECT * INTO recipient FROM platform_interview_reminder_recipients(source_event.audit_event_id)
 WHERE account_id=job.payload->>'recipientRef' AND role=job.payload->>'recipientRole'
  AND membership_id IS NOT DISTINCT FROM job.payload->>'membershipRef';
 IF NOT FOUND OR NEW.recipient_account_id IS DISTINCT FROM recipient.account_id
  OR NEW.recipient_role IS DISTINCT FROM recipient.role OR NEW.tenant_id IS DISTINCT FROM recipient.tenant_id
  OR NEW.membership_id IS DISTINCT FROM recipient.membership_id
  OR NEW.target_key IS DISTINCT FROM recipient.target_key OR NEW.target_reference IS DISTINCT FROM recipient.target_reference
  OR (source_event.metadata->>'reminderAt')::timestamptz>clock_timestamp()
   OR NEW.notification_type<>'interview.reminder' OR NEW.schema_version<>1
  OR NEW.title<>'Interview reminder'
  OR NEW.body<>'Your interview is approaching. Open the record for the current time and preparation details.'
  OR NEW.metadata IS DISTINCT FROM jsonb_build_object('eventRef',source_event.audit_event_id)
  OR NEW.read_at IS NOT NULL
 THEN RAISE EXCEPTION 'Interview notification does not match its authorized source' USING ERRCODE='23514'; END IF;
 NEW.created_at:=CURRENT_TIMESTAMP;NEW.updated_at:=NEW.created_at;RETURN NEW;
END;
$$;

CREATE FUNCTION platform_project_interview_reminder_notification(job_ref TEXT)
RETURNS TABLE(created BOOLEAN,suppressed BOOLEAN) LANGUAGE plpgsql AS $$
DECLARE job platform_outbox_jobs%ROWTYPE; recipient RECORD; projected_id TEXT; projection_ref TEXT;
BEGIN
 SELECT * INTO job FROM platform_outbox_jobs WHERE job_id=job_ref;
 IF NOT FOUND OR job.job_type<>'notification.interview.reminder' THEN
  RAISE EXCEPTION 'Invalid interview notification job' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM platform_notifications WHERE source_job_id=job_ref) THEN RETURN QUERY SELECT FALSE,FALSE;RETURN;END IF;
 IF (SELECT (metadata->>'reminderAt')::timestamptz FROM platform_audit_events WHERE audit_event_id=job.payload->>'eventRef')>clock_timestamp() THEN
  RAISE EXCEPTION 'Interview reminder is not due' USING ERRCODE='23514'; END IF;
 SELECT * INTO recipient FROM platform_interview_reminder_recipients(job.payload->>'eventRef')
 WHERE account_id=job.payload->>'recipientRef' AND role=job.payload->>'recipientRole'
  AND membership_id IS NOT DISTINCT FROM job.payload->>'membershipRef';
 IF NOT FOUND THEN RETURN QUERY SELECT FALSE,TRUE;RETURN;END IF;
 projection_ref:=encode(sha256(convert_to(job_ref||':interview.reminder:'||recipient.account_id||':'||
  recipient.role||':'||coalesce(recipient.tenant_id,'platform'),'UTF8')),'hex');
 INSERT INTO platform_notifications(notification_id,notification_type,schema_version,source_job_id,projection_key,
  recipient_account_id,recipient_role,tenant_id,membership_id,title,body,metadata,target_key,target_reference)
 VALUES('notification_'||substr(projection_ref,1,24),'interview.reminder',1,job_ref,projection_ref,recipient.account_id,
  recipient.role,recipient.tenant_id,recipient.membership_id,'Interview reminder',
  'Your interview is approaching. Open the record for the current time and preparation details.',
  jsonb_build_object('eventRef',job.payload->>'eventRef'),recipient.target_key,recipient.target_reference)
 ON CONFLICT(projection_key) DO NOTHING RETURNING notification_id INTO projected_id;
 RETURN QUERY SELECT projected_id IS NOT NULL,FALSE;
END;
$$;

CREATE FUNCTION platform_interview_reminder_email_validate_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE job platform_outbox_jobs%ROWTYPE; source_event platform_audit_events%ROWTYPE;recipient RECORD;
BEGIN
 SELECT * INTO job FROM platform_outbox_jobs WHERE job_id=NEW.source_job_id;
 IF NOT FOUND OR job.job_type<>'email.interview.reminder' OR job.schema_version<>1
  OR job.enqueued_by_role<>'assessor' OR job.enqueued_system_component IS NOT NULL
  OR job.tenant_id IS NOT NULL OR job.membership_id IS NOT NULL
  OR jsonb_typeof(job.payload)<>'object'
  OR job.payload-ARRAY['eventRef','recipientRef','recipientRole','membershipRef']<>'{}'::jsonb
  OR NOT(job.payload ?& ARRAY['eventRef','recipientRef','recipientRole','membershipRef'])
 THEN RAISE EXCEPTION 'Invalid interview email source job' USING ERRCODE='23514';END IF;
 SELECT * INTO source_event FROM platform_audit_events WHERE audit_event_id=job.payload->>'eventRef';
 IF NOT FOUND OR source_event.action_key<>'interview.scheduled' OR source_event.outcome<>'succeeded'
  OR source_event.actor_role<>'assessor' OR source_event.actor_account_id IS DISTINCT FROM job.enqueued_by_account_id
 THEN RAISE EXCEPTION 'Invalid interview email source event' USING ERRCODE='23514';END IF;
 SELECT eligible.*,accounts.email_normalized INTO recipient
 FROM platform_interview_reminder_recipients(source_event.audit_event_id) eligible
 JOIN auth_accounts accounts ON accounts.account_id=eligible.account_id
 WHERE eligible.account_id=job.payload->>'recipientRef' AND eligible.role=job.payload->>'recipientRole'
  AND eligible.membership_id IS NOT DISTINCT FROM job.payload->>'membershipRef'
  AND accounts.email_verified_at IS NOT NULL;
 IF NOT FOUND OR NEW.recipient_account_id IS DISTINCT FROM recipient.account_id
  OR NEW.recipient_role IS DISTINCT FROM recipient.role OR NEW.tenant_id IS DISTINCT FROM recipient.tenant_id
  OR NEW.membership_id IS DISTINCT FROM recipient.membership_id
  OR NEW.recipient_address_hash IS DISTINCT FROM encode(sha256(convert_to(lower(btrim(recipient.email_normalized)),'UTF8')),'hex')
  OR job.next_attempt_at IS DISTINCT FROM (source_event.metadata->>'reminderAt')::timestamptz
   OR NEW.delivery_type<>'interview.reminder' OR NEW.schema_version<>1 OR NEW.status<>'queued'
  OR NEW.attempt_count<>0 OR NEW.last_result_code IS NOT NULL OR NEW.last_result_summary IS NOT NULL
  OR NEW.delivered_at IS NOT NULL OR NEW.terminal_failed_at IS NOT NULL
 THEN RAISE EXCEPTION 'Interview email does not match its authorized source' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;
$$;

DROP TRIGGER platform_notifications_validate_insert ON platform_notifications;
CREATE TRIGGER platform_notifications_validate_insert BEFORE INSERT ON platform_notifications
 FOR EACH ROW WHEN(NEW.notification_type NOT IN ('interview.scheduled','interview.reminder'))
 EXECUTE FUNCTION platform_notification_validate_projection();
CREATE TRIGGER platform_interview_reminders_validate_insert BEFORE INSERT ON platform_notifications
 FOR EACH ROW WHEN(NEW.notification_type='interview.reminder')
 EXECUTE FUNCTION platform_interview_reminder_validate_projection();

DROP TRIGGER platform_email_deliveries_validate_insert ON platform_email_deliveries;
CREATE TRIGGER platform_email_deliveries_validate_insert BEFORE INSERT ON platform_email_deliveries
 FOR EACH ROW WHEN(NEW.delivery_type NOT IN ('interview.scheduled','interview.reminder'))
 EXECUTE FUNCTION platform_email_delivery_validate_insert();
CREATE TRIGGER platform_interview_reminder_emails_validate_insert BEFORE INSERT ON platform_email_deliveries
 FOR EACH ROW WHEN(NEW.delivery_type='interview.reminder')
 EXECUTE FUNCTION platform_interview_reminder_email_validate_insert();

DROP TRIGGER platform_email_deliveries_guard_update ON platform_email_deliveries;
CREATE TRIGGER platform_email_deliveries_guard_update BEFORE UPDATE ON platform_email_deliveries
 FOR EACH ROW WHEN(NEW.delivery_type NOT IN ('interview.scheduled','interview.reminder'))
 EXECUTE FUNCTION platform_email_delivery_guard_update();
DROP TRIGGER platform_interview_emails_guard_update ON platform_email_deliveries;
CREATE TRIGGER platform_interview_emails_guard_update BEFORE UPDATE ON platform_email_deliveries
 FOR EACH ROW WHEN(NEW.delivery_type IN ('interview.scheduled','interview.reminder'))
 EXECUTE FUNCTION platform_interview_email_guard_update();
