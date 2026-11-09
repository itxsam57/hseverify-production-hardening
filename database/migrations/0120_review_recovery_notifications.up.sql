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
   CASE WHEN item.conname LIKE '%target_key%' THEN '''admin.scoring.assignment'',''admin.review.quality''' ELSE '''assessment.review.conflict'',''evidence.second_review.requested''' END);
 END LOOP;
 FOR item IN SELECT indexrelid::regclass::text AS name,pg_get_indexdef(indexrelid) AS definition FROM pg_index
 WHERE indexrelid IN ('platform_notifications_legacy_source_job_idx'::regclass,'platform_notifications_assurance_source_recipient_idx'::regclass)
 LOOP
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','index','name',item.name,'definition',item.definition));
  EXECUTE format('DROP INDEX %I',item.name);
  EXECUTE replace(item.definition,'''evidence.reviewed''','''evidence.reviewed'',''assessment.review.conflict'',''evidence.second_review.requested''');
 END LOOP;
 FOR item IN SELECT oid,proname FROM pg_proc WHERE oid IN ('platform_assurance_event_assert_job(platform_outbox_jobs)'::regprocedure,'platform_email_attempt_validate_insert()'::regprocedure,'platform_email_attempt_guard_update()'::regprocedure,'platform_assurance_notification_title(text)'::regprocedure)
 LOOP
  definition:=pg_get_functiondef(item.oid);
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','function','reference',item.oid::regprocedure::text,'definition',definition));
  IF item.proname='platform_assurance_notification_title' THEN
   definition:=replace(definition,'WHEN ''evidence.reviewed''','WHEN ''assessment.review.conflict'' THEN ''Assessment scoring conflict'' WHEN ''evidence.second_review.requested'' THEN ''Independent evidence review required'' WHEN ''evidence.reviewed''');
  ELSE definition:=replace(definition,'''evidence.reviewed''','''evidence.reviewed'',''assessment.review.conflict'',''evidence.second_review.requested'''); END IF;
  EXECUTE definition;
 END LOOP;
 FOR item IN SELECT tgname,pg_get_triggerdef(oid) AS definition,tgrelid::regclass::text AS table_name FROM pg_trigger
 WHERE NOT tgisinternal AND tgname IN ('platform_notifications_validate_insert','platform_assurance_notifications_validate_insert','platform_email_deliveries_validate_insert','platform_assurance_emails_validate_insert','platform_email_deliveries_guard_update','platform_assurance_emails_guard_update')
 LOOP
  saved:=saved||jsonb_build_array(jsonb_build_object('kind','trigger','name',item.tgname,'table',item.table_name,'definition',item.definition));
  EXECUTE format('DROP TRIGGER %I ON %I',item.tgname,item.table_name);
  EXECUTE replace(item.definition,'''evidence.reviewed''','''evidence.reviewed'',''assessment.review.conflict'',''evidence.second_review.requested''');
 END LOOP;
 EXECUTE format('CREATE FUNCTION platform_review_recovery_notification_rollback_contract() RETURNS JSONB LANGUAGE sql IMMUTABLE AS %L','SELECT '||quote_literal(saved::text)||'::jsonb');
END;$$;



