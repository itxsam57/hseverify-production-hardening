CREATE TABLE interview_recommendation_events (
 event_id TEXT PRIMARY KEY,
 interview_request_id TEXT NOT NULL UNIQUE REFERENCES interview_requests(interview_request_id),
 tenant_id TEXT NOT NULL, case_id TEXT NOT NULL,
 assessor_account_id TEXT NOT NULL REFERENCES auth_accounts(account_id),
 recommendation TEXT NOT NULL CHECK(recommendation IN ('PASS','CONDITIONAL_PASS','FAIL','ADDITIONAL_EVIDENCE_REQUIRED','REASSESSMENT_REQUIRED','SECOND_INTERVIEW_REQUIRED')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION platform_interview_recommendation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Interview recommendation history is immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM interview_requests requests JOIN interview_console_drafts drafts ON drafts.interview_request_id=requests.interview_request_id AND drafts.tenant_id=requests.tenant_id
  JOIN interview_runtime_sessions runtime ON runtime.interview_request_id=requests.interview_request_id
  WHERE requests.interview_request_id=NEW.interview_request_id AND requests.tenant_id=NEW.tenant_id AND requests.case_id=NEW.case_id
   AND requests.assessor_account_id=NEW.assessor_account_id AND requests.status='COMPLETED' AND drafts.submitted
   AND drafts.recommendation=NEW.recommendation AND runtime.status='ENDED') THEN RAISE EXCEPTION 'Recommendation must match actual completed submission'; END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER platform_interview_recommendation_history BEFORE INSERT OR UPDATE OR DELETE ON interview_recommendation_events FOR EACH ROW EXECUTE FUNCTION platform_interview_recommendation_guard();
-- Extend the authoritative assurance pipeline; retain exact rollback definitions.
DO $$
DECLARE saved JSONB:='[]'::jsonb; item RECORD; definition TEXT;
BEGIN
 FOR item IN SELECT conrelid::regclass::text AS table_name,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
 WHERE (conrelid='platform_notifications'::regclass AND conname IN ('platform_notifications_notification_type_check','platform_notifications_target_key_check'))
 OR (conrelid='platform_email_deliveries'::regclass AND conname='platform_email_deliveries_delivery_type_check')
 LOOP
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','constraint','table',item.table_name,'name',item.conname,'definition',item.definition));
  definition:=regexp_replace(item.definition,'^CHECK \((.*)\)$','\1');
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',item.table_name,item.conname);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((%s) OR %I IN (%s))',item.table_name,item.conname,definition,
   CASE WHEN item.conname LIKE '%target_key%' THEN 'target_key' WHEN item.table_name='platform_notifications' THEN 'notification_type' ELSE 'delivery_type' END,
   CASE WHEN item.conname LIKE '%target_key%' THEN '''admin.interview.case''' ELSE '''interview.recommended''' END);
 END LOOP;
 FOR item IN SELECT indexrelid::regclass::text AS name,pg_get_indexdef(indexrelid) AS definition FROM pg_index
 WHERE indexrelid IN ('platform_notifications_legacy_source_job_idx'::regclass,'platform_notifications_assurance_source_recipient_idx'::regclass)
 LOOP
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','index','name',item.name,'definition',item.definition));
  EXECUTE format('DROP INDEX %I',item.name);
  EXECUTE replace(item.definition,'''evidence.reviewed''','''evidence.reviewed'',''interview.recommended''');
 END LOOP;
 FOR item IN SELECT oid,proname FROM pg_proc WHERE oid IN ('platform_assurance_event_assert_job(platform_outbox_jobs)'::regprocedure,'platform_email_attempt_validate_insert()'::regprocedure,'platform_email_attempt_guard_update()'::regprocedure,'platform_assurance_notification_title(text)'::regprocedure)
 LOOP
  definition:=pg_get_functiondef(item.oid);
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','function','reference',item.oid::regprocedure::text,'definition',definition));
  IF item.proname='platform_assurance_notification_title' THEN
   definition:=replace(definition,'WHEN ''evidence.reviewed''','WHEN ''interview.recommended'' THEN ''Interview recommendation submitted'' WHEN ''evidence.reviewed''');
  ELSE definition:=replace(definition,'''evidence.reviewed''','''evidence.reviewed'',''interview.recommended'''); END IF;
  EXECUTE definition;
 END LOOP;
 FOR item IN SELECT tgname,pg_get_triggerdef(oid) AS definition,tgrelid::regclass::text AS table_name FROM pg_trigger
 WHERE NOT tgisinternal AND tgname IN ('platform_notifications_validate_insert','platform_assurance_notifications_validate_insert','platform_email_deliveries_validate_insert','platform_assurance_emails_validate_insert','platform_email_deliveries_guard_update','platform_assurance_emails_guard_update')
 LOOP
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','trigger','name',item.tgname,'table',item.table_name,'definition',item.definition));
  EXECUTE format('DROP TRIGGER %I ON %I',item.tgname,item.table_name);
  EXECUTE replace(item.definition,'''evidence.reviewed''','''evidence.reviewed'',''interview.recommended''');
 END LOOP;
 EXECUTE format('CREATE FUNCTION platform_interview_recommendation_notification_rollback_contract() RETURNS JSONB LANGUAGE sql IMMUTABLE AS %L','SELECT '||quote_literal(saved::text)||'::jsonb');
