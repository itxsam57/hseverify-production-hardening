DROP TABLE IF EXISTS auth_security_events;
DROP TABLE IF EXISTS auth_mfa_factors;
DROP TABLE IF EXISTS auth_staff_invitations;
DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS auth_otp_challenges;
DROP TABLE IF EXISTS auth_account_roles;
DROP TABLE IF EXISTS auth_accounts;
DELETE FROM hse_schema_migrations WHERE migration_id = '0002_authentication_foundation';
