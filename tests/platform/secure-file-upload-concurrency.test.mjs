import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  releaseSha: "secure-file-upload-concurrency",
  sessionSecret: "secure-file-upload-concurrency-session-secret-32-chars",
  authPepper: "secure-file-upload-concurrency-auth-pepper-32-chars",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

function hash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function extractSql(source, name) {
  const prefix = `export const ${name} = \``;
  const start = source.indexOf(prefix);
  assert.notEqual(start, -1);
  const contentStart = start + prefix.length;
  const end = source.indexOf("`;", contentStart);
  assert.notEqual(end, -1);
  return source.slice(contentStart, end);
}

async function quarantineSql() {
  const source = await readFile(
    resolve("src/lib/secure-files/secure-file-upload-repository.ts"),
    "utf8"
  );
  return extractSql(source, "SECURE_FILE_QUARANTINE_SQL");
}

async function seedWorker(database) {
  const now = "2026-08-09T18:30:00.000Z";
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ('account_upload_concurrent', 'upload-concurrent@example.com',
       'Upload Concurrent', 'active', $1, $1, $1)`,
    [now]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ('account_upload_concurrent', 'worker', $1)`,
    [now]
  );
}

async function reserve(database, marker) {
  const fileId = `secure_file_${marker.repeat(24)}`;
  await database.query(
    `INSERT INTO platform_secure_files (
       file_id, schema_version, reservation_key,
       owner_account_id, owner_role, tenant_id, membership_id,
       storage_adapter_key, object_key, display_filename
     ) VALUES ($1, 1, $2, 'account_upload_concurrent', 'worker', NULL, NULL,
       'local_test', $3, 'same.pdf')`,
    [fileId, hash(`reservation:${marker}`), `secure-files/${hash(`object:${marker}`)}`]
  );
  return fileId;
}

function parameters(fileId, marker) {
  return [
    fileId,
    "account_upload_concurrent",
    "worker",
    null,
    null,
    "pdf",
    "application/pdf",
    "application/pdf",
    100 + marker.charCodeAt(0),
    hash(`content:${marker}`)
  ];
}

test("independent upload slots with identical filenames finalize only their own records", async () => {
  const sql = await quarantineSql();
  const database = await openScriptDatabase(ENVIRONMENT);
  try {
    await applyPendingMigrations(database, ENVIRONMENT.releaseSha);
    await seedWorker(database);
    const firstId = await reserve(database, "A");
    const secondId = await reserve(database, "B");

    const [first, second] = await Promise.all([
      database.query(sql, parameters(firstId, "A")),
      database.query(sql, parameters(secondId, "B"))
    ]);
    assert.equal(first.rows.length, 1);
    assert.equal(second.rows.length, 1);

    const stored = await database.query(
      `SELECT file_id, lifecycle_status, byte_size, content_sha256
       FROM platform_secure_files ORDER BY file_id`
    );
    assert.equal(stored.rows.length, 2);
    const byId = new Map(stored.rows.map((row) => [row.file_id, row]));
    assert.equal(byId.get(firstId).lifecycle_status, "quarantined");
    assert.equal(byId.get(secondId).lifecycle_status, "quarantined");
    assert.notEqual(byId.get(firstId).content_sha256, byId.get(secondId).content_sha256);
    assert.notEqual(byId.get(firstId).byte_size, byId.get(secondId).byte_size);
  } finally {
    await database.close();
  }
});

test("concurrent competing finalizations can advance one reserved row only once", async () => {
  const sql = await quarantineSql();
  const database = await openScriptDatabase({
    ...ENVIRONMENT,
    releaseSha: "secure-file-upload-concurrency-competing"
  });
  try {
    await applyPendingMigrations(database, "secure-file-upload-concurrency-competing");
    await seedWorker(database);
    const fileId = await reserve(database, "C");

    const results = await Promise.all([
      database.query(sql, parameters(fileId, "C")),
      database.query(sql, parameters(fileId, "D")),
      database.query(sql, parameters(fileId, "E"))
    ]);
    assert.equal(
      results.reduce((count, result) => count + result.rows.length, 0),
      1
    );
    const stored = await database.query(
      `SELECT lifecycle_status, byte_size, content_sha256
       FROM platform_secure_files WHERE file_id = $1`,
      [fileId]
    );
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].lifecycle_status, "quarantined");
    const acceptedHashes = new Set(["C", "D", "E"].map((marker) => hash(`content:${marker}`)));
    assert.ok(acceptedHashes.has(stored.rows[0].content_sha256));
  } finally {
    await database.close();
  }
});