ALTER FUNCTION platform_assurance_event_source(TEXT,TEXT) RENAME TO platform_assurance_event_source_before_review_recovery;
CREATE FUNCTION platform_assurance_event_source(p_type TEXT,p_ref TEXT)
RETURNS TABLE(event_type TEXT,event_ref TEXT,record_ref TEXT,source_version TEXT,evidence_kind TEXT,
 worker_account_id TEXT,source_tenant TEXT,case_ref TEXT,actor_account_id TEXT,actor_role TEXT,
 actor_tenant TEXT,actor_membership TEXT,system_component TEXT)
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
 IF p_type NOT IN ('assessment.review.conflict','evidence.second_review.requested') THEN RETURN QUERY SELECT * FROM platform_assurance_event_source_before_review_recovery(p_type,p_ref); RETURN; END IF;
 IF p_ref !~ '^review_recovery:[A-Za-z0-9_-]{1,160}$' OR char_length(p_ref)>192 THEN RETURN; END IF;
 IF p_type='assessment.review.conflict' THEN
 RETURN QUERY SELECT p_type,p_ref,r.review_id,a.audit_event_id,NULL::TEXT,c.worker_account_id,c.tenant_id,c.case_id,a.actor_account_id,a.actor_role,NULL::TEXT,NULL::TEXT,NULL::TEXT
 FROM platform_audit_events a JOIN scoring_conflict_declarations conflict ON conflict.conflict_id=a.metadata->>'scoringConflictId'
 JOIN written_score_reviews r ON r.review_id=conflict.review_id JOIN assurance_cases c ON c.case_id=r.case_id
 WHERE a.audit_event_id=split_part(p_ref,':',2) AND a.action_key='assurance_case.status.changed' AND a.outcome='succeeded' AND a.actor_role='verifier'
 AND a.actor_account_id=conflict.reviewer_account_id AND a.target_reference=c.case_id;
 ELSE
 RETURN QUERY SELECT p_type,p_ref,t.task_id,a.audit_event_id,t.evidence_kind,t.worker_account_id,t.tenant_id,t.case_id,a.actor_account_id,a.actor_role,NULL::TEXT,NULL::TEXT,NULL::TEXT
 FROM platform_audit_events a JOIN evidence_review_quality_rounds round ON round.quality_review_id=a.metadata->>'qualityReviewPrimaryId'
 JOIN evidence_review_tasks t ON t.task_id=round.task_id JOIN evidence_review_quality_selections selection ON selection.task_id=t.task_id
 WHERE a.audit_event_id=split_part(p_ref,':',2) AND a.action_key='assurance_case.status.changed' AND a.outcome='succeeded' AND a.actor_role='verifier'
 AND a.actor_account_id=round.verifier_account_id AND a.target_reference=t.task_id AND round.source_version_id=t.source_version_id
 AND round.framework_version_id=selection.framework_version_id;
 END IF;
