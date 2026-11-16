-- M1.09.04: a stale Company Team form must not restore revoked permissions,
-- revive old unit scope or overwrite a newer authorized staff member update.
-- Old 0026-0132 migration history/checksums remain immutable. All existing
-- Company Team members start at revision 1; fresh UI must send the exact
-- revision read for this member, not just the role and membership status.
ALTER TABLE auth_tenant_memberships
  ADD COLUMN IF NOT EXISTS company_team_access_revision INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='auth_tenant_memberships'::regclass
      AND conname='auth_tenant_memberships_company_team_access_revision_check'
  ) THEN
    ALTER TABLE auth_tenant_memberships
      ADD CONSTRAINT auth_tenant_memberships_company_team_access_revision_check
      CHECK (company_team_access_revision >= 1);
  END IF;
END;
$$;
