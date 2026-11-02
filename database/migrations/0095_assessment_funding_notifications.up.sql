-- Company funding notices use immutable application events and fixed recipient/target derivation.
DO $$
DECLARE item RECORD; old_check TEXT; saved_checks JSONB:='[]'::jsonb;
 original_trigger TEXT; original_unique TEXT;
BEGIN
 SELECT pg_get_triggerdef(oid) INTO original_trigger FROM pg_trigger
 WHERE tgrelid='platform_notifications'::regclass AND tgname='platform_notifications_validate_insert';
 SELECT pg_get_constraintdef(oid) INTO original_unique FROM pg_constraint
 WHERE conrelid='platform_notifications'::regclass AND conname='platform_notifications_source_job_id_key';
 IF original_trigger IS NULL OR original_unique IS NULL THEN RAISE EXCEPTION 'Required notification contract missing'; END IF;
 FOR item IN SELECT * FROM (VALUES
  ('platform_outbox_jobs','platform_outbox_jobs_job_type_check','job_type','''notification.assessment.funding'''),
  ('platform_notifications','platform_notifications_notification_type_check','notification_type','''assessment.funding.requested'',''assessment.funding.approved'''),
  ('platform_notifications','platform_notifications_target_key_check','target_key','''company.billing.funding'',''worker.assessment.case''')
 ) AS extensions(table_name,constraint_name,column_name,values_sql)
 LOOP
  SELECT pg_get_constraintdef(oid) INTO old_check FROM pg_constraint
  WHERE conrelid=item.table_name::regclass AND conname=item.constraint_name;
  IF old_check IS NULL THEN RAISE EXCEPTION 'Required funding notification constraint missing'; END IF;
  saved_checks:=saved_checks||jsonb_build_array(jsonb_build_object('table',item.table_name,'constraint',item.constraint_name,'definition',old_check));
  old_check:=regexp_replace(old_check,'^CHECK \((.*)\)$','\1');
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',item.table_name,item.constraint_name);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((%s) OR %I IN (%s))',
   item.table_name,item.constraint_name,old_check,item.column_name,item.values_sql);
 END LOOP;
 EXECUTE format('CREATE FUNCTION platform_assessment_funding_notification_rollback_contract() RETURNS JSONB LANGUAGE sql IMMUTABLE AS %L',
  'SELECT '||quote_literal(jsonb_build_object('checks',saved_checks,'trigger',original_trigger,'sourceUnique',original_unique)::TEXT)||'::jsonb');
END;
$$;

-- Existing notification jobs still project at most one notice. Funding jobs fan out once per authorized recipient.
ALTER TABLE platform_notifications DROP CONSTRAINT platform_notifications_source_job_id_key;
CREATE UNIQUE INDEX platform_notifications_legacy_source_job_idx ON platform_notifications(source_job_id)
 WHERE notification_type NOT IN ('assessment.funding.requested','assessment.funding.approved');
CREATE UNIQUE INDEX platform_notifications_funding_source_recipient_idx
 ON platform_notifications(source_job_id,recipient_account_id,recipient_role,COALESCE(tenant_id,''),COALESCE(membership_id,''))
 WHERE notification_type IN ('assessment.funding.requested','assessment.funding.approved');

CREATE FUNCTION platform_assessment_funding_notification_source(event_ref TEXT)
RETURNS TABLE(event_id TEXT,application_id TEXT,worker_account_id TEXT,company_tenant_id TEXT,
 worker_link_id TEXT,funding_request_id TEXT,notification_type TEXT,actor_account_id TEXT,actor_role TEXT)
