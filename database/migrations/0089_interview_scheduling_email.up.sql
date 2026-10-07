-- Scheduling remains committed if derived notification work is temporarily unavailable.
DO $$
DECLARE item RECORD; old_check TEXT; original_checks JSONB:='[]'::jsonb;
BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('platform_audit_events','platform_audit_events_action_key_check','action_key','''email.interview.intent.recorded'', ''email.interview.enqueue.deferred'', ''email.delivery.sent'', ''email.delivery.suppressed'''),
 ('platform_outbox_jobs','platform_outbox_jobs_job_type_check','job_type','''email.interview.scheduled'''),
 ('platform_email_deliveries','platform_email_deliveries_delivery_type_check','delivery_type','''interview.scheduled'''),
 ('platform_email_deliveries','platform_email_deliveries_status_check','status','''sent'', ''suppressed'''),
 ('platform_email_delivery_attempts','platform_email_delivery_attempts_outcome_check','outcome','''accepted'', ''suppressed'''),
 ('platform_email_delivery_attempts','platform_email_delivery_attempts_adapter_key_check','adapter_key','''resend'''),
 ('platform_email_delivery_attempts','platform_email_attempt_result_shape','outcome','''accepted'', ''suppressed''')
 ) AS extensions(table_name,constraint_name,column_name,values_sql)
 LOOP
  SELECT pg_get_constraintdef(oid) INTO old_check FROM pg_constraint
   WHERE conrelid=item.table_name::regclass AND conname=item.constraint_name;
  IF old_check IS NULL THEN RAISE EXCEPTION 'Required notification constraint missing'; END IF;
  original_checks:=original_checks||jsonb_build_array(jsonb_build_object('table',item.table_name,
   'constraint',item.constraint_name,'definition',old_check));
  old_check:=regexp_replace(old_check,'^CHECK \((.*)\)$','\1');
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',item.table_name,item.constraint_name);
  IF item.constraint_name='platform_email_attempt_result_shape' THEN
   EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((%s) OR (outcome IN (''accepted'',''suppressed'')
    AND result_code IS NOT NULL AND result_summary IS NOT NULL AND finished_at IS NOT NULL
    AND ((outcome=''accepted'' AND provider_reference_hash IS NOT NULL) OR
     (outcome=''suppressed'' AND provider_reference_hash IS NULL))))',item.table_name,item.constraint_name,old_check);
  ELSE
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((%s) OR %I IN (%s))',
    item.table_name,item.constraint_name,old_check,item.column_name,item.values_sql);
  END IF;
 END LOOP;
 EXECUTE format('CREATE FUNCTION platform_interview_email_rollback_constraints() RETURNS JSONB LANGUAGE sql IMMUTABLE AS %L',
  'SELECT '||quote_literal(original_checks::TEXT)||'::jsonb');
END;
$$;

-- Existing foundation validation remains intact for its original fixed type.
DROP TRIGGER platform_email_deliveries_validate_insert ON platform_email_deliveries;
CREATE TRIGGER platform_email_deliveries_validate_insert BEFORE INSERT ON platform_email_deliveries
 FOR EACH ROW WHEN(NEW.delivery_type<>'interview.scheduled')
 EXECUTE FUNCTION platform_email_delivery_validate_insert();
