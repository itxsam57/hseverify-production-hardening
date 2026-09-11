DROP INDEX IF EXISTS auth_single_pending_root_bootstrap_idx;
DROP INDEX IF EXISTS auth_pending_staff_invitation_idx;
DROP TRIGGER IF EXISTS auth_expire_conflicting_staff_invitations
  ON auth_staff_invitations;
DROP FUNCTION IF EXISTS hse_expire_conflicting_staff_invitations();
DROP TABLE IF EXISTS auth_access_rate_limits;
DROP TABLE IF EXISTS auth_staff_enrollment_flows;
DROP TABLE IF EXISTS auth_recovery_flows;
