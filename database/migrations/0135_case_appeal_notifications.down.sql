LOCK TABLE platform_outbox_jobs,platform_notifications,platform_email_deliveries IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM platform_outbox_jobs WHERE payload->>'eventType' LIKE 'case.appeal.%')
 THEN RAISE EXCEPTION 'Case appeal notification outbox histories must be retained' USING ERRCODE='55000';END IF;
END;$$;
DO $$
DECLARE item JSONB; definition TEXT;
BEGIN
 FOR item IN SELECT * FROM jsonb_array_elements(platform_case_appeal_notice_installed_contract()) LOOP
  IF item->>'kind'='constraint' THEN SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
   WHERE conrelid=(item->>'table')::regclass AND conname=item->>'name';
  ELSIF item->>'kind'='index' THEN SELECT pg_get_indexdef((item->>'name')::regclass) INTO definition;
  ELSIF item->>'kind'='trigger' THEN SELECT pg_get_triggerdef(oid) INTO definition FROM pg_trigger
   WHERE tgname=item->>'name' AND tgrelid=(item->>'table')::regclass;
  ELSE SELECT pg_get_functiondef(oid) INTO definition FROM pg_proc WHERE oid=(item->>'reference')::regprocedure;
  END IF;
  IF definition IS DISTINCT FROM item->>'definition' THEN RAISE EXCEPTION 'Case appeal notification contract drift prevents rollback';END IF;
 END LOOP;
END;$$;
DROP TRIGGER case_appeal_event_notification_enqueue ON assurance_case_appeal_events;
DROP TRIGGER case_appeal_evidence_request_notice ON assurance_case_appeal_evidence_requests;
DROP TRIGGER case_appeal_evidence_snapshot_notice ON assurance_case_appeal_evidence;
DROP TRIGGER case_appeal_interview_request_notice ON assurance_case_appeal_interview_requests;
DROP TRIGGER case_appeal_interview_outcome_notice ON assurance_case_appeal_interview_outcomes;
DROP FUNCTION platform_case_appeal_notification_enqueue();
DROP FUNCTION platform_assurance_event_recipients(TEXT,TEXT);
DROP FUNCTION platform_assurance_event_source(TEXT,TEXT);
ALTER FUNCTION platform_assurance_event_source_before_case_appeal(TEXT,TEXT) RENAME TO platform_assurance_event_source;
ALTER FUNCTION platform_assurance_event_recipients_before_case_appeal(TEXT,TEXT) RENAME TO platform_assurance_event_recipients;
DO $$
DECLARE item JSONB;
BEGIN
 FOR item IN SELECT * FROM jsonb_array_elements(platform_case_appeal_notice_rollback_contract()) LOOP
  IF item->>'kind'='constraint' THEN
   EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',item->>'table',item->>'name');
   EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s',item->>'table',item->>'name',item->>'definition');
  ELSIF item->>'kind'='index' THEN EXECUTE format('DROP INDEX %I',item->>'name');EXECUTE item->>'definition';
  ELSIF item->>'kind'='trigger' THEN EXECUTE format('DROP TRIGGER %I ON %I',item->>'name',item->>'table');EXECUTE item->>'definition';
  ELSE EXECUTE item->>'definition';END IF;
 END LOOP;
END;$$;
DROP FUNCTION platform_case_appeal_notice_rollback_contract();
DROP FUNCTION platform_case_appeal_notice_installed_contract();
