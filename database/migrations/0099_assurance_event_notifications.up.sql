-- Fixed source history hooks enqueue durable delivery work in the original business transaction.
-- Recipients and record links are derived from authoritative source rows and rechecked when read/sent.
DO $$
DECLARE item RECORD; old_check TEXT; saved_checks JSONB:='[]'::jsonb; saved_functions JSONB:='[]'::jsonb;
 saved_triggers JSONB:='[]'::jsonb; definition TEXT; legacy_index TEXT;
BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('platform_outbox_jobs','platform_outbox_jobs_job_type_check','job_type','''notification.assurance.event'',''email.assurance.event'''),
 ('platform_notifications','platform_notifications_notification_type_check','notification_type','''evidence.submitted'',''evidence.reviewed'',''evidence.additional.requested'',''decision.recorded'',''credential.issued'',''appeal.submitted'',''appeal.updated'''),
 ('platform_notifications','platform_notifications_target_key_check','target_key','''worker.evidence.record'',''worker.identity.record'',''worker.observation.record'',''verifier.review.task'',''worker.assurance.case'',''worker.credential.record'',''appeal.record'''),
 ('platform_email_deliveries','platform_email_deliveries_delivery_type_check','delivery_type','''evidence.submitted'',''evidence.reviewed'',''evidence.additional.requested'',''decision.recorded'',''credential.issued'',''appeal.submitted'',''appeal.updated'',''assessment.funding.requested'',''assessment.funding.approved''')
 ) AS extensions(table_name,constraint_name,column_name,values_sql)
 LOOP
  SELECT pg_get_constraintdef(oid) INTO old_check FROM pg_constraint WHERE conrelid=item.table_name::regclass AND conname=item.constraint_name;
  IF old_check IS NULL THEN RAISE EXCEPTION 'Required assurance delivery contract missing'; END IF;
  saved_checks:=saved_checks||jsonb_build_array(jsonb_build_object('table',item.table_name,'constraint',item.constraint_name,'definition',old_check));
  old_check:=regexp_replace(old_check,'^CHECK \((.*)\)$','\1');
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',item.table_name,item.constraint_name);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((%s) OR %I IN (%s))',item.table_name,item.constraint_name,old_check,item.column_name,item.values_sql);
 END LOOP;
 SELECT pg_get_constraintdef(oid) INTO old_check FROM pg_constraint WHERE conrelid='platform_outbox_jobs'::regclass AND conname='platform_outbox_enqueue_origin';
 saved_checks:=saved_checks||jsonb_build_array(jsonb_build_object('table','platform_outbox_jobs','constraint','platform_outbox_enqueue_origin','definition',old_check));
 old_check:=regexp_replace(old_check,'^CHECK \((.*)\)$','\1');
 ALTER TABLE platform_outbox_jobs DROP CONSTRAINT platform_outbox_enqueue_origin;
 EXECUTE format('ALTER TABLE platform_outbox_jobs ADD CONSTRAINT platform_outbox_enqueue_origin CHECK ((%s) OR
  (enqueued_by_account_id IS NULL AND enqueued_by_role IS NULL AND enqueued_system_component=''outbox-worker''
   AND job_type IN (''notification.assurance.event'',''email.assurance.event'') AND payload->>''eventType''=''credential.issued''
   AND tenant_id IS NULL AND membership_id IS NULL))',old_check);
 FOR item IN SELECT unnest(ARRAY['platform_email_attempt_validate_insert()','platform_email_attempt_guard_update()']) AS reference
 LOOP
  SELECT pg_get_functiondef(item.reference::regprocedure) INTO definition;
  saved_functions:=saved_functions||jsonb_build_array(jsonb_build_object('definition',definition));
  IF position('''interview.reminder''' IN definition)=0 THEN RAISE EXCEPTION 'Required business email attempt contract missing'; END IF;
  definition:=replace(definition,'''email.interview.reminder''','''email.interview.reminder'',''email.assurance.event''');
  definition:=replace(definition,'delivery.delivery_type IN (''interview.scheduled'',''interview.reminder'')','delivery.delivery_type IN (''interview.scheduled'',''interview.reminder'',''evidence.submitted'',''evidence.reviewed'',''evidence.additional.requested'',''decision.recorded'',''credential.issued'',''appeal.submitted'',''appeal.updated'',''assessment.funding.requested'',''assessment.funding.approved'')');
  definition:=replace(definition,'deliveries.delivery_type IN (''interview.scheduled'',''interview.reminder'')','deliveries.delivery_type IN (''interview.scheduled'',''interview.reminder'',''evidence.submitted'',''evidence.reviewed'',''evidence.additional.requested'',''decision.recorded'',''credential.issued'',''appeal.submitted'',''appeal.updated'',''assessment.funding.requested'',''assessment.funding.approved'')');
  EXECUTE definition;
 END LOOP;
 FOR item IN SELECT tgname,pg_get_triggerdef(oid) AS definition FROM pg_trigger
 WHERE NOT tgisinternal AND tgname IN ('platform_notifications_validate_insert','platform_email_deliveries_validate_insert','platform_email_deliveries_guard_update')
 LOOP saved_triggers:=saved_triggers||jsonb_build_array(jsonb_build_object('name',item.tgname,'definition',item.definition)); END LOOP;
 SELECT pg_get_indexdef('platform_notifications_legacy_source_job_idx'::regclass) INTO legacy_index;
 EXECUTE format('CREATE FUNCTION platform_assurance_event_rollback_contract() RETURNS JSONB LANGUAGE sql IMMUTABLE AS %L',
 'SELECT '||quote_literal(jsonb_build_object('checks',saved_checks,'functions',saved_functions,'triggers',saved_triggers,'legacyIndex',legacy_index)::TEXT)||'::jsonb');