LANGUAGE sql VOLATILE AS $$
 SELECT events.event_id,applications.application_id,applications.worker_account_id,
  applications.company_tenant_id,applications.worker_link_id,applications.funding_request_id,
  CASE WHEN events.to_status='FUNDING_REQUESTED' THEN 'assessment.funding.requested' ELSE 'assessment.funding.approved' END,
  events.actor_account_id,events.actor_role
 FROM worker_assessment_application_events events
 JOIN worker_assessment_applications applications ON applications.application_id=events.application_id
 JOIN funding_requests funding ON funding.funding_request_id=applications.funding_request_id
  AND funding.tenant_id=applications.company_tenant_id AND funding.worker_link_id=applications.worker_link_id
  AND funding.requested_by_account_id=applications.worker_account_id
 WHERE events.event_id=event_ref AND applications.funding_mode='COMPANY_REQUEST'
 AND (
  (events.from_status IS NULL AND events.to_status='FUNDING_REQUESTED' AND events.actor_role='worker'
   AND events.actor_account_id=applications.worker_account_id
   AND events.detail_json->>'tenantId'=applications.company_tenant_id
   AND events.detail_json->>'fundingRequestId'=applications.funding_request_id)
  OR
  (events.from_status='FUNDED' AND events.to_status='CASE_CREATED' AND events.actor_role='company'
   AND applications.funded_at IS NOT NULL
   AND events.detail_json->>'tenantId'=applications.company_tenant_id
   AND events.detail_json->>'orderId'=applications.assurance_order_id
   AND events.detail_json->>'caseId'=applications.assurance_case_id
   AND EXISTS(SELECT 1 FROM assurance_cases cases
    WHERE cases.case_id=applications.assurance_case_id AND cases.order_id=applications.assurance_order_id
     AND cases.tenant_id=applications.company_tenant_id AND cases.worker_account_id=applications.worker_account_id
     AND cases.worker_link_id=applications.worker_link_id)
   AND EXISTS(SELECT 1 FROM worker_assessment_application_events approvals
    WHERE approvals.application_id=applications.application_id AND approvals.from_status='FUNDING_REQUESTED'
     AND approvals.to_status='FUNDED' AND approvals.actor_role='company'
     AND approvals.actor_account_id=events.actor_account_id AND approvals.occurred_at<=events.occurred_at
     AND approvals.detail_json->>'fundingRequestId'=applications.funding_request_id
     AND approvals.detail_json->>'reservedCredits'=funding.credit_units::TEXT))
 );
$$;

CREATE FUNCTION platform_assessment_funding_notification_recipients(event_ref TEXT)
RETURNS TABLE(account_id TEXT,role TEXT,tenant_id TEXT,membership_id TEXT,notification_type TEXT,target_key TEXT,target_reference TEXT)
LANGUAGE sql VOLATILE AS $$
 WITH source AS (SELECT * FROM platform_assessment_funding_notification_source(event_ref)),
 candidates AS (
  SELECT memberships.account_id,'company'::TEXT AS role,memberships.tenant_id,memberships.membership_id,
   source.notification_type,'company.billing.funding'::TEXT AS target_key,source.funding_request_id AS target_reference
  FROM source JOIN worker_assessment_applications applications ON applications.application_id=source.application_id
  JOIN funding_requests funding ON funding.funding_request_id=source.funding_request_id
  JOIN company_worker_links links ON links.link_id=source.worker_link_id AND links.tenant_id=source.company_tenant_id
   AND links.worker_account_id=source.worker_account_id AND links.link_status='active'
  JOIN auth_tenant_memberships memberships ON memberships.tenant_id=source.company_tenant_id
  JOIN platform_tenants tenants ON tenants.tenant_id=memberships.tenant_id AND tenants.tenant_status='active'
  JOIN auth_tenant_role_permission_ceiling ceiling ON ceiling.membership_role=memberships.membership_role
   AND ceiling.permission_key='company.billing.manage'
  WHERE source.notification_type='assessment.funding.requested'
   AND applications.application_status='FUNDING_REQUESTED' AND funding.status='REQUESTED'
   AND memberships.portal_role='company' AND memberships.membership_status='active'
   AND NOT EXISTS(SELECT 1 FROM auth_tenant_permission_overrides denied
    WHERE denied.membership_id=memberships.membership_id AND denied.membership_role=memberships.membership_role
     AND denied.permission_key IN ('company.billing.read','company.billing.manage') AND denied.effect='deny')
  UNION ALL
  SELECT source.worker_account_id,'worker',NULL,NULL,source.notification_type,
   'worker.assessment.case',applications.assurance_case_id
  FROM source JOIN worker_assessment_applications applications ON applications.application_id=source.application_id
  JOIN funding_requests funding ON funding.funding_request_id=source.funding_request_id
  JOIN assurance_cases cases ON cases.case_id=applications.assurance_case_id AND cases.order_id=applications.assurance_order_id
   AND cases.tenant_id=source.company_tenant_id AND cases.worker_account_id=source.worker_account_id
   AND cases.worker_link_id=source.worker_link_id
  WHERE source.notification_type='assessment.funding.approved' AND applications.application_status='CASE_CREATED'
   AND funding.status='APPROVED' AND funding.reserved_credit_units=funding.credit_units
   AND cases.case_status='Assessment pending' AND cases.owner_kind='worker'
 )
 SELECT candidates.* FROM candidates JOIN auth_accounts accounts ON accounts.account_id=candidates.account_id
 JOIN auth_account_roles roles ON roles.account_id=candidates.account_id AND roles.role=candidates.role
 WHERE accounts.account_status='active';