CREATE FUNCTION platform_interview_email_validate_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE job platform_outbox_jobs%ROWTYPE; source_event platform_audit_events%ROWTYPE;recipient RECORD;
BEGIN
 SELECT * INTO job FROM platform_outbox_jobs WHERE job_id=NEW.source_job_id;
 IF NOT FOUND OR job.job_type<>'email.interview.scheduled' OR job.schema_version<>1
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
 FROM platform_interview_notification_recipients(source_event.audit_event_id) eligible
 JOIN auth_accounts accounts ON accounts.account_id=eligible.account_id
 WHERE eligible.account_id=job.payload->>'recipientRef' AND eligible.role=job.payload->>'recipientRole'
  AND eligible.membership_id IS NOT DISTINCT FROM job.payload->>'membershipRef'
  AND accounts.email_verified_at IS NOT NULL;
 IF NOT FOUND OR NEW.recipient_account_id IS DISTINCT FROM recipient.account_id
  OR NEW.recipient_role IS DISTINCT FROM recipient.role OR NEW.tenant_id IS DISTINCT FROM recipient.tenant_id
  OR NEW.membership_id IS DISTINCT FROM recipient.membership_id
  OR NEW.recipient_address_hash IS DISTINCT FROM encode(sha256(convert_to(lower(btrim(recipient.email_normalized)),'UTF8')),'hex')
  OR NEW.delivery_type<>'interview.scheduled' OR NEW.schema_version<>1 OR NEW.status<>'queued'
  OR NEW.attempt_count<>0 OR NEW.last_result_code IS NOT NULL OR NEW.last_result_summary IS NOT NULL
  OR NEW.delivered_at IS NOT NULL OR NEW.terminal_failed_at IS NOT NULL
 THEN RAISE EXCEPTION 'Interview email does not match its authorized source' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER platform_interview_emails_validate_insert BEFORE INSERT ON platform_email_deliveries
 FOR EACH ROW WHEN(NEW.delivery_type='interview.scheduled')
 EXECUTE FUNCTION platform_interview_email_validate_insert();

