-- Extend the authoritative assurance pipeline; retain exact rollback definitions.
DO $$
DECLARE saved JSONB:='[]'::jsonb; item RECORD; definition TEXT;
BEGIN
 FOR item IN SELECT conrelid::regclass::text AS table_name,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
 WHERE (conrelid='platform_notifications'::regclass AND conname IN ('platform_notifications_notification_type_check'))
 OR (conrelid='platform_email_deliveries'::regclass AND conname='platform_email_deliveries_delivery_type_check')
 LOOP
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','constraint','table',item.table_name,'name',item.conname,'definition',item.definition));
  definition:=regexp_replace(item.definition,'^CHECK \((.*)\)$','\1');
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',item.table_name,item.conname);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((%s) OR %I IN (%s))',item.table_name,item.conname,definition,
   CASE WHEN item.table_name='platform_notifications' THEN 'notification_type' ELSE 'delivery_type' END,
   '''appeal.evidence.submitted'',''appeal.interview.submitted''');
 END LOOP;
 FOR item IN SELECT indexrelid::regclass::text AS name,pg_get_indexdef(indexrelid) AS definition FROM pg_index
 WHERE indexrelid IN ('platform_notifications_legacy_source_job_idx'::regclass,'platform_notifications_assurance_source_recipient_idx'::regclass)
 LOOP
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','index','name',item.name,'definition',item.definition));
  EXECUTE format('DROP INDEX %I',item.name);
  EXECUTE replace(item.definition,'''evidence.reviewed''','''evidence.reviewed'',''appeal.evidence.submitted'',''appeal.interview.submitted''');
 END LOOP;
 FOR item IN SELECT oid,proname FROM pg_proc WHERE oid IN ('platform_capture_assurance_event()'::regprocedure,'platform_assurance_event_assert_job(platform_outbox_jobs)'::regprocedure,'platform_email_attempt_validate_insert()'::regprocedure,'platform_email_attempt_guard_update()'::regprocedure,'platform_assurance_notification_title(text)'::regprocedure)
 LOOP
  definition:=pg_get_functiondef(item.oid);
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','function','reference',item.oid::regprocedure::text,'definition',definition));
  IF item.proname='platform_assurance_notification_title' THEN
   definition:=replace(definition,'WHEN ''evidence.reviewed''','WHEN ''appeal.evidence.submitted'' THEN ''Appeal evidence submitted'' WHEN ''appeal.interview.submitted'' THEN ''Appeal interview submitted'' WHEN ''evidence.reviewed''');
  ELSIF item.proname='platform_capture_assurance_event' THEN
   definition:=regexp_replace(definition,E'BEGIN\n',E'BEGIN\n IF TG_TABLE_NAME=''credential_appeal_events'' THEN\n  IF EXISTS(SELECT 1 FROM credential_appeal_followup_events response WHERE response.appeal_id=NEW.appeal_id AND response.appeal_version=NEW.version AND response.event_type IN (''evidence_submitted'',''interview_submitted'')) THEN RETURN NEW; END IF;\n END IF;\n');
  ELSE definition:=replace(definition,'''evidence.reviewed''','''evidence.reviewed'',''appeal.evidence.submitted'',''appeal.interview.submitted'''); END IF;
  EXECUTE definition;
 END LOOP;
 FOR item IN SELECT tgname,pg_get_triggerdef(oid) AS definition,tgrelid::regclass::text AS table_name FROM pg_trigger
 WHERE NOT tgisinternal AND tgname IN ('platform_notifications_validate_insert','platform_assurance_notifications_validate_insert','platform_email_deliveries_validate_insert','platform_assurance_emails_validate_insert','platform_email_deliveries_guard_update','platform_assurance_emails_guard_update')
 LOOP
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','trigger','name',item.tgname,'table',item.table_name,'definition',item.definition));
  EXECUTE format('DROP TRIGGER %I ON %I',item.tgname,item.table_name);
  EXECUTE replace(item.definition,'''evidence.reviewed''','''evidence.reviewed'',''appeal.evidence.submitted'',''appeal.interview.submitted''');
 END LOOP;
 EXECUTE format('CREATE FUNCTION platform_appeal_response_notice_rollback() RETURNS JSONB LANGUAGE sql IMMUTABLE AS %L','SELECT '||quote_literal(saved::text)||'::jsonb');
END;$$;



