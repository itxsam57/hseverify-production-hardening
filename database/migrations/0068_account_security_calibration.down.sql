DROP TABLE IF EXISTS supervisor_observation_details;
DROP TABLE IF EXISTS staff_calibrations;
DROP TABLE IF EXISTS auth_mfa_rotation_challenges;
DROP TABLE IF EXISTS auth_mfa_recovery_codes;

ALTER TABLE auth_security_events
  DROP CONSTRAINT IF EXISTS auth_security_events_event_type_check;
ALTER TABLE auth_security_events
  ADD CONSTRAINT auth_security_events_event_type_check CHECK (
    event_type IN (
      'registration_started','otp_issued','otp_failed','otp_verified',
      'password_created','password_reset_requested','password_reset_completed',
      'login_failed','login_succeeded','logout','session_revoked',
      'account_locked','account_unlocked','invitation_created','invitation_accepted',
      'mfa_enrolled','mfa_failed','mfa_succeeded','access_denied'
    )
  );
