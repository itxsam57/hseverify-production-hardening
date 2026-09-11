DROP TABLE IF EXISTS authorization_tenant_scope_fixtures;

ALTER TABLE auth_tenant_memberships
  DROP CONSTRAINT IF EXISTS auth_tenant_membership_tenant_identity;
