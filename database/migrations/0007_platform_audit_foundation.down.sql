DROP TRIGGER IF EXISTS auth_security_events_platform_audit_mirror
  ON auth_security_events;
DROP FUNCTION IF EXISTS platform_audit_mirror_auth_security_event();
DROP FUNCTION IF EXISTS platform_audit_safe_metadata(JSONB);
DROP FUNCTION IF EXISTS platform_audit_safe_reason(JSONB);
DROP FUNCTION IF EXISTS platform_audit_auth_target_type(TEXT);
DROP FUNCTION IF EXISTS platform_audit_auth_outcome(TEXT);
DROP FUNCTION IF EXISTS platform_audit_auth_action(TEXT);
DROP TRIGGER IF EXISTS platform_audit_events_append_only
  ON platform_audit_events;
DROP FUNCTION IF EXISTS platform_audit_reject_mutation();
DROP TABLE IF EXISTS platform_audit_events;
