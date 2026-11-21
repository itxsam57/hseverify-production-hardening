-- Restore the installed predecessor without rewriting existing notices.
DROP FUNCTION platform_assurance_event_recipients(TEXT,TEXT);
ALTER FUNCTION platform_assurance_event_recipients_before_verified_correction(TEXT,TEXT)
  RENAME TO platform_assurance_event_recipients;