END;$$;
ALTER FUNCTION platform_assurance_event_recipients(TEXT,TEXT) RENAME TO platform_assurance_event_recipients_before_review_recovery;
CREATE FUNCTION platform_assurance_event_recipients(p_type TEXT,p_ref TEXT)
RETURNS TABLE(account_id TEXT,role TEXT,tenant_id TEXT,membership_id TEXT,notification_type TEXT,target_key TEXT,target_reference TEXT)
LANGUAGE sql VOLATILE AS $$
 WITH source AS (SELECT event.* FROM platform_assurance_event_source(p_type,p_ref) event
 WHERE p_type<>'evidence.second_review.requested' OR (
 NOT EXISTS(SELECT 1 FROM evidence_review_conflicts conflict WHERE conflict.task_id=event.record_ref AND conflict.verifier_account_id=event.actor_account_id)
 AND event.source_version=(SELECT latest.audit_event_id FROM platform_audit_events latest WHERE latest.action_key='assurance_case.status.changed' AND latest.metadata->>'qualityTaskId'=event.record_ref AND latest.metadata->>'qualityReviewPrimaryId' IS NOT NULL ORDER BY latest.audit_sequence DESC LIMIT 1)
 )), eligible AS (
 SELECT accounts.account_id,t.task_id FROM source s JOIN evidence_review_tasks t ON t.task_id=s.record_ref
 JOIN LATERAL(SELECT * FROM evidence_review_framework_bindings WHERE task_id=t.task_id ORDER BY binding_sequence DESC LIMIT 1)binding ON TRUE
 JOIN evidence_review_quality_selections selection ON selection.task_id=t.task_id AND selection.framework_version_id=binding.framework_version_id AND selection.policy_snapshot_id IS NOT DISTINCT FROM binding.case_snapshot_id
 JOIN assurance_frameworks frameworks ON frameworks.framework_id=binding.framework_id AND frameworks.framework_status='ACTIVE'
 JOIN auth_account_roles roles ON roles.role='verifier' JOIN auth_accounts accounts ON accounts.account_id=roles.account_id AND accounts.account_status='active'
 JOIN LATERAL(SELECT status,valid_until FROM staff_calibrations calibration WHERE calibration.account_id=accounts.account_id AND calibration.role='verifier' AND calibration.framework_id=binding.framework_id AND calibration.framework_version_id=binding.framework_version_id AND calibration.valid_from<=CURRENT_TIMESTAMP ORDER BY calibration.valid_from DESC,calibration.calibration_sequence DESC LIMIT 1)calibration ON calibration.status='CURRENT' AND calibration.valid_until>CURRENT_TIMESTAMP
 WHERE p_type='evidence.second_review.requested' AND t.task_status='QUEUED' AND accounts.account_id<>t.worker_account_id
 AND NOT EXISTS(SELECT 1 FROM evidence_review_quality_rounds rounds WHERE rounds.task_id=t.task_id AND rounds.verifier_account_id=accounts.account_id)
 AND NOT EXISTS(SELECT 1 FROM evidence_review_conflicts conflicts WHERE conflicts.task_id=t.task_id AND conflicts.verifier_account_id=accounts.account_id)
 AND platform_reviewer_open_reviews(accounts.account_id)<platform_reviewer_capacity_limit(accounts.account_id)
 AND (t.case_id IS NULL OR EXISTS(SELECT 1 FROM assurance_cases c WHERE c.case_id=t.case_id AND c.closed_at IS NULL))
 )
 SELECT * FROM platform_assurance_event_recipients_before_review_recovery(p_type,p_ref) WHERE p_type NOT IN ('assessment.review.conflict','evidence.second_review.requested')
 UNION ALL SELECT eligible.account_id,'verifier',NULL::TEXT,NULL::TEXT,p_type,'verifier.review.task',eligible.task_id FROM eligible
 UNION ALL SELECT accounts.account_id,'admin',NULL::TEXT,NULL::TEXT,p_type,
 CASE WHEN p_type='assessment.review.conflict' THEN 'admin.scoring.assignment' ELSE 'admin.review.quality' END,
 CASE WHEN p_type='assessment.review.conflict' THEN s.case_ref ELSE s.record_ref END
 FROM source s JOIN auth_account_roles roles ON roles.role='admin' JOIN auth_accounts accounts ON accounts.account_id=roles.account_id AND accounts.account_status='active'
 WHERE (p_type='assessment.review.conflict' AND EXISTS(SELECT 1 FROM written_score_reviews r JOIN assurance_cases c ON c.case_id=r.case_id WHERE r.review_id=s.record_ref AND r.reviewer_account_id=s.actor_account_id AND r.status='DRAFT' AND c.case_status='Review pending' AND c.owner_kind='admin' AND c.closed_at IS NULL))
 OR (p_type='evidence.second_review.requested' AND NOT EXISTS(SELECT 1 FROM eligible) AND EXISTS(SELECT 1 FROM evidence_review_tasks t WHERE t.task_id=s.record_ref AND t.task_status='QUEUED'));
$$;
CREATE FUNCTION platform_review_recovery_audit_enqueue() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action_key='assurance_case.status.changed' AND NEW.outcome='succeeded' AND NEW.actor_role='verifier' THEN
  IF NEW.metadata->>'scoringConflictId' IS NOT NULL THEN
   PERFORM platform_enqueue_assurance_event_notifications('assessment.review.conflict','review_recovery:'||NEW.audit_event_id);
  ELSIF NEW.metadata->>'qualityReviewPrimaryId' IS NOT NULL THEN
   PERFORM platform_enqueue_assurance_event_notifications('evidence.second_review.requested','review_recovery:'||NEW.audit_event_id);
  END IF;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER platform_review_recovery_audit_enqueue AFTER INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION platform_review_recovery_audit_enqueue();
-- Refuse rollback if any extended boundary drifted after installation.
DO $$
DECLARE installed JSONB:='[]'::jsonb; item JSONB; definition TEXT;
BEGIN
 FOR item IN SELECT * FROM jsonb_array_elements(platform_review_recovery_notification_rollback_contract()) LOOP
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
 EXECUTE format('CREATE FUNCTION platform_review_recovery_installed_contract() RETURNS JSONB LANGUAGE sql IMMUTABLE AS %L','SELECT '||quote_literal(installed::text)||'::jsonb');
END;$$;