$$;

CREATE FUNCTION platform_assessment_funding_assert_job(job platform_outbox_jobs)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE source RECORD; expected_key TEXT;
BEGIN
 IF job.job_type<>'notification.assessment.funding' OR job.schema_version<>1
  OR job.enqueued_system_component IS NOT NULL OR jsonb_typeof(job.payload)<>'object'
  OR job.payload - 'eventRef'<>'{}'::jsonb OR NOT(job.payload ? 'eventRef')
  OR jsonb_typeof(job.payload->'eventRef')<>'string'
  OR (job.payload->>'eventRef') !~ '^assessment_application_event_[A-Za-z0-9_-]{24}$'
 THEN RAISE EXCEPTION 'Invalid assessment funding notification job' USING ERRCODE='23514'; END IF;
 expected_key:=encode(sha256(convert_to('notification.assessment.funding:'||(job.payload->>'eventRef'),'UTF8')),'hex');
 IF job.idempotency_key IS DISTINCT FROM expected_key OR job.job_id IS DISTINCT FROM 'job_'||substr(expected_key,1,24)
 THEN RAISE EXCEPTION 'Funding notification job must retain its canonical event identity' USING ERRCODE='23514'; END IF;
 SELECT * INTO source FROM platform_assessment_funding_notification_source(job.payload->>'eventRef');
 IF NOT FOUND OR job.enqueued_by_account_id IS DISTINCT FROM source.actor_account_id
  OR job.enqueued_by_role IS DISTINCT FROM source.actor_role
  OR (source.actor_role='worker' AND (job.tenant_id IS NOT NULL OR job.membership_id IS NOT NULL))
  OR (source.actor_role='company' AND (job.tenant_id IS DISTINCT FROM source.company_tenant_id OR NOT EXISTS(
   SELECT 1 FROM auth_tenant_memberships memberships WHERE memberships.membership_id=job.membership_id
    AND memberships.tenant_id=source.company_tenant_id AND memberships.account_id=source.actor_account_id
    AND memberships.portal_role='company')))
 THEN RAISE EXCEPTION 'Assessment funding job does not match its immutable source' USING ERRCODE='23514'; END IF;
END;
$$;

CREATE FUNCTION platform_assessment_funding_job_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.job_id IS DISTINCT FROM NEW.job_id OR OLD.job_type IS DISTINCT FROM NEW.job_type OR OLD.schema_version IS DISTINCT FROM NEW.schema_version
   OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key OR OLD.payload IS DISTINCT FROM NEW.payload
   OR OLD.enqueued_by_account_id IS DISTINCT FROM NEW.enqueued_by_account_id
   OR OLD.enqueued_by_role IS DISTINCT FROM NEW.enqueued_by_role
   OR OLD.enqueued_system_component IS DISTINCT FROM NEW.enqueued_system_component
   OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id OR OLD.membership_id IS DISTINCT FROM NEW.membership_id
  THEN RAISE EXCEPTION 'Assessment funding job source is immutable' USING ERRCODE='55000'; END IF;
 ELSE PERFORM platform_assessment_funding_assert_job(NEW); END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER platform_assessment_funding_jobs_validate_insert BEFORE INSERT ON platform_outbox_jobs
 FOR EACH ROW WHEN(NEW.job_type='notification.assessment.funding') EXECUTE FUNCTION platform_assessment_funding_job_guard();
