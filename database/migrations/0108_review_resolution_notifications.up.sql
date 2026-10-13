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
   CASE WHEN item.conname LIKE '%target_key%' THEN '''admin.review.escalation''' ELSE '''evidence.unable'',''evidence.escalated'',''evidence.returned''' END);
 END LOOP;
 FOR item IN SELECT indexrelid::regclass::text AS name,pg_get_indexdef(indexrelid) AS definition FROM pg_index
 WHERE indexrelid IN ('platform_notifications_legacy_source_job_idx'::regclass,'platform_notifications_assurance_source_recipient_idx'::regclass)
 LOOP
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','index','name',item.name,'definition',item.definition));
  EXECUTE format('DROP INDEX %I',item.name);
  EXECUTE replace(item.definition,'''evidence.reviewed''','''evidence.reviewed'',''evidence.unable'',''evidence.escalated'',''evidence.returned''');
 END LOOP;
 FOR item IN SELECT oid,proname FROM pg_proc WHERE oid IN ('platform_assurance_event_assert_job(platform_outbox_jobs)'::regprocedure,'platform_email_attempt_validate_insert()'::regprocedure,'platform_email_attempt_guard_update()'::regprocedure,'platform_assurance_notification_title(text)'::regprocedure)
 LOOP
  definition:=pg_get_functiondef(item.oid);
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','function','definition',definition));
  IF item.proname='platform_assurance_notification_title' THEN
   definition:=replace(definition,'WHEN ''evidence.reviewed''','WHEN ''evidence.unable'' THEN ''Evidence could not be verified'' WHEN ''evidence.escalated'' THEN ''Evidence review escalated'' WHEN ''evidence.returned'' THEN ''Evidence returned to review'' WHEN ''evidence.reviewed''');
  ELSE definition:=replace(definition,'''evidence.reviewed''','''evidence.reviewed'',''evidence.unable'',''evidence.escalated'',''evidence.returned'''); END IF;
  EXECUTE definition;
 END LOOP;
 FOR item IN SELECT tgname,pg_get_triggerdef(oid) AS definition,tgrelid::regclass::text AS table_name FROM pg_trigger
 WHERE NOT tgisinternal AND tgname IN ('platform_notifications_validate_insert','platform_assurance_notifications_validate_insert','platform_email_deliveries_validate_insert','platform_assurance_emails_validate_insert','platform_email_deliveries_guard_update','platform_assurance_emails_guard_update')
 LOOP
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','trigger','name',item.tgname,'table',item.table_name,'definition',item.definition));
  EXECUTE format('DROP TRIGGER %I ON %I',item.tgname,item.table_name);
  EXECUTE replace(item.definition,'''evidence.reviewed''','''evidence.reviewed'',''evidence.unable'',''evidence.escalated'',''evidence.returned''');
 END LOOP;
 EXECUTE format('CREATE FUNCTION platform_review_resolution_notification_rollback_contract() RETURNS JSONB LANGUAGE sql IMMUTABLE AS %L','SELECT '||quote_literal(saved::text)||'::jsonb');
END;$$;

ALTER FUNCTION platform_assurance_event_source(TEXT,TEXT) RENAME TO platform_assurance_event_source_before_resolution;
CREATE FUNCTION platform_assurance_event_source(p_type TEXT,p_ref TEXT)
RETURNS TABLE(event_type TEXT,event_ref TEXT,record_ref TEXT,source_version TEXT,evidence_kind TEXT,
 worker_account_id TEXT,source_tenant TEXT,case_ref TEXT,actor_account_id TEXT,actor_role TEXT,
 actor_tenant TEXT,actor_membership TEXT,system_component TEXT)
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
 IF p_type NOT IN ('evidence.unable','evidence.escalated','evidence.returned') THEN
  RETURN QUERY SELECT * FROM platform_assurance_event_source_before_resolution(p_type,p_ref); RETURN;
 END IF;
 IF char_length(p_ref)>192 OR p_ref !~ '^resolution:[A-Za-z0-9_-]{1,160}$' THEN RETURN; END IF;
 RETURN QUERY SELECT p_type,p_ref,tasks.source_record_id,tasks.source_version_id,tasks.evidence_kind,
 tasks.worker_account_id,tasks.tenant_id,tasks.case_id,events.actor_account_id,events.actor_role,NULL::TEXT,NULL::TEXT,NULL::TEXT
 FROM evidence_review_resolution_events events JOIN evidence_review_tasks tasks ON tasks.task_id=events.task_id AND tasks.source_version_id=events.source_version_id
 WHERE events.event_id=split_part(p_ref,':',2) AND
 ((p_type='evidence.unable' AND events.outcome='UNABLE_TO_VERIFY' AND events.actor_role='verifier')
 OR (p_type='evidence.escalated' AND events.outcome='ESCALATED' AND events.destination='admin' AND events.actor_role='verifier')
 OR (p_type='evidence.returned' AND events.outcome='RETURNED_TO_QUEUE' AND events.actor_role='admin'))
 AND (EXISTS(SELECT 1 FROM worker_evidence_records records JOIN worker_evidence_versions versions ON versions.record_id=records.record_id
  WHERE records.record_id=tasks.source_record_id AND records.worker_account_id=tasks.worker_account_id AND versions.version_id=tasks.source_version_id)
 OR EXISTS(SELECT 1 FROM worker_identities identities JOIN worker_identity_versions versions ON versions.identity_id=identities.identity_id
  WHERE identities.identity_id=tasks.source_record_id AND identities.worker_account_id=tasks.worker_account_id AND versions.identity_version_id=tasks.source_version_id)
 OR EXISTS(SELECT 1 FROM supervisor_observations observations WHERE observations.observation_id=tasks.source_version_id AND observations.worker_account_id=tasks.worker_account_id AND observations.case_id=tasks.case_id));
