LOCK TABLE platform_outbox_jobs,platform_notifications,platform_email_deliveries,evidence_review_resolution_events IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM platform_outbox_jobs WHERE payload->>'eventType' IN ('evidence.unable','evidence.escalated','evidence.returned'))
 OR EXISTS(SELECT 1 FROM evidence_review_resolution_events) THEN RAISE EXCEPTION 'Resolution delivery histories must be retained' USING ERRCODE='55000'; END IF;
END;$$;
DROP FUNCTION platform_assurance_event_recipients(TEXT,TEXT);
DROP FUNCTION platform_assurance_event_source(TEXT,TEXT);
ALTER FUNCTION platform_assurance_event_source_before_resolution(TEXT,TEXT) RENAME TO platform_assurance_event_source;
ALTER FUNCTION platform_assurance_event_recipients_before_resolution(TEXT,TEXT) RENAME TO platform_assurance_event_recipients;
DO $$ DECLARE item JSONB; BEGIN
 FOR item IN SELECT * FROM jsonb_array_elements(platform_review_resolution_notification_rollback_contract()) LOOP
 IF item->>'kind'='constraint' THEN
 EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',item->>'table',item->>'name');
 EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s',item->>'table',item->>'name',item->>'definition');
 ELSIF item->>'kind'='index' THEN EXECUTE format('DROP INDEX %I',item->>'name'); EXECUTE item->>'definition';
 ELSIF item->>'kind'='trigger' THEN EXECUTE format('DROP TRIGGER %I ON %I',item->>'name',item->>'table');EXECUTE item->>'definition';
 ELSE EXECUTE item->>'definition'; END IF;
 END LOOP;
END;$$;
DROP FUNCTION platform_review_resolution_notification_rollback_contract();
