import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations, listMigrations } from "../../scripts/lib/migrations.mjs";

const NOW = "2026-08-09T12:00:00.000Z";
const EXPIRES = "2099-01-01T00:00:00.000Z";

const ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "secure-file-foundation-test",
  sessionSecret: "secure-file-session-secret-with-at-least-32-characters",
  authPepper: "secure-file-auth-pepper-with-at-least-32-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function extractSql(source, name) {
  const prefix = `export const ${name} = \``;
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1, `${name} must be extractable`);
  const contentStart = start + prefix.length;
  const end = source.indexOf("`;", contentStart);
  assert.notEqual(end, -1, `${name} SQL terminator must be extractable`);
  return source.slice(contentStart, end);
}

async function contracts() {
  const source = await readFile(
    resolve("src/lib/secure-files/secure-file-repository.ts"),
    "utf8"
  );
  return {
    reserve: extractSql(source, "SECURE_FILE_RESERVE_SQL"),
    findReservation: extractSql(source, "SECURE_FILE_FIND_RESERVATION_SQL"),
    sessionGuard: extractSql(source, "SECURE_FILE_SESSION_GUARD_SQL"),
    companyGuard: extractSql(source, "SECURE_FILE_COMPANY_SCOPE_GUARD_SQL"),
    list: extractSql(source, "SECURE_FILE_LIST_SQL"),
    find: extractSql(source, "SECURE_FILE_FIND_SQL")
  };
}

function hashCharacter(character) {
  return createHash("sha256").update(String(character), "utf8").digest("hex");
}

async function seedWorker(database, suffix, character) {
  const accountId = `account_secure_worker_${suffix}`;
  const sessionId = `session_secure_worker_${suffix}`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, `secure-worker-${suffix}@example.com`, `Secure Worker ${suffix}`, NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'worker', $2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'worker', $3, $4, $5, $5, $6)`,
    [sessionId, accountId, hashCharacter(`token:${character}`), hashCharacter(`csrf:${character}`), NOW, EXPIRES]
  );
  return { accountId, sessionId };
}

async function seedCompany(database, suffix, character) {
  const accountId = `account_secure_company_${suffix}`;
  const sessionId = `session_secure_company_${suffix}`;
  const tenantId = `tenant_${character.repeat(24)}`;
  const membershipId = `membership_${character.repeat(24)}`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
    [accountId, `secure-company-${suffix}@example.com`, `Secure Company ${suffix}`, NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'company', $2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO platform_tenants (
       tenant_id, tenant_type, display_name, tenant_status,
       created_by_account_id, created_at, updated_at, activated_at
     ) VALUES ($1, 'company', $2, 'active', $3, $4, $4, $4)`,
    [tenantId, `Tenant ${suffix}`, accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_by_account_id,
       created_at, updated_at, activated_at
     ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $3, $4, $4, $4)`,
    [membershipId, tenantId, accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'company', $3, $4, $5, $5, $6)`,
    [sessionId, accountId, hashCharacter(`token:${character}`), hashCharacter(`csrf:${character}`), NOW, EXPIRES]
  );
  return { accountId, sessionId, tenantId, membershipId };
}

async function reserve(database, sql, input) {
  const result = await database.query(sql, [
    `secure_file_${input.character.repeat(24)}`,
    1,
    hashCharacter(`reservation:${input.character}`),
    input.accountId,
    input.role,
    input.tenantId ?? null,
    input.membershipId ?? null,
    "local_test",
    `secure-files/${hashCharacter(`object:${input.objectCharacter}`)}`,
    input.filename
  ]);
  return result.rows[0];
}