END;$$;

ALTER FUNCTION platform_assurance_event_recipients(TEXT,TEXT) RENAME TO platform_assurance_event_recipients_before_resolution;
CREATE FUNCTION platform_assurance_event_recipients(p_type TEXT,p_ref TEXT)
RETURNS TABLE(account_id TEXT,role TEXT,tenant_id TEXT,membership_id TEXT,notification_type TEXT,target_key TEXT,target_reference TEXT)
LANGUAGE sql VOLATILE AS $$
 WITH current_source AS (
 SELECT source.*,tasks.task_id,tasks.assigned_verifier_account_id FROM platform_assurance_event_source(p_type,p_ref) source
 JOIN evidence_review_tasks tasks ON tasks.source_record_id=source.record_ref AND tasks.source_version_id=source.source_version AND tasks.worker_account_id=source.worker_account_id
 JOIN evidence_review_resolution_events events ON events.task_id=tasks.task_id AND 'resolution:'||events.event_id=p_ref
 WHERE p_type IN ('evidence.unable','evidence.escalated','evidence.returned')
 AND events.revision=(SELECT max(latest.revision) FROM evidence_review_resolution_events latest WHERE latest.task_id=tasks.task_id)
 AND ((p_type='evidence.unable' AND tasks.task_status='UNABLE_TO_VERIFY')
 OR (p_type='evidence.escalated' AND tasks.task_status='ESCALATED')
 OR (p_type='evidence.returned' AND tasks.task_status IN ('QUEUED','ASSIGNED')))
 AND (EXISTS(SELECT 1 FROM worker_evidence_records records WHERE records.record_id=source.record_ref AND records.current_version_id=source.source_version AND records.lifecycle_status='active')
 OR EXISTS(SELECT 1 FROM worker_identities identities JOIN worker_identity_versions versions ON versions.identity_id=identities.identity_id WHERE identities.identity_id=source.record_ref AND versions.identity_version_id=source.source_version AND versions.version_number=identities.current_version_number)
 OR EXISTS(SELECT 1 FROM supervisor_observations observations WHERE observations.observation_id=source.source_version AND observations.worker_account_id=source.worker_account_id AND observations.case_id=source.case_ref))
 ), candidates AS (
 SELECT * FROM platform_assurance_event_recipients_before_resolution(p_type,p_ref) WHERE p_type NOT IN ('evidence.unable','evidence.escalated','evidence.returned')
 UNION ALL
 SELECT source.worker_account_id,'worker',NULL,NULL,p_type,
 CASE WHEN evidence_kind='identity' THEN 'worker.identity.record' WHEN evidence_kind='supervisor_observation' THEN 'worker.observation.record' ELSE 'worker.evidence.record' END,record_ref FROM current_source source
 UNION ALL
 SELECT admins.account_id,'admin',NULL,NULL,p_type,'admin.review.escalation',source.task_id FROM current_source source JOIN auth_account_roles admins ON admins.role='admin' WHERE p_type='evidence.escalated'
 UNION ALL
 SELECT verifiers.account_id,'verifier',NULL,NULL,p_type,'verifier.review.task',source.task_id FROM current_source source JOIN auth_account_roles verifiers ON verifiers.role='verifier'
 WHERE p_type='evidence.returned' AND verifiers.account_id<>source.worker_account_id
 AND (source.assigned_verifier_account_id IS NULL OR source.assigned_verifier_account_id=verifiers.account_id)
 AND NOT EXISTS(SELECT 1 FROM evidence_review_conflicts conflicts WHERE conflicts.task_id=source.task_id AND conflicts.verifier_account_id=verifiers.account_id)
 )
 SELECT DISTINCT candidates.* FROM candidates JOIN auth_accounts accounts ON accounts.account_id=candidates.account_id AND accounts.account_status='active'
 JOIN auth_account_roles roles ON roles.account_id=candidates.account_id AND roles.role=candidates.role;
$$;