END;$$;

DROP INDEX platform_notifications_legacy_source_job_idx;
CREATE UNIQUE INDEX platform_notifications_legacy_source_job_idx ON platform_notifications(source_job_id)
 WHERE notification_type NOT IN ('assessment.funding.requested','assessment.funding.approved','evidence.submitted','evidence.reviewed','evidence.additional.requested','decision.recorded','credential.issued','appeal.submitted','appeal.updated');
CREATE UNIQUE INDEX platform_notifications_assurance_source_recipient_idx ON platform_notifications
 (source_job_id,recipient_account_id,recipient_role,COALESCE(tenant_id,''),COALESCE(membership_id,''))
 WHERE notification_type IN ('evidence.submitted','evidence.reviewed','evidence.additional.requested','decision.recorded','credential.issued','appeal.submitted','appeal.updated');

CREATE FUNCTION platform_assurance_event_source(p_type TEXT,p_ref TEXT)
RETURNS TABLE(event_type TEXT,event_ref TEXT,record_ref TEXT,source_version TEXT,evidence_kind TEXT,
 worker_account_id TEXT,source_tenant TEXT,case_ref TEXT,actor_account_id TEXT,actor_role TEXT,
 actor_tenant TEXT,actor_membership TEXT,system_component TEXT)
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
 IF p_type NOT IN ('evidence.submitted','evidence.reviewed','evidence.additional.requested','decision.recorded','credential.issued','appeal.submitted','appeal.updated','assessment.funding.requested','assessment.funding.approved') OR char_length(p_ref)>192 OR p_ref !~ '^[A-Za-z0-9_.-]+:[A-Za-z0-9_-]{1,160}(:[1-9][0-9]{0,15})?$'
 THEN RETURN; END IF;
 IF p_type='evidence.submitted' AND split_part(p_ref,':',1)='audit' AND split_part(p_ref,':',3)='' THEN
  RETURN QUERY SELECT p_type,p_ref,records.record_id,versions.version_id,records.record_kind,records.worker_account_id,
   NULL::TEXT,NULL::TEXT,events.actor_account_id,events.actor_role,NULL::TEXT,NULL::TEXT,NULL::TEXT
  FROM platform_audit_events events JOIN worker_evidence_records records ON records.record_id=events.target_reference
  JOIN worker_evidence_versions versions ON versions.record_id=records.record_id AND versions.version_id=events.metadata->>'versionId'
  WHERE events.audit_event_id=split_part(p_ref,':',2) AND events.source_kind='native' AND events.action_key='worker_evidence.version.submitted'
   AND events.outcome='succeeded' AND events.actor_role='worker' AND events.actor_account_id=records.worker_account_id
   AND versions.submitted_at IS NOT NULL;
 ELSIF p_type IN ('evidence.reviewed','evidence.additional.requested') AND split_part(p_ref,':',1)='review' AND split_part(p_ref,':',3)='' THEN
  RETURN QUERY SELECT p_type,p_ref,tasks.source_record_id,tasks.source_version_id,tasks.evidence_kind,tasks.worker_account_id,
   tasks.tenant_id,tasks.case_id,decisions.verifier_account_id,'verifier'::TEXT,NULL::TEXT,NULL::TEXT,NULL::TEXT
  FROM evidence_review_decisions decisions JOIN evidence_review_tasks tasks ON tasks.task_id=decisions.task_id
   AND decisions.source_version_id=tasks.source_version_id
  WHERE decisions.decision_id=split_part(p_ref,':',2)
   AND (EXISTS(SELECT 1 FROM worker_evidence_records records JOIN worker_evidence_versions versions ON versions.record_id=records.record_id
     WHERE records.record_id=tasks.source_record_id AND records.worker_account_id=tasks.worker_account_id AND versions.version_id=tasks.source_version_id)
    OR EXISTS(SELECT 1 FROM worker_identities identities JOIN worker_identity_versions versions ON versions.identity_id=identities.identity_id
     WHERE identities.identity_id=tasks.source_record_id AND identities.worker_account_id=tasks.worker_account_id AND versions.identity_version_id=tasks.source_version_id)
    OR EXISTS(SELECT 1 FROM supervisor_observations observations WHERE observations.observation_id=tasks.source_version_id
     AND observations.worker_account_id=tasks.worker_account_id AND observations.case_id=tasks.case_id))
   AND ((p_type='evidence.additional.requested' AND decisions.outcome='CHANGES_REQUESTED')
    OR (p_type='evidence.reviewed' AND decisions.outcome IN ('APPROVED','REJECTED')));
 ELSIF p_type='decision.recorded' AND split_part(p_ref,':',1)='case' AND split_part(p_ref,':',3)='' THEN
  RETURN QUERY SELECT p_type,p_ref,cases.case_id,NULL::TEXT,NULL::TEXT,cases.worker_account_id,cases.tenant_id,cases.case_id,
   events.actor_account_id,'admin'::TEXT,NULL::TEXT,NULL::TEXT,NULL::TEXT
  FROM assurance_case_timeline_events events JOIN assurance_cases cases ON cases.case_id=events.case_id AND cases.tenant_id=events.tenant_id AND cases.order_id=events.order_id
  JOIN platform_decisions decisions ON decisions.decision_id=cases.decision_reference AND decisions.case_id=cases.case_id AND decisions.tenant_id=cases.tenant_id
  WHERE events.timeline_event_id=split_part(p_ref,':',2) AND events.event_type IN ('decision_recorded','decision_override_applied') AND events.actor_role='admin';
 ELSIF p_type='credential.issued' AND split_part(p_ref,':',1)='issuance' AND split_part(p_ref,':',3)='1' THEN
  RETURN QUERY SELECT p_type,p_ref,credentials.credential_id,NULL::TEXT,NULL::TEXT,identities.worker_account_id,NULL::TEXT,NULL::TEXT,
   NULL::TEXT,NULL::TEXT,NULL::TEXT,NULL::TEXT,'outbox-worker'::TEXT
  FROM credential_issuance_events events JOIN credential_issuances credentials ON credentials.credential_id=events.credential_id
  LEFT JOIN worker_identity_worker_ids identities ON identities.permanent_worker_id=credentials.worker_id
  WHERE events.credential_id=split_part(p_ref,':',2) AND events.version=1 AND events.status='valid';
 ELSIF p_type IN ('appeal.submitted','appeal.updated') AND split_part(p_ref,':',1)='appeal' AND split_part(p_ref,':',3) ~ '^[1-9][0-9]{0,15}$'
   AND split_part(p_ref,':',3)::NUMERIC<=9007199254740991 THEN
  RETURN QUERY SELECT p_type,p_ref,appeals.appeal_id,NULL::TEXT,NULL::TEXT,identities.worker_account_id,NULL::TEXT,NULL::TEXT,
   CASE WHEN p_type='appeal.submitted' THEN identities.worker_account_id ELSE events.reviewer_account_id END,
   CASE WHEN p_type='appeal.submitted' THEN 'worker'::TEXT ELSE 'admin'::TEXT END,NULL::TEXT,NULL::TEXT,NULL::TEXT
  FROM credential_appeal_events events JOIN credential_appeals appeals ON appeals.appeal_id=events.appeal_id
  JOIN credential_issuances credentials ON credentials.credential_id=appeals.credential_id AND credentials.worker_id=appeals.worker_id
  LEFT JOIN worker_identity_worker_ids identities ON identities.permanent_worker_id=appeals.worker_id
  WHERE events.appeal_id=split_part(p_ref,':',2) AND events.version=split_part(p_ref,':',3)::BIGINT
   AND ((p_type='appeal.submitted' AND events.version=1 AND events.status='submitted') OR (p_type='appeal.updated' AND events.version>1));
 ELSIF p_type IN ('assessment.funding.requested','assessment.funding.approved') AND split_part(p_ref,':',1)='funding' AND split_part(p_ref,':',3)='' THEN
  RETURN QUERY SELECT p_type,p_ref,funding.funding_request_id,NULL::TEXT,NULL::TEXT,funding.worker_account_id,funding.company_tenant_id,NULL::TEXT,
   funding.actor_account_id,funding.actor_role,original.tenant_id,original.membership_id,NULL::TEXT
  FROM platform_assessment_funding_notification_source(split_part(p_ref,':',2)) funding
  JOIN platform_outbox_jobs original ON original.job_type='notification.assessment.funding' AND original.payload->>'eventRef'=funding.event_id
   AND original.enqueued_by_account_id=funding.actor_account_id AND original.enqueued_by_role=funding.actor_role
  WHERE funding.notification_type=p_type;
 END IF;