test("secure file metadata is private, directly scoped and immutable", async () => {
  const sql = await contracts();
  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    const migrations = (await listMigrations()).map((migration) => migration.id);
    const secureFileIndex = migrations.indexOf("0011_secure_file_foundation");
    assert.ok(secureFileIndex >= 0, "secure-file migration must remain registered");
    assert.equal(migrations[secureFileIndex - 1], "0010_email_delivery_foundation");
    assert.deepEqual(await applyPendingMigrations(database, ENVIRONMENT.releaseSha), migrations);

    const workerA = await seedWorker(database, "a", "a");
    const workerB = await seedWorker(database, "b", "b");
    const companyA = await seedCompany(database, "a", "c");
    const companyB = await seedCompany(database, "b", "d");

    const workerFile = await reserve(database, sql.reserve, {
      character: "E", objectCharacter: "e", filename: "worker.pdf",
      accountId: workerA.accountId, role: "worker"
    });
    const otherWorkerFile = await reserve(database, sql.reserve, {
      character: "F", objectCharacter: "f", filename: "other.png",
      accountId: workerB.accountId, role: "worker"
    });
    const companyFileA = await reserve(database, sql.reserve, {
      character: "G", objectCharacter: "a", filename: "company-a.jpg",
      accountId: companyA.accountId, role: "company",
      tenantId: companyA.tenantId, membershipId: companyA.membershipId
    });
    const companyFileB = await reserve(database, sql.reserve, {
      character: "H", objectCharacter: "b", filename: "company-b.pdf",
      accountId: companyB.accountId, role: "company",
      tenantId: companyB.tenantId, membershipId: companyB.membershipId
    });

    assert.equal(workerFile.lifecycle_status, "reserved");
    assert.equal(workerFile.file_extension, null);
    assert.equal(workerFile.byte_size, null);

    const workerList = await database.query(sql.list, [workerA.accountId, "worker", null, null, null, 50]);
    assert.deepEqual(workerList.rows.map((row) => row.file_id), [workerFile.file_id]);
    const copiedWorkerId = await database.query(sql.find, [otherWorkerFile.file_id, workerA.accountId, "worker", null, null]);
    assert.equal(copiedWorkerId.rows.length, 0);
    const wrongRole = await database.query(sql.find, [workerFile.file_id, workerA.accountId, "assessor", null, null]);
    assert.equal(wrongRole.rows.length, 0);

    const companyListA = await database.query(sql.list, [
      companyA.accountId, "company", companyA.tenantId, companyA.membershipId, null, 50
    ]);
    assert.deepEqual(companyListA.rows.map((row) => row.file_id), [companyFileA.file_id]);
    const crossedTenant = await database.query(sql.find, [
      companyFileB.file_id, companyA.accountId, "company", companyA.tenantId, companyA.membershipId
    ]);
    assert.equal(crossedTenant.rows.length, 0);

    const sessionBefore = await database.query(sql.sessionGuard, [workerA.sessionId, workerA.accountId, "worker"]);
    assert.equal(sessionBefore.rows.length, 1);
    await database.query(
      `UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP, revocation_reason = 'owner_test'
       WHERE session_id = $1`,
      [workerA.sessionId]
    );
    const sessionAfter = await database.query(sql.sessionGuard, [workerA.sessionId, workerA.accountId, "worker"]);
    assert.equal(sessionAfter.rows.length, 0);

    const companyBefore = await database.query(sql.companyGuard, [
      companyA.membershipId, companyA.tenantId, companyA.accountId
    ]);
    assert.equal(companyBefore.rows.length, 1);

    const continuityAccountId = "account_secure_company_a_continuity";
    const continuityMembershipId = `membership_${"q".repeat(24)}`;
    await database.query(
      `INSERT INTO auth_accounts (
         account_id, email_normalized, display_name, account_status,
         email_verified_at, created_at, updated_at
       ) VALUES ($1, $2, $3, 'active', $4, $4, $4)`,
      [continuityAccountId, "secure-company-a-continuity@example.com", "Secure Company a continuity owner", NOW]
    );
    await database.query(
      `INSERT INTO auth_account_roles (account_id, role, created_at)
       VALUES ($1, 'company', $2)`,
      [continuityAccountId, NOW]
    );
    await database.query(
      `INSERT INTO auth_tenant_memberships (
         membership_id, tenant_id, account_id, portal_role,
         membership_role, membership_status, created_by_account_id,
         created_at, updated_at, activated_at
       ) VALUES ($1, $2, $3, 'company', 'owner', 'active', $4, $5, $5, $5)`,
      [continuityMembershipId, companyA.tenantId, continuityAccountId, companyA.accountId, NOW]
    );

    await database.query(
      `UPDATE auth_tenant_memberships
       SET membership_status = 'revoked', revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE membership_id = $1`,
      [companyA.membershipId]
    );
    const companyAfter = await database.query(sql.companyGuard, [
      companyA.membershipId, companyA.tenantId, companyA.accountId
    ]);
    assert.equal(companyAfter.rows.length, 0);

    await assert.rejects(
      database.query(
        "UPDATE platform_secure_files SET object_key = $2 WHERE file_id = $1",
        [workerFile.file_id, `secure-files/${"9".repeat(64)}`]
      ),
      /ownership and storage provenance are immutable/
    );
    await assert.rejects(
      database.query("DELETE FROM platform_secure_files WHERE file_id = $1", [workerFile.file_id]),
      /history cannot be deleted/
    );

    const retained = await database.query(
      "SELECT file_id FROM platform_secure_files WHERE file_id = $1",
      [workerFile.file_id]
    );
    assert.equal(retained.rows.length, 1);

    const columns = await database.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'platform_secure_files'`
    );
    assert.equal(columns.rows.some((row) => /bytea|blob/i.test(row.data_type)), false);
    assert.equal(columns.rows.some((row) => /bytes|content_body|base64/i.test(row.column_name)), false);
  } finally {
    await database.close();
  }
});

test("reservation uniqueness is database enforced and scoped lookups do not enumerate conflicts", async () => {
  const sql = await contracts();
  const database = await openScriptDatabase({ ...ENVIRONMENT, releaseSha: "secure-file-dedupe-test" });
  try {
    await applyPendingMigrations(database, "secure-file-dedupe-test");
    const worker = await seedWorker(database, "dedupe", "j");
    const first = await reserve(database, sql.reserve, {
      character: "K", objectCharacter: "c", filename: "first.pdf",
      accountId: worker.accountId, role: "worker"
    });
    const reservationKey = hashCharacter("reservation:K");
    const duplicate = await database.query(sql.reserve, [
      `secure_file_${"L".repeat(24)}`, 1, reservationKey,
      worker.accountId, "worker", null, null, "local_test",
      `secure-files/${hashCharacter("object:d")}`, "first.pdf"
    ]);
    assert.equal(duplicate.rows.length, 0);
    const existing = await database.query(sql.findReservation, [
      reservationKey, worker.accountId, "worker", null, null
    ]);
    assert.equal(existing.rows[0].file_id, first.file_id);
    assert.equal((await database.query("SELECT COUNT(*)::int AS count FROM platform_secure_files")).rows[0].count, 1);
  } finally {
    await database.close();
  }
});