ALTER FUNCTION platform_assurance_event_source(TEXT,TEXT) RENAME TO platform_assurance_event_source_before_appeal_response;
CREATE FUNCTION platform_assurance_event_source(p_type TEXT,p_ref TEXT)
RETURNS TABLE(event_type TEXT,event_ref TEXT,record_ref TEXT,source_version TEXT,evidence_kind TEXT,
 worker_account_id TEXT,source_tenant TEXT,case_ref TEXT,actor_account_id TEXT,actor_role TEXT,
 actor_tenant TEXT,actor_membership TEXT,system_component TEXT)
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
 IF p_type='appeal.updated' AND EXISTS(SELECT 1 FROM credential_appeal_followup_events response WHERE response.appeal_id=split_part(p_ref,':',2) AND response.appeal_version::text=split_part(p_ref,':',3) AND response.event_type IN ('evidence_submitted','interview_submitted')) THEN RETURN; END IF;
 IF p_type NOT IN ('appeal.evidence.submitted','appeal.interview.submitted') THEN RETURN QUERY SELECT * FROM platform_assurance_event_source_before_appeal_response(p_type,p_ref); RETURN; END IF;
 IF p_ref !~ '^appeal_followup:[A-Za-z0-9_-]{1,160}$' OR char_length(p_ref)>192 THEN RETURN; END IF;
 RETURN QUERY SELECT p_type,p_ref,appeal.appeal_id,response.event_id,NULL::TEXT,c.worker_account_id,c.tenant_id,c.case_id,response.actor_account_id,
 CASE WHEN p_type='appeal.evidence.submitted' THEN 'worker' ELSE 'assessor' END,NULL::TEXT,NULL::TEXT,NULL::TEXT
 FROM credential_appeal_followup_events response
 JOIN credential_appeal_followup_events request ON request.event_id=response.request_id AND request.appeal_id=response.appeal_id AND request.event_type='requested' AND request.kind=response.kind
 JOIN credential_appeals appeal ON appeal.appeal_id=response.appeal_id
 JOIN credential_issuances credential ON credential.credential_id=appeal.credential_id AND credential.worker_id=appeal.worker_id
 JOIN assurance_cases c ON c.credential_reference=credential.credential_id AND c.permanent_worker_id=credential.worker_id
 WHERE response.event_id=split_part(p_ref,':',2)
 AND ((p_type='appeal.evidence.submitted' AND response.event_type='evidence_submitted' AND response.kind='evidence' AND response.actor_account_id=c.worker_account_id AND jsonb_array_length(response.evidence)>0)
 OR (p_type='appeal.interview.submitted' AND response.event_type='interview_submitted' AND response.kind='interview' AND EXISTS(
 SELECT 1 FROM interview_requests interview JOIN interview_runtime_sessions runtime ON runtime.interview_request_id=interview.interview_request_id AND runtime.status='ENDED'
 JOIN interview_console_drafts draft ON draft.interview_request_id=interview.interview_request_id AND draft.submitted=TRUE AND draft.recommendation=response.recommendation
 JOIN interview_recommendation_events recommendation ON recommendation.interview_request_id=interview.interview_request_id AND recommendation.recommendation=response.recommendation AND recommendation.assessor_account_id=response.actor_account_id AND recommendation.case_id=c.case_id AND recommendation.tenant_id=c.tenant_id
 WHERE interview.interview_request_id=response.interview_request_id AND interview.case_id=c.case_id AND interview.tenant_id=c.tenant_id AND interview.worker_account_id=c.worker_account_id AND interview.assessor_account_id=response.actor_account_id AND interview.status='COMPLETED')));
