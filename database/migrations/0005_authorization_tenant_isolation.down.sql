DROP TABLE IF EXISTS auth_tenant_permission_overrides;
DROP TABLE IF EXISTS auth_tenant_memberships;
DROP TABLE IF EXISTS auth_tenant_role_permission_ceiling;

-- Keep the tenant root reversible only when no later brick still owns rows
-- depending on it. Later milestones intentionally retain history tables across
-- lower-brick rollback/reapply cycles.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('company_worker_invitations', 'company_worker_links')
  ) THEN
    DROP TABLE IF EXISTS platform_tenants;
  END IF;
END $$;