END;$$;

CREATE FUNCTION platform_assurance_event_recipients(p_type TEXT,p_ref TEXT)
RETURNS TABLE(account_id TEXT,role TEXT,tenant_id TEXT,membership_id TEXT,notification_type TEXT,target_key TEXT,target_reference TEXT)
LANGUAGE sql VOLATILE AS $$
 WITH source AS (SELECT * FROM platform_assurance_event_source(p_type,p_ref)), candidates AS (
  SELECT source.worker_account_id AS account_id,'worker'::TEXT AS role,NULL::TEXT AS tenant_id,NULL::TEXT AS membership_id,source.event_type AS notification_type,
   CASE WHEN p_type='decision.recorded' THEN 'worker.assurance.case'
    WHEN p_type='credential.issued' THEN 'worker.credential.record'
    WHEN p_type LIKE 'appeal.%' THEN 'appeal.record'
    WHEN source.evidence_kind='identity' THEN 'worker.identity.record'
    WHEN source.evidence_kind='supervisor_observation' THEN 'worker.observation.record'
    ELSE 'worker.evidence.record' END::TEXT AS target_key,source.record_ref AS target_reference
  FROM source WHERE p_type NOT LIKE 'assessment.funding.%'
   AND (p_type NOT LIKE 'evidence.%' OR
    EXISTS(SELECT 1 FROM worker_evidence_records records WHERE records.record_id=source.record_ref
     AND records.worker_account_id=source.worker_account_id AND records.current_version_id=source.source_version AND records.lifecycle_status='active')
    OR EXISTS(SELECT 1 FROM worker_identities identities JOIN worker_identity_versions versions ON versions.identity_id=identities.identity_id
     WHERE identities.identity_id=source.record_ref AND identities.worker_account_id=source.worker_account_id
      AND versions.identity_version_id=source.source_version AND versions.version_number=identities.current_version_number)
    OR EXISTS(SELECT 1 FROM supervisor_observations observations WHERE observations.observation_id=source.source_version AND observations.worker_account_id=source.worker_account_id AND observations.case_id=source.case_ref))
  UNION ALL
  SELECT verifier.account_id,'verifier',NULL,NULL,p_type,'verifier.review.task',tasks.task_id
  FROM source JOIN evidence_review_tasks tasks ON tasks.source_record_id=source.record_ref AND tasks.source_version_id=source.source_version
   AND tasks.worker_account_id=source.worker_account_id AND tasks.task_status IN ('QUEUED','ASSIGNED')
  JOIN auth_account_roles verifier ON verifier.role='verifier'
   AND (tasks.assigned_verifier_account_id IS NULL OR tasks.assigned_verifier_account_id=verifier.account_id)
  WHERE p_type='evidence.submitted'
   AND EXISTS(SELECT 1 FROM worker_evidence_records records WHERE records.record_id=source.record_ref AND records.current_version_id=source.source_version AND records.lifecycle_status='active')
   AND NOT EXISTS(SELECT 1 FROM evidence_review_conflicts conflicts WHERE conflicts.task_id=tasks.task_id AND conflicts.verifier_account_id=verifier.account_id)
  UNION ALL
  SELECT admins.account_id,'admin',NULL,NULL,p_type,'appeal.record',source.record_ref
  FROM source JOIN auth_account_roles admins ON admins.role='admin'
  JOIN credential_appeals appeals ON appeals.appeal_id=source.record_ref
  WHERE p_type='appeal.submitted' AND appeals.status IN ('submitted','under_review')
  UNION ALL
  SELECT members.account_id,'company',members.tenant_id,members.membership_id,p_type,'company.assurance.case',cases.order_id||'#'||cases.case_id
  FROM source JOIN assurance_cases cases ON cases.case_id=source.case_ref AND cases.tenant_id=source.source_tenant
  JOIN company_worker_links links ON links.link_id=cases.worker_link_id AND links.tenant_id=cases.tenant_id
   AND links.worker_account_id=cases.worker_account_id AND links.link_status='active'
  JOIN auth_tenant_memberships members ON members.tenant_id=cases.tenant_id AND members.portal_role='company' AND members.membership_status='active'
  JOIN platform_tenants tenants ON tenants.tenant_id=members.tenant_id AND tenants.tenant_status='active'
  JOIN auth_tenant_role_permission_ceiling ceiling ON ceiling.membership_role=members.membership_role AND ceiling.permission_key='company.orders.read'
  WHERE p_type='decision.recorded' AND NOT EXISTS(SELECT 1 FROM auth_tenant_permission_overrides denied
   WHERE denied.membership_id=members.membership_id AND denied.membership_role=members.membership_role AND denied.permission_key='company.orders.read' AND denied.effect='deny')
  UNION ALL
  SELECT funding.* FROM platform_assessment_funding_notification_recipients(split_part(p_ref,':',2)) funding
   WHERE p_type IN ('assessment.funding.requested','assessment.funding.approved') AND funding.notification_type=p_type
 )
 SELECT DISTINCT candidates.* FROM candidates JOIN auth_accounts accounts ON accounts.account_id=candidates.account_id AND accounts.account_status='active'
 JOIN auth_account_roles roles ON roles.account_id=candidates.account_id AND roles.role=candidates.role;
