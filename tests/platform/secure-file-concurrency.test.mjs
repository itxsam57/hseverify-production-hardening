import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

const ENVIRONMENT = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "secure-file-concurrency-test",
  sessionSecret: "secure-file-concurrency-session-secret-32-chars",
  authPepper: "secure-file-concurrency-auth-pepper-32-chars",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function extractSql(source, name) {
  const prefix = `export const ${name} = \``;
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1);
  const contentStart = start + prefix.length;
  const end = source.indexOf("`;", contentStart);
  assert.notEqual(end, -1);
  return source.slice(contentStart, end);
}

async function reserveSql() {
  const source = await readFile(
    resolve("src/lib/secure-files/secure-file-repository.ts"),
    "utf8"
  );
  return extractSql(source, "SECURE_FILE_RESERVE_SQL");
}

async function seedWorker(database) {
  const now = "2026-08-09T12:00:00.000Z";
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ('account_secure_concurrent', 'concurrent@example.com',
       'Concurrent Worker', 'active', $1, $1, $1)`,
    [now]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ('account_secure_concurrent', 'worker', $1)`,
    [now]
  );
}

function parameters(index, reservationKey) {
  const character = String.fromCharCode(65 + index);
  const objectHex = (index + 1).toString(16).repeat(64).slice(0, 64);
  return [
    `secure_file_${character.repeat(24)}`,
    1,
    reservationKey,
    "account_secure_concurrent",
    "worker",
    null,
    null,
    "local_test",
    `secure-files/${objectHex}`,
    "concurrent.pdf"
  ];
}

test("concurrent equivalent reservations create exactly one logical secure file", async () => {
  const sql = await reserveSql();
  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    await seedWorker(database);
    const reservationKey = "a".repeat(64);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        database.query(sql, parameters(index, reservationKey))
      )
    );
    assert.equal(results.reduce((count, result) => count + result.rows.length, 0), 1);
    const stored = await database.query(
      `SELECT file_id, reservation_key, lifecycle_status
       FROM platform_secure_files WHERE reservation_key = $1`,
      [reservationKey]
    );
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].lifecycle_status, "reserved");
  } finally {
    await database.close();
  }
});

test("different reservation keys remain independent under concurrent creation", async () => {
  const sql = await reserveSql();
  const database = await openScriptDatabase({ ...ENVIRONMENT, releaseSha: "secure-file-concurrency-independent" });
  try {
    await applyPendingMigrations(database, "secure-file-concurrency-independent");
    await seedWorker(database);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        database.query(sql, parameters(index, (index + 1).toString(16).repeat(64)))
      )
    );
    assert.equal(results.every((result) => result.rows.length === 1), true);
    const stored = await database.query("SELECT COUNT(*)::int AS count FROM platform_secure_files");
    assert.equal(Number(stored.rows[0].count), 6);
  } finally {
    await database.close();
  }
});
