-- Extend proven assurance notification projection and email delivery for rejected, unissued case appeals.
-- Capture original constraints / indexes / triggers / function bodies for non-destructive rollback.
DO $$
DECLARE saved JSONB:='[]'::jsonb; item RECORD; definition TEXT;
 types TEXT:='''case.appeal.submitted'',''case.appeal.evidence.requested'',''case.appeal.evidence.submitted'',''case.appeal.interview.requested'',''case.appeal.interview.submitted'',''case.appeal.reviewed''';
BEGIN
 FOR item IN SELECT conrelid::regclass::text AS table_name,conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
 WHERE (conrelid='platform_notifications'::regclass AND conname='platform_notifications_notification_type_check')
 OR (conrelid='platform_email_deliveries'::regclass AND conname='platform_email_deliveries_delivery_type_check')
 OR (conrelid='platform_notifications'::regclass AND conname='platform_notifications_target_key_check')
 LOOP
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','constraint','table',item.table_name,'name',item.conname,'definition',item.definition));
  definition:=regexp_replace(item.definition,'^CHECK \((.*)\)$','\1');
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',item.table_name,item.conname);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((%s) OR %I IN (%s))',item.table_name,item.conname,definition,
   CASE WHEN item.conname LIKE '%target_key%' THEN 'target_key' WHEN item.table_name='platform_notifications' THEN 'notification_type' ELSE 'delivery_type' END,
   CASE WHEN item.conname LIKE '%target_key%' THEN '''case.appeal.record''' ELSE types END);
 END LOOP;
 FOR item IN SELECT indexrelid::regclass::text AS name,pg_get_indexdef(indexrelid) AS definition FROM pg_index
 WHERE indexrelid IN ('platform_notifications_legacy_source_job_idx'::regclass,'platform_notifications_assurance_source_recipient_idx'::regclass)
 LOOP
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','index','name',item.name,'definition',item.definition));
  EXECUTE format('DROP INDEX %I',item.name);
  EXECUTE replace(item.definition,'''evidence.reviewed''','''evidence.reviewed'','||types);
 END LOOP;
 FOR item IN SELECT oid,proname FROM pg_proc
 WHERE oid IN ('platform_assurance_event_assert_job(platform_outbox_jobs)'::regprocedure,
  'platform_email_attempt_validate_insert()'::regprocedure,
  'platform_email_attempt_guard_update()'::regprocedure,
  'platform_assurance_notification_title(text)'::regprocedure)
 LOOP
  definition:=pg_get_functiondef(item.oid);
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','function','reference',item.oid::regprocedure::text,'definition',definition));
  IF item.proname='platform_assurance_notification_title' THEN
   definition:=replace(definition,'WHEN ''evidence.reviewed''',
    'WHEN ''case.appeal.submitted'' THEN ''Rejected-case appeal submitted'' WHEN ''case.appeal.evidence.requested'' THEN ''Case appeal evidence requested'' WHEN ''case.appeal.evidence.submitted'' THEN ''Case appeal evidence submitted'' WHEN ''case.appeal.interview.requested'' THEN ''Independent appeal interview requested'' WHEN ''case.appeal.interview.submitted'' THEN ''Appeal interview recommendation submitted'' WHEN ''case.appeal.reviewed'' THEN ''Case appeal review completed'' WHEN ''evidence.reviewed''');
  ELSE definition:=replace(definition,'''evidence.reviewed''','''evidence.reviewed'','||types); END IF;
  EXECUTE definition;
 END LOOP;
 FOR item IN SELECT tgname,pg_get_triggerdef(oid) AS definition,tgrelid::regclass::text AS table_name FROM pg_trigger
 WHERE NOT tgisinternal AND tgname IN ('platform_notifications_validate_insert','platform_assurance_notifications_validate_insert',
 'platform_email_deliveries_validate_insert','platform_assurance_emails_validate_insert',
 'platform_email_deliveries_guard_update','platform_assurance_emails_guard_update')
 LOOP
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','trigger','name',item.tgname,'table',item.table_name,'definition',item.definition));
  EXECUTE format('DROP TRIGGER %I ON %I',item.tgname,item.table_name);
  EXECUTE replace(item.definition,'''evidence.reviewed''','''evidence.reviewed'','||types);
 END LOOP;
 EXECUTE format('CREATE FUNCTION platform_case_appeal_notice_rollback_contract() RETURNS JSONB LANGUAGE sql IMMUTABLE AS %L',
  'SELECT '||quote_literal(saved::TEXT)||'::jsonb');
END;$$;
-- Extend immutable event-source verification; existing assurance events still delegate to the previous source.
ALTER FUNCTION platform_assurance_event_source(TEXT,TEXT) RENAME TO platform_assurance_event_source_before_case_appeal;
CREATE FUNCTION platform_assurance_event_source(p_type TEXT,p_ref TEXT)
RETURNS TABLE(event_type TEXT,event_ref TEXT,record_ref TEXT,source_version TEXT,evidence_kind TEXT,
 worker_account_id TEXT,source_tenant TEXT,case_ref TEXT,actor_account_id TEXT,actor_role TEXT,
 actor_tenant TEXT,actor_membership TEXT,system_component TEXT)
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
 IF p_type NOT IN ('case.appeal.submitted','case.appeal.evidence.requested','case.appeal.evidence.submitted',
  'case.appeal.interview.requested','case.appeal.interview.submitted','case.appeal.reviewed') THEN
  RETURN QUERY SELECT * FROM platform_assurance_event_source_before_case_appeal(p_type,p_ref);RETURN;
 END IF;
 IF p_ref !~ '^case_appeal:case_appeal_[A-Za-z0-9_-]{24}:[1-9][0-9]{0,8}$' OR char_length(p_ref)>192 THEN RETURN;END IF;
 RETURN QUERY SELECT p_type,p_ref,appeal.appeal_id,events.version::TEXT,NULL::TEXT,appeal.worker_account_id,
  appeal.tenant_id,appeal.case_id,events.actor_account_id,
  CASE WHEN p_type IN ('case.appeal.submitted','case.appeal.evidence.submitted') THEN 'worker'::TEXT
       WHEN p_type='case.appeal.interview.submitted' THEN 'assessor'::TEXT ELSE 'admin'::TEXT END,
  NULL::TEXT,NULL::TEXT,NULL::TEXT
 FROM assurance_case_appeal_events events JOIN assurance_case_appeals appeal ON appeal.appeal_id=events.appeal_id
 JOIN assurance_cases cases ON cases.case_id=appeal.case_id AND cases.tenant_id=appeal.tenant_id
  AND cases.worker_account_id=appeal.worker_account_id AND cases.decision_reference=appeal.decision_id
  AND cases.case_status='Rejected' AND cases.credential_reference IS NULL
 JOIN platform_decisions decision ON decision.decision_id=appeal.decision_id
  AND decision.case_id=appeal.case_id AND decision.tenant_id=appeal.tenant_id AND decision.state='REJECTED'
 WHERE events.appeal_id=split_part(p_ref,':',2) AND events.version=split_part(p_ref,':',3)::INTEGER
 AND events.version<=appeal.version
 AND (
 (p_type='case.appeal.submitted' AND events.version=1 AND events.status='submitted'
  AND events.actor_account_id=appeal.worker_account_id)
 OR (p_type='case.appeal.reviewed' AND events.version>1 AND events.status IN ('accepted','rejected')
  AND events.actor_account_id=appeal.reviewer_account_id AND appeal.version=events.version AND appeal.status=events.status)
 OR (p_type='case.appeal.evidence.requested' AND events.status='under_review'
  AND EXISTS(SELECT 1 FROM assurance_case_appeal_evidence_requests request WHERE request.appeal_id=appeal.appeal_id
   AND request.appeal_version=events.version AND request.requested_by_account_id=events.actor_account_id))
 OR (p_type='case.appeal.evidence.submitted' AND events.status='under_review' AND events.actor_account_id=appeal.worker_account_id
  AND EXISTS(SELECT 1 FROM assurance_case_appeal_evidence_responses response
   JOIN assurance_case_appeal_evidence_requests request ON request.request_id=response.request_id
    AND request.appeal_id=response.appeal_id WHERE response.appeal_id=appeal.appeal_id
    AND response.appeal_version=events.version AND response.responded_by_account_id=events.actor_account_id
    AND EXISTS(SELECT 1 FROM assurance_case_appeal_evidence e WHERE e.appeal_id=appeal.appeal_id AND e.request_id=request.request_id)))
 OR (p_type='case.appeal.interview.requested' AND events.status='under_review'
  AND EXISTS(SELECT 1 FROM assurance_case_appeal_interview_requests request WHERE request.appeal_id=appeal.appeal_id
   AND request.appeal_version=events.version AND request.requested_by_account_id=events.actor_account_id))
 OR (p_type='case.appeal.interview.submitted' AND events.status='under_review'
  AND EXISTS(SELECT 1 FROM assurance_case_appeal_interview_outcomes outcome
   JOIN assurance_case_appeal_interview_requests request ON request.interview_request_id=outcome.interview_request_id
    AND request.appeal_id=outcome.appeal_id
   JOIN interview_recommendation_events recommendation ON recommendation.event_id=outcome.recommendation_event_id
    AND recommendation.assessor_account_id=outcome.assessor_account_id AND recommendation.case_id=appeal.case_id
    AND recommendation.tenant_id=appeal.tenant_id AND recommendation.recommendation=outcome.recommendation
   WHERE outcome.appeal_id=appeal.appeal_id AND outcome.appeal_version=events.version
    AND outcome.assessor_account_id=events.actor_account_id))
 );
END;$$;
ALTER FUNCTION platform_assurance_event_recipients(TEXT,TEXT) RENAME TO platform_assurance_event_recipients_before_case_appeal;
CREATE FUNCTION platform_assurance_event_recipients(p_type TEXT,p_ref TEXT)
RETURNS TABLE(account_id TEXT,role TEXT,tenant_id TEXT,membership_id TEXT,notification_type TEXT,target_key TEXT,target_reference TEXT)
LANGUAGE sql VOLATILE AS $$
 WITH source AS (
 SELECT s.*,appeal.status AS appeal_status,appeal.version AS appeal_current_version,
  appeal.reviewer_account_id,appeal.decision_id
 FROM platform_assurance_event_source(p_type,p_ref) s
 JOIN assurance_case_appeals appeal ON appeal.appeal_id=s.record_ref AND appeal.case_id=s.case_ref
 WHERE p_type IN ('case.appeal.submitted','case.appeal.evidence.requested','case.appeal.evidence.submitted',
  'case.appeal.interview.requested','case.appeal.interview.submitted','case.appeal.reviewed')
 ),
 eligible AS (
 SELECT * FROM platform_assurance_event_recipients_before_case_appeal(p_type,p_ref)
 WHERE p_type NOT IN ('case.appeal.submitted','case.appeal.evidence.requested','case.appeal.evidence.submitted',
  'case.appeal.interview.requested','case.appeal.interview.submitted','case.appeal.reviewed')
 UNION ALL
 SELECT source.worker_account_id,'worker',NULL::TEXT,NULL::TEXT,p_type,'case.appeal.record',source.record_ref
 FROM source
 WHERE p_type NOT IN ('case.appeal.evidence.requested','case.appeal.interview.requested')
  OR (p_type='case.appeal.evidence.requested' AND EXISTS (
    SELECT 1 FROM assurance_case_appeal_evidence_requests request WHERE request.appeal_id=source.record_ref
     AND request.appeal_version=source.source_version::INTEGER AND NOT EXISTS (
      SELECT 1 FROM assurance_case_appeal_evidence_responses response WHERE response.request_id=request.request_id)))
  OR (p_type='case.appeal.interview.requested' AND EXISTS (
    SELECT 1 FROM assurance_case_appeal_interview_requests request WHERE request.appeal_id=source.record_ref
     AND request.appeal_version=source.source_version::INTEGER AND NOT EXISTS (
      SELECT 1 FROM assurance_case_appeal_interview_outcomes outcome WHERE outcome.interview_request_id=request.interview_request_id)))
 UNION ALL
 SELECT accounts.account_id,'admin',NULL::TEXT,NULL::TEXT,p_type,'case.appeal.record',source.record_ref
 FROM source JOIN auth_account_roles roles ON roles.role='admin'
 JOIN auth_accounts accounts ON accounts.account_id=roles.account_id
 WHERE accounts.account_id<>source.worker_account_id
 AND NOT EXISTS(SELECT 1 FROM assurance_case_timeline_events event
  WHERE event.case_id=source.case_ref AND event.tenant_id=source.source_tenant
    AND event.actor_account_id=accounts.account_id AND event.event_type IN ('decision_recorded','decision_override_applied'))
 AND NOT EXISTS(SELECT 1 FROM platform_decision_overrides override
  WHERE override.decision_id=source.decision_id AND override.actor_reference=accounts.account_id)
 AND (
 (p_type='case.appeal.submitted' AND source.appeal_status IN ('submitted','under_review'))
 OR (p_type IN ('case.appeal.evidence.submitted','case.appeal.interview.submitted','case.appeal.reviewed') AND
  accounts.account_id=source.reviewer_account_id)
 OR (p_type='case.appeal.interview.requested' AND accounts.account_id=source.reviewer_account_id AND EXISTS (
  SELECT 1 FROM assurance_case_appeal_interview_requests request
  JOIN interview_requests interview ON interview.interview_request_id=request.interview_request_id
  WHERE request.appeal_id=source.record_ref AND request.appeal_version=source.source_version::INTEGER
   AND interview.assessor_account_id IS NULL AND interview.status='REQUESTED'))
 )
 UNION ALL
 SELECT interview.assessor_account_id,'assessor',NULL::TEXT,NULL::TEXT,p_type,'interview.record',interview.interview_request_id
 FROM source JOIN assurance_case_appeal_interview_requests request
   ON request.appeal_id=source.record_ref AND request.appeal_version=source.source_version::INTEGER
 JOIN interview_requests interview ON interview.interview_request_id=request.interview_request_id
 WHERE p_type='case.appeal.interview.requested' AND interview.assessor_account_id IS NOT NULL
  AND interview.status IN ('ASSIGNED','WAITING_ROOM')
  AND NOT EXISTS(SELECT 1 FROM assurance_case_appeal_interview_outcomes outcome WHERE outcome.interview_request_id=request.interview_request_id)
 )
 SELECT DISTINCT candidate.* FROM eligible candidate
 JOIN auth_accounts accounts ON accounts.account_id=candidate.account_id AND accounts.account_status='active'
 JOIN auth_account_roles roles ON roles.account_id=candidate.account_id AND roles.role=candidate.role;
$$;
-- Enqueue only from persisted immutable appeal event records, within the original transaction.
CREATE FUNCTION platform_case_appeal_notification_enqueue() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE kind TEXT; appeal_ref TEXT; appeal_version INTEGER;
BEGIN
 kind:=NULL;
 IF TG_TABLE_NAME='assurance_case_appeal_events' THEN
  IF NEW.version=1 AND NEW.status='submitted' THEN kind:='case.appeal.submitted';END IF;
  IF NEW.version>1 AND NEW.status IN ('accepted','rejected') THEN kind:='case.appeal.reviewed';END IF;
 ELSIF TG_TABLE_NAME='assurance_case_appeal_evidence_requests' THEN
  kind:='case.appeal.evidence.requested';
 ELSIF TG_TABLE_NAME='assurance_case_appeal_evidence' THEN
  kind:='case.appeal.evidence.submitted';
 ELSIF TG_TABLE_NAME='assurance_case_appeal_interview_requests' THEN
  kind:='case.appeal.interview.requested';
 ELSIF TG_TABLE_NAME='assurance_case_appeal_interview_outcomes' THEN
  kind:='case.appeal.interview.submitted';
 END IF;
 IF kind IS NOT NULL THEN
  appeal_ref:=NEW.appeal_id;
  IF TG_TABLE_NAME='assurance_case_appeal_events' THEN appeal_version:=NEW.version;
  ELSIF TG_TABLE_NAME='assurance_case_appeal_evidence' THEN
    SELECT response.appeal_version INTO appeal_version FROM assurance_case_appeal_evidence_responses response
      WHERE response.request_id=NEW.request_id AND response.appeal_id=NEW.appeal_id;
  ELSE appeal_version:=NEW.appeal_version;END IF;
  PERFORM platform_enqueue_assurance_event_notifications(kind,'case_appeal:'||appeal_ref||':'||appeal_version::TEXT);
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER case_appeal_event_notification_enqueue AFTER INSERT ON assurance_case_appeal_events
 FOR EACH ROW EXECUTE FUNCTION platform_case_appeal_notification_enqueue();
CREATE TRIGGER case_appeal_evidence_request_notice AFTER INSERT ON assurance_case_appeal_evidence_requests
 FOR EACH ROW EXECUTE FUNCTION platform_case_appeal_notification_enqueue();
CREATE TRIGGER case_appeal_evidence_snapshot_notice AFTER INSERT ON assurance_case_appeal_evidence
 FOR EACH ROW WHEN (NEW.request_id IS NOT NULL) EXECUTE FUNCTION platform_case_appeal_notification_enqueue();
CREATE TRIGGER case_appeal_interview_request_notice AFTER INSERT ON assurance_case_appeal_interview_requests
 FOR EACH ROW EXECUTE FUNCTION platform_case_appeal_notification_enqueue();
CREATE TRIGGER case_appeal_interview_outcome_notice AFTER INSERT ON assurance_case_appeal_interview_outcomes
 FOR EACH ROW EXECUTE FUNCTION platform_case_appeal_notification_enqueue();

-- Installed contract fingerprint permits a rollback only when no later migration changed these boundaries.
DO $$
DECLARE installed JSONB:='[]'::jsonb; item JSONB; trigger_row RECORD; definition TEXT;
BEGIN
 FOR item IN SELECT * FROM jsonb_array_elements(platform_case_appeal_notice_rollback_contract()) LOOP
  IF item->>'kind'='constraint' THEN
   SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid=(item->>'table')::regclass AND conname=item->>'name';
  ELSIF item->>'kind'='index' THEN SELECT pg_get_indexdef((item->>'name')::regclass) INTO definition;
  ELSIF item->>'kind'='trigger' THEN SELECT pg_get_triggerdef(oid) INTO definition FROM pg_trigger WHERE tgname=item->>'name' AND tgrelid=(item->>'table')::regclass;
  ELSE SELECT pg_get_functiondef(oid) INTO definition FROM pg_proc WHERE oid=(item->>'reference')::regprocedure;END IF;
  installed:=installed||jsonb_build_array(item||jsonb_build_object('definition',definition));
 END LOOP;
 installed:=installed||jsonb_build_array(
  jsonb_build_object('kind','wrapper','reference','platform_assurance_event_source(text,text)',
   'definition',pg_get_functiondef('platform_assurance_event_source(text,text)'::regprocedure)),
  jsonb_build_object('kind','wrapper','reference','platform_assurance_event_recipients(text,text)',
   'definition',pg_get_functiondef('platform_assurance_event_recipients(text,text)'::regprocedure)),
  jsonb_build_object('kind','wrapper','reference','platform_case_appeal_notification_enqueue()',
   'definition',pg_get_functiondef('platform_case_appeal_notification_enqueue()'::regprocedure)));
 FOR trigger_row IN SELECT tgname,tgrelid::regclass::text AS table_name,pg_get_triggerdef(oid) AS definition
 FROM pg_trigger WHERE tgname IN ('case_appeal_event_notification_enqueue','case_appeal_evidence_request_notice',
 'case_appeal_evidence_snapshot_notice','case_appeal_interview_request_notice','case_appeal_interview_outcome_notice')
 LOOP installed:=installed||jsonb_build_array(jsonb_build_object('kind','trigger','table',trigger_row.table_name,
  'name',trigger_row.tgname,'definition',trigger_row.definition)); END LOOP;
 EXECUTE format('CREATE FUNCTION platform_case_appeal_notice_installed_contract() RETURNS JSONB LANGUAGE sql IMMUTABLE AS %L',
 'SELECT '||quote_literal(installed::text)||'::jsonb');
END;$$;
