import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const { runTenantScopedCommand } = loadWorkerRegistrationTs("src/lib/authorization/tenant-scoped-command-guard.ts");
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";
const TEST_ENVIRONMENT = {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: "memory://",
    releaseSha: "tenant-scope-concurrency-test",
    sessionSecret: "tenant-scope-concurrency-session-secret-32-characters",
    authPepper: "tenant-scope-concurrency-auth-pepper-32-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
};
const NOW = "2026-08-05T13:00:00.000Z";
function opaqueId(prefix, character) {
    return `${prefix}_${character.repeat(24)}`;
}
function extractSql(source, name) {
    const prefix = `export const ${name} = \``;
    const start = source.indexOf(prefix);
    assert.notEqual(start, -1, `${name} must be extractable`);
    const contentStart = start + prefix.length;
    const end = source.indexOf("`;", contentStart);
    assert.notEqual(end, -1, `${name} SQL terminator must be extractable`);
    return source.slice(contentStart, end);
}
async function insertContext(database) {
    const accountId = "account_tenant_scope_concurrency";
    const tenantId = opaqueId("tenant", "Q");
    const membershipId = opaqueId("membership", "Q");
    const sessionId = "session_tenant_scope_concurrency";
    await database.query(`INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       password_hash, email_verified_at, password_set_at,
       created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $5, $5, $5, $5)`, [
        accountId,
        "tenant-concurrency@example.com",
        "Tenant Concurrency",
        "scrypt$16384$8$1$salt$hash",
        NOW
    ]);
    await database.query(`INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'company', $2)`, [accountId, NOW]);
    await database.query(`INSERT INTO platform_tenants (
       tenant_id, tenant_type, display_name, tenant_status,
       created_by_account_id, created_at, updated_at, activated_at
     ) VALUES ($1, 'company', 'Tenant Concurrency', 'active', $2, $3, $3, $3)`, [tenantId, accountId, NOW]);
    await database.query(`INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_by_account_id,
       created_at, updated_at, activated_at
     ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $3, $4, $4, $4)`, [membershipId, tenantId, accountId, NOW]);
    await database.query(`INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'company', $3, $4, $5, $5, $6)`, [
        sessionId,
        accountId,
        "token-concurrency",
        "csrf-concurrency",
        NOW,
        "2099-01-01T00:00:00.000Z"
    ]);
    return { accountId, tenantId, membershipId, sessionId };
}
test("PostgreSQL tenant readers coexist and account disablement waits", { skip: !process.env.HSE_POSTGRES_TEST_DATABASE_URL, timeout: 60000 }, async () => {
    const base = { ...TEST_ENVIRONMENT, databaseDriver: "postgres", databaseUrl: process.env.HSE_POSTGRES_TEST_DATABASE_URL };
    const admin = await openScriptDatabase(base);
    const name = "tenant_locks_" + process.pid + "_" + Date.now();
    let created = false, db, other;
    try {
        await admin.execute('CREATE DATABASE "' + name + '"');
        created = true;
        const url = new URL(base.databaseUrl);
        url.pathname = "/" + name;
        db = await openScriptDatabase({ ...base, databaseUrl: url.href });
        other = await openScriptDatabase({ ...base, databaseUrl: url.href });
        await applyPendingMigrations(db, base.releaseSha);
        const context = await insertContext(db);
        const source = await readFile("src/lib/authorization/tenant-scoped-command-guard.ts", "utf8");
        const sql = extractSql(source, "TENANT_COMMAND_SCOPE_SQL");
        const parameters = [context.membershipId, context.tenantId, context.accountId, context.sessionId, NOW, "company.settings.manage"];
        const principal = { accountId: context.accountId, sessionId: context.sessionId, activeRole: "company", accountStatus: "active", authorizedTenantPermission: "company.tenant.read", tenantMembership: { tenantId: context.tenantId, membershipId: context.membershipId, tenantStatus: "active", status: "active" } };
        let disablement;
        let changed = false;
        await runTenantScopedCommand({ database: db, principal, permission: "company.tenant.read", readOnly: true, now: new Date(NOW), operation: async () => {
                await other.transaction(async (second) => {
                    await second.execute("SET LOCAL lock_timeout='600ms'");
                    await runTenantScopedCommand({ database: second, principal, permission: "company.tenant.read", readOnly: true, now: new Date(NOW), operation: async () => true });
                });
                disablement = other.query("UPDATE auth_accounts SET account_status='disabled' WHERE account_id=$1", [context.accountId]).then(() => { changed = true; });
                let blocked = false;
                const deadline = Date.now() + 5000;
                while (!blocked && Date.now() < deadline) {
                    blocked = (await admin.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock') AS blocked", [name])).rows[0].blocked;
                    if (!blocked)
                        await new Promise(resolve => setTimeout(resolve, 25));
                }
                assert.equal(blocked, true, "Disablement must actually reach the PostgreSQL lock wait");
                assert.equal(changed, false, "Account disablement must wait for authorized operation");
            } });
        await disablement;
        assert.equal(changed, true);
        assert.equal((await db.query(sql, parameters)).rows.length, 0, "Disabled account must be denied");
    }
    finally {
        await other?.close();
        await db?.close();
        if (created)
            await admin.execute('DROP DATABASE "' + name + '"');
        await admin.close();
    }
});
