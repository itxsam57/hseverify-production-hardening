DROP TRIGGER IF EXISTS company_team_activate_membership ON auth_staff_invitations;
DROP FUNCTION IF EXISTS hse_activate_company_team_membership();

DROP TRIGGER IF EXISTS company_departments_archive_assignments ON company_departments;
DROP TRIGGER IF EXISTS company_sites_archive_assignments ON company_sites;
DROP FUNCTION IF EXISTS hse_archive_company_unit_assignments();

DROP TRIGGER IF EXISTS company_team_validate_unit_assignment ON company_team_unit_assignments;
DROP FUNCTION IF EXISTS hse_validate_company_team_unit_assignment();

DROP TRIGGER IF EXISTS company_team_validate_invitation_permission ON company_team_invitation_permissions;
DROP FUNCTION IF EXISTS hse_validate_company_team_invitation_permission();

DROP TRIGGER IF EXISTS company_team_validate_invitation_binding ON company_team_invitation_bindings;
DROP FUNCTION IF EXISTS hse_validate_company_team_invitation_binding();

DROP TABLE IF EXISTS company_team_unit_assignments;
DROP TABLE IF EXISTS company_team_invitation_permissions;
DROP TABLE IF EXISTS company_team_invitation_bindings;
DROP TABLE IF EXISTS company_departments;
DROP TABLE IF EXISTS company_sites;