$$;

CREATE FUNCTION platform_assurance_event_assert_job(job platform_outbox_jobs)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE source RECORD; expected_key TEXT; value_type TEXT;
BEGIN
 IF job.job_type NOT IN ('notification.assurance.event','email.assurance.event') OR job.schema_version<>1
  OR jsonb_typeof(job.payload)<>'object' OR octet_length(job.payload::TEXT)>2048
  OR jsonb_typeof(job.payload->'eventType')<>'string' OR jsonb_typeof(job.payload->'eventRef')<>'string'
  OR NOT(job.payload ?& ARRAY['eventType','eventRef'])
 THEN RAISE EXCEPTION 'Invalid assurance event payload' USING ERRCODE='23514'; END IF;
 IF job.job_type='notification.assurance.event' THEN
  IF job.payload-ARRAY['eventType','eventRef']<>'{}'::jsonb OR job.payload->>'eventType' NOT IN ('evidence.submitted','evidence.reviewed','evidence.additional.requested','decision.recorded','credential.issued','appeal.submitted','appeal.updated') THEN
   RAISE EXCEPTION 'Invalid assurance notification type' USING ERRCODE='23514'; END IF;
  expected_key:=encode(sha256(convert_to(job.job_type||':'||(job.payload->>'eventType')||':'||(job.payload->>'eventRef'),'UTF8')),'hex');
 ELSE
  IF job.payload-ARRAY['eventType','eventRef','recipientRef','recipientRole','membershipRef']<>'{}'::jsonb
   OR NOT(job.payload ?& ARRAY['eventType','eventRef','recipientRef','recipientRole','membershipRef'])
   OR jsonb_typeof(job.payload->'recipientRef')<>'string' OR job.payload->>'recipientRef' !~ '^[A-Za-z0-9_-]{1,160}$'
   OR jsonb_typeof(job.payload->'recipientRole')<>'string'
   OR job.payload->>'recipientRole' NOT IN ('worker','company','verifier','assessor','admin','root')
   OR (job.payload->>'recipientRole'='company' AND (jsonb_typeof(job.payload->'membershipRef')<>'string' OR job.payload->>'membershipRef' !~ '^[A-Za-z0-9_-]{1,160}$'))
   OR (job.payload->>'recipientRole'<>'company' AND jsonb_typeof(job.payload->'membershipRef')<>'null')
  THEN RAISE EXCEPTION 'Invalid assurance email recipient payload' USING ERRCODE='23514'; END IF;
  expected_key:=encode(sha256(convert_to(job.job_type||':'||(job.payload->>'eventType')||':'||(job.payload->>'eventRef')||':'||
   (job.payload->>'recipientRef')||':'||(job.payload->>'recipientRole')||':'||coalesce(job.payload->>'membershipRef',''),'UTF8')),'hex');
 END IF;
 SELECT * INTO source FROM platform_assurance_event_source(job.payload->>'eventType',job.payload->>'eventRef');
 IF NOT FOUND OR job.enqueued_by_account_id IS DISTINCT FROM source.actor_account_id OR job.enqueued_by_role IS DISTINCT FROM source.actor_role
  OR job.enqueued_system_component IS DISTINCT FROM source.system_component OR job.tenant_id IS DISTINCT FROM source.actor_tenant
  OR job.membership_id IS DISTINCT FROM source.actor_membership OR job.idempotency_key IS DISTINCT FROM expected_key
  OR job.job_id IS DISTINCT FROM 'job_'||substr(expected_key,1,24)
 THEN RAISE EXCEPTION 'Assurance job must match its immutable source and canonical identity' USING ERRCODE='23514'; END IF;
 IF job.job_type='email.assurance.event' AND NOT EXISTS(SELECT 1 FROM platform_assurance_event_recipients(job.payload->>'eventType',job.payload->>'eventRef') eligible
  WHERE eligible.account_id=job.payload->>'recipientRef' AND eligible.role=job.payload->>'recipientRole'
   AND eligible.membership_id IS NOT DISTINCT FROM job.payload->>'membershipRef')
 THEN RAISE EXCEPTION 'Assurance email recipient is not currently authorized' USING ERRCODE='23514'; END IF;