CREATE TRIGGER platform_assessment_funding_jobs_guard_update BEFORE UPDATE ON platform_outbox_jobs
 FOR EACH ROW WHEN(OLD.job_type='notification.assessment.funding' OR NEW.job_type='notification.assessment.funding')
 EXECUTE FUNCTION platform_assessment_funding_job_guard();

CREATE FUNCTION platform_enqueue_assessment_funding_notification(event_ref TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE source RECORD; dedup_key TEXT; queued_job TEXT; source_tenant TEXT; source_membership TEXT; created_job TEXT;
BEGIN
 SELECT * INTO source FROM platform_assessment_funding_notification_source(event_ref);
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid assessment funding notification event' USING ERRCODE='23514'; END IF;
 IF source.actor_role='company' THEN
  source_tenant:=source.company_tenant_id;
  SELECT memberships.membership_id INTO source_membership FROM auth_tenant_memberships memberships
  JOIN platform_tenants tenants ON tenants.tenant_id=memberships.tenant_id AND tenants.tenant_status='active'
  JOIN auth_tenant_role_permission_ceiling ceiling ON ceiling.membership_role=memberships.membership_role
   AND ceiling.permission_key='company.billing.manage'
  WHERE memberships.tenant_id=source_tenant AND memberships.account_id=source.actor_account_id
   AND memberships.portal_role='company' AND memberships.membership_status='active'
   AND NOT EXISTS(SELECT 1 FROM auth_tenant_permission_overrides denied WHERE denied.membership_id=memberships.membership_id
    AND denied.membership_role=memberships.membership_role AND denied.permission_key='company.billing.manage' AND denied.effect='deny');
  IF source_membership IS NULL THEN RAISE EXCEPTION 'Funding source Company membership unavailable' USING ERRCODE='23514'; END IF;
 END IF;
 dedup_key:=encode(sha256(convert_to('notification.assessment.funding:'||event_ref,'UTF8')),'hex');
 queued_job:='job_'||substr(dedup_key,1,24);
 INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,
  enqueued_by_account_id,enqueued_by_role,tenant_id,membership_id)
 VALUES(queued_job,'notification.assessment.funding',1,dedup_key,jsonb_build_object('eventRef',event_ref),
  source.actor_account_id,source.actor_role,source_tenant,source_membership)
 ON CONFLICT(job_type,idempotency_key) DO NOTHING RETURNING job_id INTO created_job;
 IF created_job IS NOT NULL THEN
  INSERT INTO platform_audit_events(audit_event_id,source_kind,actor_account_id,actor_role,
   actor_tenant_id,actor_membership_id,action_key,outcome,target_type,target_reference,metadata)
  VALUES('audit_'||created_job,'native',source.actor_account_id,source.actor_role,source_tenant,source_membership,
   'outbox.job.enqueued','succeeded','job',created_job,
   jsonb_build_object('jobType','notification.assessment.funding','sourceEventRef',event_ref));
 END IF;
 RETURN queued_job;
END;
$$;

DROP TRIGGER platform_notifications_validate_insert ON platform_notifications;
CREATE TRIGGER platform_notifications_validate_insert BEFORE INSERT ON platform_notifications
 FOR EACH ROW WHEN(NEW.notification_type NOT IN ('interview.scheduled','interview.reminder','assessment.funding.requested','assessment.funding.approved'))
 EXECUTE FUNCTION platform_notification_validate_projection();