END;$$;


ALTER FUNCTION platform_assurance_event_source(TEXT,TEXT) RENAME TO platform_assurance_event_source_before_interview_recommendation;
CREATE FUNCTION platform_assurance_event_source(p_type TEXT,p_ref TEXT)
RETURNS TABLE(event_type TEXT,event_ref TEXT,record_ref TEXT,source_version TEXT,evidence_kind TEXT,
 worker_account_id TEXT,source_tenant TEXT,case_ref TEXT,actor_account_id TEXT,actor_role TEXT,
 actor_tenant TEXT,actor_membership TEXT,system_component TEXT)
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
 IF p_type<>'interview.recommended' THEN RETURN QUERY SELECT * FROM platform_assurance_event_source_before_interview_recommendation(p_type,p_ref); RETURN; END IF;
 IF p_ref !~ '^recommendation:[A-Za-z0-9_-]{1,160}$' OR char_length(p_ref)>192 THEN RETURN; END IF;
 RETURN QUERY SELECT p_type,p_ref,events.case_id,events.interview_request_id,NULL::TEXT,requests.worker_account_id,
 events.tenant_id,events.case_id,events.assessor_account_id,'assessor'::TEXT,NULL::TEXT,NULL::TEXT,NULL::TEXT
 FROM interview_recommendation_events events JOIN interview_requests requests ON requests.interview_request_id=events.interview_request_id
 AND requests.tenant_id=events.tenant_id AND requests.case_id=events.case_id AND requests.assessor_account_id=events.assessor_account_id
 WHERE events.event_id=split_part(p_ref,':',2) AND requests.status='COMPLETED';