END;$$;

CREATE FUNCTION platform_assurance_event_job_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.job_id,NEW.job_type,NEW.schema_version,NEW.idempotency_key,NEW.payload,NEW.enqueued_by_account_id,NEW.enqueued_by_role,NEW.enqueued_system_component,NEW.tenant_id,NEW.membership_id)
   IS DISTINCT FROM ROW(OLD.job_id,OLD.job_type,OLD.schema_version,OLD.idempotency_key,OLD.payload,OLD.enqueued_by_account_id,OLD.enqueued_by_role,OLD.enqueued_system_component,OLD.tenant_id,OLD.membership_id)
  THEN RAISE EXCEPTION 'Assurance event job identity is immutable' USING ERRCODE='55000'; END IF;
 ELSE PERFORM platform_assurance_event_assert_job(NEW); END IF; RETURN NEW;
END;$$;
CREATE TRIGGER platform_assurance_event_jobs_validate_insert BEFORE INSERT ON platform_outbox_jobs
 FOR EACH ROW WHEN(NEW.job_type IN ('notification.assurance.event','email.assurance.event')) EXECUTE FUNCTION platform_assurance_event_job_guard();
CREATE TRIGGER platform_assurance_event_jobs_guard_update BEFORE UPDATE ON platform_outbox_jobs
 FOR EACH ROW WHEN(OLD.job_type IN ('notification.assurance.event','email.assurance.event') OR NEW.job_type IN ('notification.assurance.event','email.assurance.event')) EXECUTE FUNCTION platform_assurance_event_job_guard();

CREATE FUNCTION platform_enqueue_assurance_event_notifications(p_type TEXT,p_ref TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE source RECORD; recipient RECORD; dedup_key TEXT; created_job TEXT; count_queued INTEGER:=0;
BEGIN
 SELECT * INTO source FROM platform_assurance_event_source(p_type,p_ref);
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid assurance notification source' USING ERRCODE='23514'; END IF;
 -- Legacy orphan records without an authenticated source actor have no authorized notification producer.
 IF source.actor_account_id IS NULL AND source.system_component IS NULL THEN RETURN 0; END IF;
 IF p_type NOT LIKE 'assessment.funding.%' THEN
  dedup_key:=encode(sha256(convert_to('notification.assurance.event:'||p_type||':'||p_ref,'UTF8')),'hex');
  INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,enqueued_by_account_id,enqueued_by_role,enqueued_system_component,tenant_id,membership_id)
  VALUES('job_'||substr(dedup_key,1,24),'notification.assurance.event',1,dedup_key,jsonb_build_object('eventType',p_type,'eventRef',p_ref),
   source.actor_account_id,source.actor_role,source.system_component,source.actor_tenant,source.actor_membership)
  ON CONFLICT(job_type,idempotency_key) DO NOTHING RETURNING job_id INTO created_job;
  IF created_job IS NOT NULL THEN
   count_queued:=count_queued+1;
   INSERT INTO platform_audit_events(audit_event_id,source_kind,actor_account_id,actor_role,actor_tenant_id,actor_membership_id,action_key,outcome,target_type,target_reference,metadata)
   VALUES('audit_'||created_job,'native',source.actor_account_id,source.actor_role,source.actor_tenant,source.actor_membership,'outbox.job.enqueued','succeeded','job',created_job,
    jsonb_build_object('jobType','notification.assurance.event','sourceEventRef',p_ref));
  END IF;
 END IF;
 FOR recipient IN SELECT eligible.*,accounts.email_normalized FROM platform_assurance_event_recipients(p_type,p_ref) eligible
  JOIN auth_accounts accounts ON accounts.account_id=eligible.account_id AND accounts.email_verified_at IS NOT NULL
 LOOP
  dedup_key:=encode(sha256(convert_to('email.assurance.event:'||p_type||':'||p_ref||':'||recipient.account_id||':'||recipient.role||':'||coalesce(recipient.membership_id,''),'UTF8')),'hex');
  created_job:=NULL;
  INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,enqueued_by_account_id,enqueued_by_role,enqueued_system_component,tenant_id,membership_id)
  VALUES('job_'||substr(dedup_key,1,24),'email.assurance.event',1,dedup_key,jsonb_build_object('eventType',p_type,'eventRef',p_ref,
   'recipientRef',recipient.account_id,'recipientRole',recipient.role,'membershipRef',recipient.membership_id),
   source.actor_account_id,source.actor_role,source.system_component,source.actor_tenant,source.actor_membership)
  ON CONFLICT(job_type,idempotency_key) DO NOTHING RETURNING job_id INTO created_job;
  IF created_job IS NOT NULL THEN
   INSERT INTO platform_email_deliveries(delivery_id,delivery_type,schema_version,source_job_id,delivery_key,recipient_account_id,recipient_role,tenant_id,membership_id,recipient_address_hash)
   VALUES('email_delivery_'||substr(dedup_key,1,24),p_type,1,created_job,dedup_key,recipient.account_id,recipient.role,recipient.tenant_id,recipient.membership_id,
    encode(sha256(convert_to(lower(btrim(recipient.email_normalized)),'UTF8')),'hex'));
   count_queued:=count_queued+1;
   INSERT INTO platform_audit_events(audit_event_id,source_kind,actor_account_id,actor_role,actor_tenant_id,actor_membership_id,action_key,outcome,target_type,target_reference,metadata)
   VALUES('audit_'||created_job,'native',source.actor_account_id,source.actor_role,source.actor_tenant,source.actor_membership,'outbox.job.enqueued','succeeded','job',created_job,
    jsonb_build_object('jobType','email.assurance.event','sourceEventRef',p_ref));
   INSERT INTO platform_audit_events(audit_event_id,source_kind,actor_account_id,actor_role,actor_tenant_id,actor_membership_id,action_key,outcome,target_type,target_reference,metadata)
   VALUES('audit_email_'||created_job,'native',source.actor_account_id,source.actor_role,source.actor_tenant,source.actor_membership,'email.delivery.queued','succeeded','email_delivery','email_delivery_'||substr(dedup_key,1,24),
    jsonb_build_object('deliveryType',p_type,'sourceJobId',created_job,'recipientRole',recipient.role));
  END IF;
 END LOOP;
 RETURN count_queued;
