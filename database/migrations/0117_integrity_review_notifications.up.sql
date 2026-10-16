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
   CASE WHEN item.conname LIKE '%target_key%' THEN '''admin.integrity.review'',''verifier.integrity.review''' ELSE '''integrity.escalated'',''integrity.returned''' END);
 END LOOP;
 FOR item IN SELECT indexrelid::regclass::text AS name,pg_get_indexdef(indexrelid) AS definition FROM pg_index
 WHERE indexrelid IN ('platform_notifications_legacy_source_job_idx'::regclass,'platform_notifications_assurance_source_recipient_idx'::regclass)
 LOOP
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','index','name',item.name,'definition',item.definition));
  EXECUTE format('DROP INDEX %I',item.name);
  EXECUTE replace(item.definition,'''evidence.reviewed''','''evidence.reviewed'',''integrity.escalated'',''integrity.returned''');
 END LOOP;
 FOR item IN SELECT oid,proname FROM pg_proc WHERE oid IN ('platform_assurance_event_assert_job(platform_outbox_jobs)'::regprocedure,'platform_email_attempt_validate_insert()'::regprocedure,'platform_email_attempt_guard_update()'::regprocedure,'platform_assurance_notification_title(text)'::regprocedure)
 LOOP
  definition:=pg_get_functiondef(item.oid);
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','function','reference',item.oid::regprocedure::text,'definition',definition));
  IF item.proname='platform_assurance_notification_title' THEN
   definition:=replace(definition,'WHEN ''evidence.reviewed''','WHEN ''integrity.escalated'' THEN ''Integrity review escalated'' WHEN ''integrity.returned'' THEN ''Integrity review returned'' WHEN ''evidence.reviewed''');
  ELSE definition:=replace(definition,'''evidence.reviewed''','''evidence.reviewed'',''integrity.escalated'',''integrity.returned'''); END IF;
  EXECUTE definition;
 END LOOP;
 FOR item IN SELECT tgname,pg_get_triggerdef(oid) AS definition,tgrelid::regclass::text AS table_name FROM pg_trigger
 WHERE NOT tgisinternal AND tgname IN ('platform_notifications_validate_insert','platform_assurance_notifications_validate_insert','platform_email_deliveries_validate_insert','platform_assurance_emails_validate_insert','platform_email_deliveries_guard_update','platform_assurance_emails_guard_update')
 LOOP
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','trigger','name',item.tgname,'table',item.table_name,'definition',item.definition));
  EXECUTE format('DROP TRIGGER %I ON %I',item.tgname,item.table_name);
  EXECUTE replace(item.definition,'''evidence.reviewed''','''evidence.reviewed'',''integrity.escalated'',''integrity.returned''');
 END LOOP;
 EXECUTE format('CREATE FUNCTION platform_integrity_notification_rollback_contract() RETURNS JSONB LANGUAGE sql IMMUTABLE AS %L','SELECT '||quote_literal(saved::text)||'::jsonb');
END;$$;



ALTER FUNCTION platform_assurance_event_source(TEXT,TEXT) RENAME TO platform_assurance_event_source_before_integrity;
CREATE FUNCTION platform_assurance_event_source(p_type TEXT,p_ref TEXT)
RETURNS TABLE(event_type TEXT,event_ref TEXT,record_ref TEXT,source_version TEXT,evidence_kind TEXT,
 worker_account_id TEXT,source_tenant TEXT,case_ref TEXT,actor_account_id TEXT,actor_role TEXT,
 actor_tenant TEXT,actor_membership TEXT,system_component TEXT)
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
 IF p_type NOT IN ('integrity.escalated','integrity.returned') THEN RETURN QUERY SELECT * FROM platform_assurance_event_source_before_integrity(p_type,p_ref); RETURN; END IF;
 IF p_ref !~ '^integrity:[A-Za-z0-9_-]{1,160}$' OR char_length(p_ref)>192 THEN RETURN; END IF;
 RETURN QUERY SELECT p_type,p_ref,d.review_id,d.disposition_id,NULL::TEXT,c.worker_account_id,
 c.tenant_id,c.case_id,COALESCE(d.actor_account_id,d.reviewer_account_id),d.actor_role,NULL::TEXT,NULL::TEXT,NULL::TEXT
 FROM assessment_integrity_dispositions d JOIN written_score_reviews r ON r.review_id=d.review_id AND r.attempt_id=d.attempt_id AND r.case_id=d.case_id
 JOIN assurance_cases c ON c.case_id=d.case_id
 WHERE d.disposition_id=split_part(p_ref,':',2)
 AND ((p_type='integrity.escalated' AND d.actor_role='verifier' AND d.disposition IN ('CONCERN_CONFIRMED','UNABLE','ESCALATE'))
 OR (p_type='integrity.returned' AND d.actor_role='admin' AND d.disposition='REVIEW_REQUIRED'));
END;$$;
ALTER FUNCTION platform_assurance_event_recipients(TEXT,TEXT) RENAME TO platform_assurance_event_recipients_before_integrity;
CREATE FUNCTION platform_assurance_event_recipients(p_type TEXT,p_ref TEXT)
RETURNS TABLE(account_id TEXT,role TEXT,tenant_id TEXT,membership_id TEXT,notification_type TEXT,target_key TEXT,target_reference TEXT)
LANGUAGE sql VOLATILE AS $$
 WITH source AS (
 SELECT s.*,r.reviewer_account_id,c.owner_kind FROM platform_assurance_event_source(p_type,p_ref) s
 JOIN written_score_reviews r ON r.review_id=s.record_ref AND r.case_id=s.case_ref AND r.status='DRAFT'
 JOIN assurance_cases c ON c.case_id=s.case_ref AND c.assessment_reference=r.attempt_id AND c.closed_at IS NULL AND c.case_status='Review pending'
 JOIN assessment_integrity_dispositions d ON d.disposition_id=s.source_version
 WHERE p_type IN ('integrity.escalated','integrity.returned')
 AND NOT EXISTS(SELECT 1 FROM assessment_integrity_dispositions newer WHERE newer.attempt_id=d.attempt_id AND newer.revision>d.revision)
 ), candidates AS (
 SELECT * FROM platform_assurance_event_recipients_before_integrity(p_type,p_ref) WHERE p_type NOT IN ('integrity.escalated','integrity.returned')
 UNION ALL SELECT admins.account_id,'admin',NULL,NULL,p_type,'admin.integrity.review',source.record_ref
 FROM source JOIN auth_account_roles admins ON admins.role='admin' WHERE p_type='integrity.escalated' AND source.owner_kind='admin'
 UNION ALL SELECT reviewer_account_id,'verifier',NULL,NULL,p_type,'verifier.integrity.review',record_ref
 FROM source WHERE p_type='integrity.returned' AND owner_kind='reviewer'
 )
 SELECT DISTINCT candidates.* FROM candidates JOIN auth_accounts accounts ON accounts.account_id=candidates.account_id AND accounts.account_status='active'
 JOIN auth_account_roles roles ON roles.account_id=candidates.account_id AND roles.role=candidates.role;
$$;
-- Refuse rollback if any extended boundary drifted after installation.
DO $$
DECLARE installed JSONB:='[]'::jsonb; item JSONB; definition TEXT;
BEGIN
 FOR item IN SELECT * FROM jsonb_array_elements(platform_integrity_notification_rollback_contract()) LOOP
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
 EXECUTE format('CREATE FUNCTION platform_integrity_installed_contract() RETURNS JSONB LANGUAGE sql IMMUTABLE AS %L','SELECT '||quote_literal(installed::text)||'::jsonb');
END;$$;
