DROP TABLE IF EXISTS auth_security_events;
DROP TABLE IF EXISTS auth_mfa_factors;
DROP TABLE IF EXISTS auth_staff_invitations;
DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS auth_otp_challenges;
DROP TABLE IF EXISTS auth_account_roles;
-- Lower-brick rollback must remain possible after later bricks have introduced
-- references to the authentication authority. The migration runner rolls back
-- later migrations first, but defensive CASCADE keeps the primitive rollback
-- safe when a retained compatibility object or test fixture still depends on
-- this root table.
DROP TABLE IF EXISTS auth_accounts CASCADE;
DELETE FROM hse_schema_migrations WHERE migration_id = '0002_authentication_foundation';