END;$$;
ALTER FUNCTION platform_assurance_event_recipients(TEXT,TEXT) RENAME TO platform_assurance_event_recipients_before_interview_recommendation;
CREATE FUNCTION platform_assurance_event_recipients(p_type TEXT,p_ref TEXT)
RETURNS TABLE(account_id TEXT,role TEXT,tenant_id TEXT,membership_id TEXT,notification_type TEXT,target_key TEXT,target_reference TEXT)
LANGUAGE sql VOLATILE AS $$
 WITH source AS (SELECT source.*,cases.order_id,cases.owner_kind FROM platform_assurance_event_source(p_type,p_ref) source
 JOIN assurance_cases cases ON cases.case_id=source.case_ref AND cases.tenant_id=source.source_tenant AND cases.worker_account_id=source.worker_account_id
 JOIN interview_recommendation_events events ON 'recommendation:'||events.event_id=p_ref
 WHERE p_type='interview.recommended'
 AND NOT EXISTS(SELECT 1 FROM interview_recommendation_events newer WHERE newer.case_id=events.case_id AND newer.tenant_id=events.tenant_id AND newer.created_at>events.created_at)),
 candidates AS (
 SELECT * FROM platform_assurance_event_recipients_before_interview_recommendation(p_type,p_ref) WHERE p_type<>'interview.recommended'
 UNION ALL SELECT worker_account_id,'worker',NULL,NULL,p_type,'worker.assurance.case',case_ref FROM source
 UNION ALL SELECT members.account_id,'company',members.tenant_id,members.membership_id,p_type,'company.assurance.case',source.order_id||'#'||source.case_ref
 FROM source JOIN assurance_cases cases ON cases.case_id=source.case_ref AND cases.tenant_id=source.source_tenant
 JOIN company_worker_links links ON links.link_id=cases.worker_link_id AND links.tenant_id=cases.tenant_id AND links.worker_account_id=source.worker_account_id AND links.link_status='active'
 JOIN auth_tenant_memberships members ON members.tenant_id=source.source_tenant AND members.portal_role='company' AND members.membership_status='active'
 JOIN platform_tenants tenants ON tenants.tenant_id=members.tenant_id AND tenants.tenant_status='active'
 JOIN auth_tenant_role_permission_ceiling ceiling ON ceiling.membership_role=members.membership_role AND ceiling.permission_key='company.orders.read'
 WHERE NOT EXISTS(SELECT 1 FROM auth_tenant_permission_overrides denied WHERE denied.membership_id=members.membership_id AND denied.membership_role=members.membership_role AND denied.permission_key='company.orders.read' AND denied.effect='deny')
 UNION ALL SELECT admins.account_id,'admin',NULL,NULL,p_type,'admin.interview.case',source.source_tenant||'#'||source.case_ref
 FROM source JOIN auth_account_roles admins ON admins.role='admin' WHERE source.owner_kind='admin'
 )
 SELECT DISTINCT candidates.* FROM candidates JOIN auth_accounts accounts ON accounts.account_id=candidates.account_id AND accounts.account_status='active'
 JOIN auth_account_roles roles ON roles.account_id=candidates.account_id AND roles.role=candidates.role;
$$;

-- Refuse rollback if any extended boundary drifted after installation.
DO $$
DECLARE installed JSONB:='[]'::jsonb; item JSONB; definition TEXT;
BEGIN
 FOR item IN SELECT * FROM jsonb_array_elements(platform_interview_recommendation_notification_rollback_contract()) LOOP
 IF item->>'kind'='constraint' THEN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid=(item->>'table')::regclass AND conname=item->>'name';
 ELSIF item->>'kind'='index' THEN SELECT pg_get_indexdef((item->>'name')::regclass) INTO definition;
 ELSIF item->>'kind'='trigger' THEN SELECT pg_get_triggerdef(oid) INTO definition FROM pg_trigger WHERE tgname=item->>'name' AND tgrelid=(item->>'table')::regclass;
 ELSE SELECT pg_get_functiondef(oid) INTO definition FROM pg_proc WHERE oid=(item->>'reference')::regprocedure;
 END IF;
 installed:=installed||jsonb_build_array(item||jsonb_build_object('definition',definition));
 END LOOP;
 installed:=installed||jsonb_build_array(jsonb_build_object('kind','wrapper','reference','platform_assurance_event_source(text,text)','definition',pg_get_functiondef('platform_assurance_event_source(text,text)'::regprocedure)),
 jsonb_build_object('kind','wrapper','reference','platform_assurance_event_recipients(text,text)','definition',pg_get_functiondef('platform_assurance_event_recipients(text,text)'::regprocedure)));
 EXECUTE format('CREATE FUNCTION platform_interview_recommendation_installed_contract() RETURNS JSONB LANGUAGE sql IMMUTABLE AS %L','SELECT '||quote_literal(installed::text)||'::jsonb');
END;$$;
