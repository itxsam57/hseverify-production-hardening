import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import {
  migrationStatus,
  rollbackLatestMigration
} from "../../scripts/lib/migrations.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const OWNED_MIGRATION = "0027_company_organization_team_hardening";
const NOW = "2026-08-11T13:00:00.000Z";

function environment(path, releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: path,
    releaseSha,
    sessionSecret: "m1-09-migration-session-secret-with-32-characters",
    authPepper: "m1-09-migration-auth-pepper-with-more-than-thirty-two-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

function opaqueId(prefix, character) {
  return `${prefix}_${character.repeat(24)}`;
}

async function seedHistory(database) {
  const accountId = "account_m109_migration_owner";
  const tenantId = opaqueId("tenant", "M");
  const membershipId = opaqueId("membership", "M");
  const siteId = opaqueId("site", "M");
  const invitationId = "invitation_m109_migration_history";
  const initialAssignmentId = opaqueId("teamassignment", "I");

  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at, created_at, updated_at
     ) VALUES ($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [
      accountId,
      "m109-migration-owner@example.com",
      "M1.09 Migration Owner",
      "scrypt$16384$8$1$salt$hash",
      NOW
    ]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1,'company',$2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO platform_tenants (
       tenant_id, tenant_type, display_name, tenant_status,
       created_by_account_id, created_at, updated_at, activated_at
     ) VALUES ($1,'company',$2,'active',$3,$4,$4,$4)`,
    [tenantId, "M1.09 Migration Company", accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_by_account_id,
       created_at, updated_at, activated_at
     ) VALUES ($1,$2,$3,'company','owner','active',$3,$4,$4,$4)`,
    [membershipId, tenantId, accountId, NOW]
  );
  await database.query(
    `INSERT INTO company_sites (
       site_id, tenant_id, name, formatted_address, phone, website,
       email_normalized, registration_number, created_by_membership_id,
       created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
    [
      siteId,
      tenantId,
      "Migration Site",
      "Islamabad, Pakistan",
      "+92510000009",
      "https://migration-site.example.com",
      "migration-site@example.com",
      "MIG-SITE-1",
      membershipId,
      NOW
    ]
  );
  await database.query(
    `INSERT INTO auth_staff_invitations (
       invitation_id, email_normalized, role, token_hash, invitation_status,
       invited_by_account_id, expires_at, created_at
     ) VALUES ($1,$2,'company',$3,'pending',$4,$5,$6)`,
    [
      invitationId,
      "m109-migration-invite@example.com",
      "migration-token-hash",
      accountId,
      "2099-01-01T00:00:00.000Z",
      NOW
    ]
  );
  await database.query(
    `INSERT INTO company_team_invitation_bindings (
       invitation_id, membership_id, initial_assignment_id, tenant_id,
       invited_by_membership_id, membership_role, site_id, department_id, created_at
     ) VALUES ($1,$2,$3,$4,$5,'viewer',$6,NULL,$7)`,
    [
      invitationId,
      opaqueId("membership", "I"),
      initialAssignmentId,
      tenantId,
      membershipId,
      siteId,
      NOW
    ]
  );
  await database.query(
    `INSERT INTO company_team_invitation_permissions (
       invitation_id, membership_role, permission_key, created_at
     ) VALUES ($1,'viewer','company.tenant.read',$2)`,
    [invitationId, NOW]
  );
  await database.query(
    `INSERT INTO platform_audit_events (
       audit_event_id, source_kind, actor_account_id, actor_role,
       actor_tenant_id, actor_membership_id,
       action_key, outcome, target_type, target_reference, metadata,
       occurred_at, recorded_at
     ) VALUES ($1,'native',$2,'company',$3,$4,
       'company_organization.created','succeeded','resource',$5,'{}'::jsonb,$6,$6)`,
    ["audit_m109_migration_history", accountId, tenantId, membershipId, siteId, NOW]
  );

  return { accountId, tenantId, membershipId, siteId, invitationId };
}

test("M1.09 organization/team history survives restart and monotonic 0027 rollback/reapply", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hseverify-m109-migration-"));
  const databasePath = join(directory, "pglite");
  const env = environment(databasePath, "m1-09-migration-stack");
  const previousRollbackAcknowledgement = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
  let database = await openScriptDatabase(env);
  try {
    const applied = await applyMigrationsThrough(
      database,
      env.releaseSha,
      OWNED_MIGRATION
    );
    assert.equal(applied.at(-1), OWNED_MIGRATION);
    const history = await seedHistory(database);
    await database.close();
    database = null;

    const reopened = await openScriptDatabase({ ...env, releaseSha: "m1-09-migration-reopened" });
    database = reopened;
    const beforeRollback = await reopened.query(
      `SELECT sites.site_id, audits.action_key, bindings.invitation_id
       FROM company_sites AS sites
       JOIN platform_audit_events AS audits
         ON audits.target_reference=sites.site_id
       JOIN company_team_invitation_bindings AS bindings
         ON bindings.tenant_id=sites.tenant_id
       WHERE sites.tenant_id=$1`,
      [history.tenantId]
    );
    assert.equal(beforeRollback.rows.length, 1);
    assert.equal(beforeRollback.rows[0].action_key, "company_organization.created");

    await assert.rejects(
      reopened.query(
        `UPDATE company_team_invitation_bindings
         SET membership_role='manager'
         WHERE invitation_id=$1`,
        [history.invitationId]
      ),
      /invitation binding history is immutable/i
    );

    const rolledBack = await rollbackLatestMigration(reopened, env);
    assert.equal(rolledBack, OWNED_MIGRATION);
    const afterRollbackStatus = await migrationStatus(reopened);
    const ownedStatus = afterRollbackStatus.find((entry) => entry.id === OWNED_MIGRATION);
    assert.ok(ownedStatus);
    assert.equal(ownedStatus.applied, false);
    assert.equal(ownedStatus.checksumMatches, true);

    const retained = await reopened.query(
      `SELECT sites.site_id, audits.action_key, bindings.invitation_id
       FROM company_sites AS sites
       JOIN platform_audit_events AS audits
         ON audits.target_reference=sites.site_id
       JOIN company_team_invitation_bindings AS bindings
         ON bindings.tenant_id=sites.tenant_id
       WHERE sites.tenant_id=$1`,
      [history.tenantId]
    );
    assert.equal(retained.rows.length, 1);
    assert.equal(retained.rows[0].invitation_id, history.invitationId);

    await assert.rejects(
      reopened.query(
        `UPDATE auth_tenant_memberships
         SET membership_status='suspended', suspended_at=$2, updated_at=$2
         WHERE membership_id=$1`,
        [history.membershipId, NOW]
      ),
      /retain at least one active owner/i
    );

    assert.deepEqual(
      await applyMigrationsThrough(
        reopened,
        "m1-09-migration-reapply",
        OWNED_MIGRATION
      ),
      [OWNED_MIGRATION]
    );
    const finalStatus = await migrationStatus(reopened);
    const finalOwnedStatus = finalStatus.find((entry) => entry.id === OWNED_MIGRATION);
    assert.ok(finalOwnedStatus);
    assert.equal(finalOwnedStatus.applied, true);
    assert.equal(finalOwnedStatus.checksumMatches, true);
    const finalHistory = await reopened.query(
      `SELECT action_key FROM platform_audit_events
       WHERE audit_event_id='audit_m109_migration_history'`
    );
    assert.equal(finalHistory.rows[0]?.action_key, "company_organization.created");
    await assert.rejects(
      reopened.query(
        `DELETE FROM company_team_invitation_permissions
         WHERE invitation_id=$1`,
        [history.invitationId]
      ),
      /invitation binding history is immutable/i
    );
  } finally {
    if (database) await database.close();
    if (previousRollbackAcknowledgement === undefined) {
      delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    } else {
      process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = previousRollbackAcknowledgement;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