-- Preserve original attempt functions verbatim for empty rollback.
DO $$
DECLARE functions JSONB:='[]'::jsonb; definition TEXT;BEGIN
 SELECT pg_get_functiondef('platform_email_attempt_validate_insert()'::regprocedure) INTO definition;
 functions:=functions||jsonb_build_array(jsonb_build_object('definition',definition));
 IF position('source_job.job_type <> ''email.delivery.foundation''' IN definition)=0 THEN
  RAISE EXCEPTION 'Expected email attempt source validator missing';END IF;
 definition:=replace(definition,'source_job.job_type <> ''email.delivery.foundation''',
  'source_job.job_type NOT IN (''email.delivery.foundation'',''email.interview.scheduled'')');
 definition:=replace(definition,'source_job.lease_expires_at <= CURRENT_TIMESTAMP','source_job.lease_expires_at <= clock_timestamp()');
 definition:=replace(definition,'  RETURN NEW;','
  IF (delivery.delivery_type = ''interview.scheduled'' AND NEW.adapter_key <> ''resend'') OR
     (delivery.delivery_type = ''platform.foundation.email'' AND NEW.adapter_key <> ''local_test'') THEN
   RAISE EXCEPTION ''Email adapter does not match its fixed delivery type'' USING ERRCODE=''23514'';
  END IF;
  RETURN NEW;');

 EXECUTE definition;
 SELECT pg_get_functiondef('platform_email_attempt_guard_update()'::regprocedure) INTO definition;
 functions:=functions||jsonb_build_array(jsonb_build_object('definition',definition));
 IF position('NEW.outcome NOT IN (''delivered'', ''retryable_failure'', ''terminal_failure'', ''lease_expired'')' IN definition)=0 THEN
  RAISE EXCEPTION 'Expected email attempt outcome guard missing';END IF;
 definition:=replace(definition,
  'NEW.outcome NOT IN (''delivered'', ''retryable_failure'', ''terminal_failure'', ''lease_expired'')',
  'NOT EXISTS(SELECT 1 FROM platform_email_deliveries deliveries WHERE deliveries.delivery_id=NEW.delivery_id AND
   ((deliveries.delivery_type=''interview.scheduled'' AND NEW.adapter_key=''resend'' AND
     NEW.outcome IN (''accepted'',''suppressed'',''retryable_failure'',''terminal_failure'',''lease_expired'')) OR
    (deliveries.delivery_type=''platform.foundation.email'' AND NEW.adapter_key=''local_test'' AND
     NEW.outcome IN (''delivered'',''retryable_failure'',''terminal_failure'',''lease_expired''))))');
 EXECUTE definition;
 EXECUTE format('CREATE FUNCTION platform_interview_email_rollback_functions() RETURNS JSONB LANGUAGE sql IMMUTABLE AS %L',
  'SELECT '||quote_literal(functions::TEXT)||'::jsonb');
END;$$;
CREATE OR REPLACE FUNCTION platform_interview_email_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.delivery_id IS DISTINCT FROM OLD.delivery_id OR
     NEW.delivery_sequence IS DISTINCT FROM OLD.delivery_sequence OR
     NEW.delivery_type IS DISTINCT FROM OLD.delivery_type OR
     NEW.schema_version IS DISTINCT FROM OLD.schema_version OR
     NEW.source_job_id IS DISTINCT FROM OLD.source_job_id OR
     NEW.delivery_key IS DISTINCT FROM OLD.delivery_key OR
     NEW.recipient_account_id IS DISTINCT FROM OLD.recipient_account_id OR
     NEW.recipient_role IS DISTINCT FROM OLD.recipient_role OR
     NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
     NEW.membership_id IS DISTINCT FROM OLD.membership_id OR
     NEW.recipient_address_hash IS DISTINCT FROM OLD.recipient_address_hash OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Email delivery identity and trusted scope are immutable.';
  END IF;

  IF NOT (
    (OLD.status IN ('queued','retry_wait') AND NEW.status='suppressed') OR
    (OLD.status = 'queued' AND NEW.status = 'processing') OR
    (OLD.status = 'retry_wait' AND NEW.status = 'processing') OR
    (OLD.status = 'processing' AND NEW.status IN ('retry_wait', 'sent', 'suppressed', 'terminal_failed'))
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Email delivery state transition is invalid.';
  END IF;

  IF NEW.attempt_count < OLD.attempt_count OR
     NEW.attempt_count > OLD.attempt_count + 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Email delivery attempt count transition is invalid.';
  END IF;

  NEW.updated_at := CURRENT_TIMESTAMP;
  IF NEW.status = 'delivered' THEN
    NEW.delivered_at := CURRENT_TIMESTAMP;
    NEW.terminal_failed_at := NULL;
  ELSIF NEW.status = 'terminal_failed' THEN
    NEW.delivered_at := NULL;
    NEW.terminal_failed_at := CURRENT_TIMESTAMP;
  ELSE
    NEW.delivered_at := NULL;
    NEW.terminal_failed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;


DROP TRIGGER platform_email_deliveries_guard_update ON platform_email_deliveries;
CREATE TRIGGER platform_email_deliveries_guard_update BEFORE UPDATE ON platform_email_deliveries
 FOR EACH ROW WHEN(NEW.delivery_type<>'interview.scheduled') EXECUTE FUNCTION platform_email_delivery_guard_update();
CREATE TRIGGER platform_interview_emails_guard_update BEFORE UPDATE ON platform_email_deliveries
 FOR EACH ROW WHEN(NEW.delivery_type='interview.scheduled') EXECUTE FUNCTION platform_interview_email_guard_update();

CREATE FUNCTION platform_enqueue_interview_emails(event_ref TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE source_event platform_audit_events%ROWTYPE; recipient RECORD; dedup_key TEXT; queued_job TEXT;
 count_queued INTEGER:=0; eligible_count INTEGER:=0;
BEGIN
 SELECT * INTO source_event FROM platform_audit_events WHERE audit_event_id=event_ref FOR UPDATE;
 IF NOT FOUND OR source_event.action_key<>'interview.scheduled' OR source_event.outcome<>'succeeded'
  OR source_event.actor_role<>'assessor' THEN RAISE EXCEPTION 'Invalid scheduling source'; END IF;
 IF EXISTS(SELECT 1 FROM platform_audit_events WHERE action_key='email.interview.intent.recorded'
  AND target_reference=event_ref) THEN RETURN 0; END IF;
 FOR recipient IN SELECT eligible.*,accounts.email_normalized
  FROM platform_interview_notification_recipients(event_ref) eligible
  JOIN auth_accounts accounts ON accounts.account_id=eligible.account_id
  WHERE accounts.email_verified_at IS NOT NULL
 LOOP
  eligible_count:=eligible_count+1;
  dedup_key:=encode(sha256(convert_to('email.interview.scheduled:'||event_ref||':'||
   recipient.account_id||':'||recipient.role||':'||coalesce(recipient.membership_id,'platform'),'UTF8')),'hex');
  queued_job:=NULL;
  INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,
    enqueued_by_account_id,enqueued_by_role,tenant_id,membership_id)
  VALUES('job_'||substr(dedup_key,1,24),'email.interview.scheduled',1,dedup_key,
   jsonb_build_object('eventRef',event_ref,'recipientRef',recipient.account_id,'recipientRole',recipient.role,
    'membershipRef',recipient.membership_id),source_event.actor_account_id,'assessor',NULL,NULL)
  ON CONFLICT(job_type,idempotency_key) DO NOTHING RETURNING job_id INTO queued_job;
  IF queued_job IS NOT NULL THEN
   INSERT INTO platform_email_deliveries(delivery_id,delivery_type,schema_version,source_job_id,delivery_key,
    recipient_account_id,recipient_role,tenant_id,membership_id,recipient_address_hash)
   VALUES('email_delivery_'||substr(dedup_key,1,24),'interview.scheduled',1,queued_job,dedup_key,
    recipient.account_id,recipient.role,recipient.tenant_id,recipient.membership_id,
    encode(sha256(convert_to(lower(btrim(recipient.email_normalized)),'UTF8')),'hex'));
   count_queued:=count_queued+1;
   INSERT INTO platform_audit_events(audit_event_id,source_kind,actor_account_id,actor_role,
     action_key,outcome,target_type,target_reference,metadata)
   VALUES('audit_'||queued_job,'native',source_event.actor_account_id,'assessor','outbox.job.enqueued',
    'succeeded','job',queued_job,jsonb_build_object('jobType','email.interview.scheduled','sourceEventRef',event_ref));
   INSERT INTO platform_audit_events(audit_event_id,source_kind,actor_account_id,actor_role,
    action_key,outcome,target_type,target_reference,metadata)
   VALUES('audit_email_'||queued_job,'native',source_event.actor_account_id,'assessor','email.delivery.queued',
    'succeeded','email_delivery','email_delivery_'||substr(dedup_key,1,24),
    jsonb_build_object('deliveryType','interview.scheduled','sourceJobId',queued_job,'recipientRole',recipient.role));
  END IF;
 END LOOP;
 INSERT INTO platform_audit_events(audit_event_id,source_kind,actor_account_id,actor_role,
   action_key,outcome,target_type,target_reference,metadata)
 VALUES('audit_'||encode(sha256(convert_to('interview-email-intent:'||event_ref,'UTF8')),'hex'),'native',
  source_event.actor_account_id,'assessor','email.interview.intent.recorded','succeeded','resource',event_ref,
  jsonb_build_object('eligibleRecipients',eligible_count,'suppressed',eligible_count=0));
 RETURN count_queued;
EXCEPTION WHEN OTHERS THEN
 -- This handler rolls back the entire recipient set and completion marker, not the source operation.
 BEGIN
  INSERT INTO platform_audit_events(audit_event_id,source_kind,actor_account_id,actor_role,
    action_key,outcome,target_type,target_reference,metadata)
  SELECT 'audit_'||encode(sha256(convert_to(event_ref||clock_timestamp()::TEXT,'UTF8')),'hex'),
   'native',actor_account_id,actor_role,'email.interview.enqueue.deferred','failed','resource',event_ref,
   jsonb_build_object('reason','email_enqueue_unavailable')
  FROM platform_audit_events WHERE audit_event_id=event_ref AND action_key='interview.scheduled';
 EXCEPTION WHEN OTHERS THEN NULL; END;
 RETURN -1;
END;
$$;