CREATE FUNCTION platform_assessment_funding_notification_validate_projection()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE job platform_outbox_jobs%ROWTYPE; recipient RECORD; expected_title TEXT; expected_body TEXT;
BEGIN
 SELECT * INTO job FROM platform_outbox_jobs WHERE job_id=NEW.source_job_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Funding notification source job unavailable' USING ERRCODE='23514'; END IF;
 PERFORM platform_assessment_funding_assert_job(job);
 SELECT * INTO recipient FROM platform_assessment_funding_notification_recipients(job.payload->>'eventRef')
 WHERE account_id=NEW.recipient_account_id AND role=NEW.recipient_role
  AND tenant_id IS NOT DISTINCT FROM NEW.tenant_id AND membership_id IS NOT DISTINCT FROM NEW.membership_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Funding notification recipient unavailable' USING ERRCODE='23514'; END IF;
 expected_title:=CASE WHEN recipient.notification_type='assessment.funding.requested' THEN 'Assessment funding requested' ELSE 'Assessment funding approved' END;
 expected_body:=CASE WHEN recipient.notification_type='assessment.funding.requested'
  THEN 'A linked Worker requested assessment funding. Open the Company billing request to approve or reject it.'
  ELSE 'Your Company approved assessment funding. Open your available assessment and complete the required pre-assessment checks.' END;
 IF NEW.notification_type IS DISTINCT FROM recipient.notification_type OR NEW.schema_version<>1
  OR NEW.title IS DISTINCT FROM expected_title OR NEW.body IS DISTINCT FROM expected_body
  OR NEW.metadata IS DISTINCT FROM jsonb_build_object('eventRef',job.payload->>'eventRef')
  OR NEW.target_key IS DISTINCT FROM recipient.target_key OR NEW.target_reference IS DISTINCT FROM recipient.target_reference
  OR NEW.read_at IS NOT NULL
 THEN RAISE EXCEPTION 'Funding notification does not match its fixed source contract' USING ERRCODE='23514'; END IF;
 NEW.created_at:=CURRENT_TIMESTAMP;NEW.updated_at:=NEW.created_at;RETURN NEW;
END;
$$;
CREATE TRIGGER platform_assessment_funding_notifications_validate_insert BEFORE INSERT ON platform_notifications
 FOR EACH ROW WHEN(NEW.notification_type IN ('assessment.funding.requested','assessment.funding.approved'))
 EXECUTE FUNCTION platform_assessment_funding_notification_validate_projection();

CREATE FUNCTION platform_project_assessment_funding_notification(job_ref TEXT)
RETURNS TABLE(created INTEGER,suppressed BOOLEAN) LANGUAGE plpgsql AS $$
DECLARE job platform_outbox_jobs%ROWTYPE; recipient RECORD; projection_ref TEXT; projected_id TEXT;
 created_count INTEGER:=0; eligible_count INTEGER:=0;
BEGIN
 SELECT * INTO job FROM platform_outbox_jobs WHERE job_id=job_ref;
 IF NOT FOUND THEN RAISE EXCEPTION 'Funding notification job unavailable' USING ERRCODE='23514'; END IF;
 PERFORM platform_assessment_funding_assert_job(job);
 FOR recipient IN SELECT * FROM platform_assessment_funding_notification_recipients(job.payload->>'eventRef')
 LOOP
  eligible_count:=eligible_count+1;
  projection_ref:=encode(sha256(convert_to(job_ref||':'||recipient.notification_type||':'||recipient.account_id||':'||
   recipient.role||':'||coalesce(recipient.tenant_id,'platform'),'UTF8')),'hex');
  projected_id:=NULL;
  INSERT INTO platform_notifications(notification_id,notification_type,schema_version,source_job_id,projection_key,
   recipient_account_id,recipient_role,tenant_id,membership_id,title,body,metadata,target_key,target_reference)
  VALUES('notification_'||substr(projection_ref,1,24),recipient.notification_type,1,job_ref,projection_ref,recipient.account_id,
   recipient.role,recipient.tenant_id,recipient.membership_id,
   CASE WHEN recipient.notification_type='assessment.funding.requested' THEN 'Assessment funding requested' ELSE 'Assessment funding approved' END,
   CASE WHEN recipient.notification_type='assessment.funding.requested'
    THEN 'A linked Worker requested assessment funding. Open the Company billing request to approve or reject it.'
    ELSE 'Your Company approved assessment funding. Open your available assessment and complete the required pre-assessment checks.' END,
   jsonb_build_object('eventRef',job.payload->>'eventRef'),recipient.target_key,recipient.target_reference)
  ON CONFLICT(projection_key) DO NOTHING RETURNING notification_id INTO projected_id;
  IF projected_id IS NOT NULL THEN created_count:=created_count+1; END IF;
 END LOOP;
 RETURN QUERY SELECT created_count,eligible_count=0;
END;
$$;