END;$$;
ALTER FUNCTION platform_assurance_event_recipients(TEXT,TEXT) RENAME TO platform_assurance_event_recipients_before_appeal_response;
CREATE FUNCTION platform_assurance_event_recipients(p_type TEXT,p_ref TEXT)
RETURNS TABLE(account_id TEXT,role TEXT,tenant_id TEXT,membership_id TEXT,notification_type TEXT,target_key TEXT,target_reference TEXT)
LANGUAGE sql VOLATILE AS $$
 WITH source AS(SELECT s.* FROM platform_assurance_event_source(p_type,p_ref) s
 JOIN credential_appeal_followup_events response ON response.event_id=s.source_version
 JOIN credential_appeals appeal ON appeal.appeal_id=s.record_ref AND appeal.version=response.appeal_version AND appeal.status='under_review'
 WHERE p_type IN ('appeal.evidence.submitted','appeal.interview.submitted'))
 SELECT * FROM platform_assurance_event_recipients_before_appeal_response(p_type,p_ref) WHERE p_type NOT IN ('appeal.evidence.submitted','appeal.interview.submitted')
 UNION ALL SELECT accounts.account_id,'worker',NULL::TEXT,NULL::TEXT,p_type,'appeal.record',s.record_ref
 FROM source s JOIN auth_accounts accounts ON accounts.account_id=s.worker_account_id AND accounts.account_status='active' JOIN auth_account_roles roles ON roles.account_id=accounts.account_id AND roles.role='worker'
 UNION ALL SELECT accounts.account_id,'admin',NULL::TEXT,NULL::TEXT,p_type,'appeal.record',s.record_ref
 FROM source s JOIN auth_account_roles roles ON roles.role='admin' JOIN auth_accounts accounts ON accounts.account_id=roles.account_id AND accounts.account_status='active'
 WHERE accounts.account_id<>s.worker_account_id AND accounts.worker_reference IS DISTINCT FROM (SELECT worker_id FROM credential_appeals WHERE appeal_id=s.record_ref)
 AND NOT EXISTS(SELECT 1 FROM assurance_case_timeline_events event WHERE event.case_id=s.case_ref AND event.actor_account_id=accounts.account_id AND event.event_type IN ('decision_recorded','decision_override_applied'));
$$;
CREATE FUNCTION platform_appeal_response_enqueue() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE response RECORD; notice_type TEXT;
BEGIN
 FOR response IN SELECT * FROM credential_appeal_followup_events WHERE appeal_id=NEW.appeal_id AND appeal_version=NEW.version AND event_type IN ('evidence_submitted','interview_submitted') LOOP
 notice_type:=CASE WHEN response.event_type='evidence_submitted' THEN 'appeal.evidence.submitted' ELSE 'appeal.interview.submitted' END;
 PERFORM platform_enqueue_assurance_event_notifications(notice_type,'appeal_followup:'||response.event_id);
 END LOOP;
 RETURN NEW;
END;$$;
CREATE TRIGGER platform_appeal_response_enqueue AFTER INSERT ON credential_appeal_events FOR EACH ROW EXECUTE FUNCTION platform_appeal_response_enqueue();
-- Refuse rollback if any extended boundary drifted after installation.
DO $$
DECLARE installed JSONB:='[]'::jsonb; item JSONB; definition TEXT;
BEGIN
 FOR item IN SELECT * FROM jsonb_array_elements(platform_appeal_response_notice_rollback()) LOOP
 IF item->>'kind'='constraint' THEN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid=(item->>'table')::regclass AND conname=item->>'name';
 ELSIF item->>'kind'='index' THEN SELECT pg_get_indexdef((item->>'name')::regclass) INTO definition;
 ELSIF item->>'kind'='trigger' THEN SELECT pg_get_triggerdef(oid) INTO definition FROM pg_trigger WHERE tgname=item->>'name' AND tgrelid=(item->>'table')::regclass;
 ELSE SELECT pg_get_functiondef(oid) INTO definition FROM pg_proc WHERE oid=(item->>'reference')::regprocedure;
 END IF;
 installed:=installed||jsonb_build_array(item||jsonb_build_object('definition',definition));
 END LOOP;
 installed:=installed||jsonb_build_array(jsonb_build_object('kind','wrapper','reference','platform_assurance_event_source(text,text)','definition',pg_get_functiondef('platform_assurance_event_source(text,text)'::regprocedure)),
 jsonb_build_object('kind','wrapper','reference','platform_assurance_event_recipients(text,text)','definition',pg_get_functiondef('platform_assurance_event_recipients(text,text)'::regprocedure)),
 jsonb_build_object('kind','wrapper','reference','platform_appeal_response_enqueue()','definition',pg_get_functiondef('platform_appeal_response_enqueue()'::regprocedure)),
 jsonb_build_object('kind','trigger','table','credential_appeal_events','name','platform_appeal_response_enqueue','definition',(SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='platform_appeal_response_enqueue' AND tgrelid='credential_appeal_events'::regclass)));
 EXECUTE format('CREATE FUNCTION platform_appeal_response_notice_installed() RETURNS JSONB LANGUAGE sql IMMUTABLE AS %L','SELECT '||quote_literal(installed::text)||'::jsonb');
END;$$;