END;$$;

CREATE FUNCTION platform_assurance_notification_title(p_type TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE p_type WHEN 'evidence.submitted' THEN 'Evidence submitted' WHEN 'evidence.reviewed' THEN 'Evidence review recorded' WHEN 'evidence.additional.requested' THEN 'Additional evidence requested' WHEN 'decision.recorded' THEN 'Assurance decision recorded' WHEN 'credential.issued' THEN 'Credential issued' WHEN 'appeal.submitted' THEN 'Appeal submitted' WHEN 'appeal.updated' THEN 'Appeal review updated' END;
$$;
CREATE FUNCTION platform_assurance_event_validate_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE job platform_outbox_jobs%ROWTYPE; recipient RECORD; projection_ref TEXT;
BEGIN
 SELECT * INTO job FROM platform_outbox_jobs WHERE job_id=NEW.source_job_id;
 IF NOT FOUND OR job.job_type<>'notification.assurance.event' THEN RAISE EXCEPTION 'Invalid assurance projection source' USING ERRCODE='23514'; END IF;
 PERFORM platform_assurance_event_assert_job(job);
 SELECT * INTO recipient FROM platform_assurance_event_recipients(job.payload->>'eventType',job.payload->>'eventRef')
  WHERE account_id=NEW.recipient_account_id AND role=NEW.recipient_role AND tenant_id IS NOT DISTINCT FROM NEW.tenant_id AND membership_id IS NOT DISTINCT FROM NEW.membership_id;
 projection_ref:=encode(sha256(convert_to(job.job_id||':'||(job.payload->>'eventType')||':'||NEW.recipient_account_id||':'||NEW.recipient_role||':'||coalesce(NEW.tenant_id,'platform'),'UTF8')),'hex');
 IF NOT FOUND OR NEW.notification_type IS DISTINCT FROM recipient.notification_type OR NEW.target_key IS DISTINCT FROM recipient.target_key OR NEW.target_reference IS DISTINCT FROM recipient.target_reference
  OR NEW.schema_version<>1 OR NEW.title IS DISTINCT FROM platform_assurance_notification_title(job.payload->>'eventType')
  OR NEW.body<>'Open the record for the current status and next action.'
  OR NEW.metadata IS DISTINCT FROM jsonb_build_object('eventRef',job.payload->>'eventRef')
  OR NEW.projection_key IS DISTINCT FROM projection_ref OR NEW.notification_id IS DISTINCT FROM 'notification_'||substr(projection_ref,1,24) OR NEW.read_at IS NOT NULL
 THEN RAISE EXCEPTION 'Assurance notification must match its authorized source' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;$$;
DROP TRIGGER platform_notifications_validate_insert ON platform_notifications;
CREATE TRIGGER platform_notifications_validate_insert BEFORE INSERT ON platform_notifications
 FOR EACH ROW WHEN(NEW.notification_type NOT IN ('interview.scheduled','interview.reminder','assessment.funding.requested','assessment.funding.approved','evidence.submitted','evidence.reviewed','evidence.additional.requested','decision.recorded','credential.issued','appeal.submitted','appeal.updated'))
 EXECUTE FUNCTION platform_notification_validate_projection();
CREATE TRIGGER platform_assurance_notifications_validate_insert BEFORE INSERT ON platform_notifications
 FOR EACH ROW WHEN(NEW.notification_type IN ('evidence.submitted','evidence.reviewed','evidence.additional.requested','decision.recorded','credential.issued','appeal.submitted','appeal.updated')) EXECUTE FUNCTION platform_assurance_event_validate_projection();

CREATE FUNCTION platform_project_assurance_event_notification(p_job TEXT)
RETURNS TABLE(created INTEGER,suppressed BOOLEAN) LANGUAGE plpgsql AS $$
DECLARE job platform_outbox_jobs%ROWTYPE; recipient RECORD; projection_ref TEXT; inserted_id TEXT; count_created INTEGER:=0; count_eligible INTEGER:=0;
BEGIN
 SELECT * INTO job FROM platform_outbox_jobs WHERE job_id=p_job;
 IF NOT FOUND OR job.job_type<>'notification.assurance.event' THEN RAISE EXCEPTION 'Invalid assurance notification job' USING ERRCODE='23514'; END IF;
 PERFORM platform_assurance_event_assert_job(job);
 FOR recipient IN SELECT * FROM platform_assurance_event_recipients(job.payload->>'eventType',job.payload->>'eventRef')
 LOOP
  count_eligible:=count_eligible+1;
  projection_ref:=encode(sha256(convert_to(job.job_id||':'||(job.payload->>'eventType')||':'||recipient.account_id||':'||recipient.role||':'||coalesce(recipient.tenant_id,'platform'),'UTF8')),'hex');
  inserted_id:=NULL;
  INSERT INTO platform_notifications(notification_id,notification_type,schema_version,source_job_id,projection_key,recipient_account_id,recipient_role,tenant_id,membership_id,title,body,metadata,target_key,target_reference)
  VALUES('notification_'||substr(projection_ref,1,24),recipient.notification_type,1,job.job_id,projection_ref,recipient.account_id,recipient.role,recipient.tenant_id,recipient.membership_id,
   platform_assurance_notification_title(job.payload->>'eventType'),'Open the record for the current status and next action.',
   jsonb_build_object('eventRef',job.payload->>'eventRef'),recipient.target_key,recipient.target_reference)
  ON CONFLICT(projection_key) DO NOTHING RETURNING notification_id INTO inserted_id;
  IF inserted_id IS NOT NULL THEN count_created:=count_created+1; END IF;
 END LOOP;
 RETURN QUERY SELECT count_created,count_eligible=0;
END;$$;

CREATE FUNCTION platform_assurance_email_validate_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE job platform_outbox_jobs%ROWTYPE; recipient RECORD;
BEGIN
 SELECT * INTO job FROM platform_outbox_jobs WHERE job_id=NEW.source_job_id;
 IF NOT FOUND OR job.job_type<>'email.assurance.event' THEN RAISE EXCEPTION 'Invalid assurance email source' USING ERRCODE='23514'; END IF;
 PERFORM platform_assurance_event_assert_job(job);
 SELECT eligible.*,accounts.email_normalized INTO recipient FROM platform_assurance_event_recipients(job.payload->>'eventType',job.payload->>'eventRef') eligible
 JOIN auth_accounts accounts ON accounts.account_id=eligible.account_id AND accounts.email_verified_at IS NOT NULL
 WHERE eligible.account_id=job.payload->>'recipientRef' AND eligible.role=job.payload->>'recipientRole' AND eligible.membership_id IS NOT DISTINCT FROM job.payload->>'membershipRef';
 IF NOT FOUND OR NEW.delivery_type IS DISTINCT FROM job.payload->>'eventType' OR NEW.schema_version<>1
  OR NEW.delivery_key IS DISTINCT FROM job.idempotency_key OR NEW.delivery_id IS DISTINCT FROM 'email_delivery_'||substr(job.idempotency_key,1,24)
  OR NEW.recipient_account_id IS DISTINCT FROM recipient.account_id OR NEW.recipient_role IS DISTINCT FROM recipient.role
  OR NEW.tenant_id IS DISTINCT FROM recipient.tenant_id OR NEW.membership_id IS DISTINCT FROM recipient.membership_id
  OR NEW.recipient_address_hash IS DISTINCT FROM encode(sha256(convert_to(lower(btrim(recipient.email_normalized)),'UTF8')),'hex')
  OR NEW.status<>'queued' OR NEW.attempt_count<>0 OR NEW.last_result_code IS NOT NULL OR NEW.last_result_summary IS NOT NULL OR NEW.delivered_at IS NOT NULL OR NEW.terminal_failed_at IS NOT NULL
 THEN RAISE EXCEPTION 'Assurance email must match its authorized source' USING ERRCODE='23514'; END IF; RETURN NEW;
END;$$;
DROP TRIGGER platform_email_deliveries_validate_insert ON platform_email_deliveries;
CREATE TRIGGER platform_email_deliveries_validate_insert BEFORE INSERT ON platform_email_deliveries
 FOR EACH ROW WHEN(NEW.delivery_type NOT IN ('interview.scheduled','interview.reminder','evidence.submitted','evidence.reviewed','evidence.additional.requested','decision.recorded','credential.issued','appeal.submitted','appeal.updated','assessment.funding.requested','assessment.funding.approved')) EXECUTE FUNCTION platform_email_delivery_validate_insert();
CREATE TRIGGER platform_assurance_emails_validate_insert BEFORE INSERT ON platform_email_deliveries
 FOR EACH ROW WHEN(NEW.delivery_type IN ('evidence.submitted','evidence.reviewed','evidence.additional.requested','decision.recorded','credential.issued','appeal.submitted','appeal.updated','assessment.funding.requested','assessment.funding.approved')) EXECUTE FUNCTION platform_assurance_email_validate_insert();
DO $$
DECLARE definition TEXT;BEGIN
 SELECT pg_get_functiondef('platform_interview_email_guard_update()'::regprocedure) INTO definition;
 definition:=replace(definition,'platform_interview_email_guard_update()','platform_assurance_email_guard_update()');
 definition:=replace(definition,'(OLD.status IN (''queued'',''retry_wait'') AND NEW.status=''suppressed'') OR',
  '(OLD.status IN (''queued'',''retry_wait'') AND (NEW.status=''suppressed'' OR (NEW.status=''terminal_failed'' AND EXISTS(SELECT 1 FROM platform_outbox_jobs jobs WHERE jobs.job_id=NEW.source_job_id AND jobs.status=''terminal_failed'')))) OR');
 EXECUTE definition;
END;$$;
DROP TRIGGER platform_email_deliveries_guard_update ON platform_email_deliveries;
CREATE TRIGGER platform_email_deliveries_guard_update BEFORE UPDATE ON platform_email_deliveries
 FOR EACH ROW WHEN(NEW.delivery_type NOT IN ('interview.scheduled','interview.reminder','evidence.submitted','evidence.reviewed','evidence.additional.requested','decision.recorded','credential.issued','appeal.submitted','appeal.updated','assessment.funding.requested','assessment.funding.approved')) EXECUTE FUNCTION platform_email_delivery_guard_update();
CREATE TRIGGER platform_assurance_emails_guard_update BEFORE UPDATE ON platform_email_deliveries
 FOR EACH ROW WHEN(NEW.delivery_type IN ('evidence.submitted','evidence.reviewed','evidence.additional.requested','decision.recorded','credential.issued','appeal.submitted','appeal.updated','assessment.funding.requested','assessment.funding.approved')) EXECUTE FUNCTION platform_assurance_email_guard_update();

-- Exact immutable source histories; no reconstruction of old notifications and no new event bank.
CREATE FUNCTION platform_capture_assurance_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind TEXT; reference TEXT; source_audit TEXT;
BEGIN
 IF TG_TABLE_NAME='platform_audit_events' THEN
  IF NEW.action_key='worker_evidence.version.submitted' AND NEW.outcome='succeeded' THEN kind:='evidence.submitted';reference:='audit:'||NEW.audit_event_id; END IF;
 ELSIF TG_TABLE_NAME='evidence_review_decisions' THEN
  kind:=CASE WHEN NEW.outcome='CHANGES_REQUESTED' THEN 'evidence.additional.requested' ELSE 'evidence.reviewed' END;reference:='review:'||NEW.decision_id;
 ELSIF TG_TABLE_NAME='assurance_case_timeline_events' THEN
  IF NEW.event_type IN ('decision_recorded','decision_override_applied') THEN kind:='decision.recorded';reference:='case:'||NEW.timeline_event_id; END IF;
 ELSIF TG_TABLE_NAME='credential_issuance_events' THEN
  IF NEW.version=1 AND NEW.status='valid' THEN kind:='credential.issued';reference:='issuance:'||NEW.credential_id||':1'; END IF;
 ELSIF TG_TABLE_NAME='credential_appeal_events' THEN
  kind:=CASE WHEN NEW.version=1 THEN 'appeal.submitted' ELSE 'appeal.updated' END;reference:='appeal:'||NEW.appeal_id||':'||NEW.version;
 ELSIF TG_TABLE_NAME='evidence_review_tasks' THEN
  SELECT audit.audit_event_id INTO source_audit FROM platform_audit_events audit
   WHERE audit.action_key='worker_evidence.version.submitted' AND audit.outcome='succeeded'
    AND audit.actor_account_id=NEW.worker_account_id AND audit.target_reference=NEW.source_record_id AND audit.metadata->>'versionId'=NEW.source_version_id
   ORDER BY audit.audit_sequence DESC LIMIT 1;
  IF source_audit IS NOT NULL THEN kind:='evidence.submitted';reference:='audit:'||source_audit; END IF;
 END IF;
 IF kind IS NOT NULL THEN PERFORM platform_enqueue_assurance_event_notifications(kind,reference); END IF; RETURN NEW;
END;$$;
CREATE TRIGGER platform_capture_evidence_submission AFTER INSERT ON platform_audit_events
 FOR EACH ROW WHEN(NEW.action_key='worker_evidence.version.submitted' AND NEW.outcome='succeeded') EXECUTE FUNCTION platform_capture_assurance_event();
CREATE TRIGGER platform_capture_evidence_review AFTER INSERT ON evidence_review_decisions FOR EACH ROW EXECUTE FUNCTION platform_capture_assurance_event();
CREATE TRIGGER platform_capture_decision AFTER INSERT ON assurance_case_timeline_events
 FOR EACH ROW WHEN(NEW.event_type IN ('decision_recorded','decision_override_applied')) EXECUTE FUNCTION platform_capture_assurance_event();
CREATE TRIGGER platform_capture_credential AFTER INSERT ON credential_issuance_events
 FOR EACH ROW WHEN(NEW.version=1 AND NEW.status='valid') EXECUTE FUNCTION platform_capture_assurance_event();
CREATE TRIGGER platform_capture_appeal AFTER INSERT ON credential_appeal_events FOR EACH ROW EXECUTE FUNCTION platform_capture_assurance_event();
CREATE TRIGGER platform_capture_evidence_queue AFTER INSERT ON evidence_review_tasks FOR EACH ROW EXECUTE FUNCTION platform_capture_assurance_event();
