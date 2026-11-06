import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";

export async function openPostgresRestoreFixture(configPath, root) {
  const path = await realpath(configPath);
  const config = JSON.parse(await readFile(path, "utf8"));
  assert.equal(config.syntheticOnly, true);
  assert.equal(dirname(path), config.privateRoot);
  assert.ok(config.privateRoot.startsWith(resolve(config.projectRoot, "..") + "/hse-https-stage."));
  const base = new URL(config.applicationEnvironment.DATABASE_URL);
  assert.equal(base.hostname, "127.0.0.1");
  assert.equal(base.pathname, "/staging");
  const admin = await openScriptDatabase({ databaseDriver: "postgres", databaseUrl: base.href });
  const prefix = "business_restore_" + randomBytes(8).toString("hex");
  const names = [prefix + "_source", prefix + "_restored"];
  const created = [];
  const archive = join(root, "database.dump");
  const args = ["--host", base.hostname, "--port", base.port, "--username", decodeURIComponent(base.username)];
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(base.password) };

  async function close() {
    try {
      for (const name of created.reverse()) await admin.execute('DROP DATABASE "' + name + '"');
    } finally {
      await admin.close();
    }
  }

  function open(name) {
    const url = new URL(base.href);
    url.pathname = "/" + name;
    return openScriptDatabase({ databaseDriver: "postgres", databaseUrl: url.href });
  }

  function run(binary, arguments_) {
    const result = spawnSync(binary, [...args, ...arguments_], { env, encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  }

  try {
    for (const name of names) {
      await admin.execute('CREATE DATABASE "' + name + '"');
      created.push(name);
    }
  } catch (error) {
    await close();
    throw error;
  }
  return {
    openSource: () => open(names[0]),
    async restore() {
      run(process.env.HSE_POSTGRES_PG_DUMP || "pg_dump", ["--format=custom", "--file", archive, names[0]]);
      run(process.env.HSE_POSTGRES_PG_RESTORE || "pg_restore", ["--exit-on-error", "--no-owner", "--dbname", names[1], archive]);
      return open(names[1]);
    },
    close,
  };
}
