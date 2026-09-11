import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

const up = await readFile(
  resolve("database/migrations/0007_platform_audit_foundation.up.sql"),
  "utf8"
);
const down = await readFile(
  resolve("database/migrations/0007_platform_audit_foundation.down.sql"),
  "utf8"
);
const domain = await readFile(resolve("src/lib/audit/audit-domain.ts"), "utf8");
const repository = await readFile(
  resolve("src/lib/audit/audit-repository.ts"),
  "utf8"
);
const service = await readFile(resolve("src/lib/audit/audit-service.ts"), "utf8");
const concurrency = await readFile(
  resolve("tests/platform/audit-concurrency.test.mjs"),
  "utf8"
);
const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));

assert.match(up, /CREATE TABLE IF NOT EXISTS platform_audit_events/);
assert.match(up, /BEFORE UPDATE OR DELETE ON platform_audit_events/);
assert.match(up, /AFTER INSERT ON auth_security_events/);
assert.match(up, /INSERT INTO platform_audit_events[\s\S]*FROM auth_security_events/);
assert.match(down, /DROP TABLE IF EXISTS platform_audit_events/);
assert.match(repository, /^import "server-only";/);
assert.match(service, /^import "server-only";/);
assert.doesNotMatch(repository, /export const AUDIT_(UPDATE|DELETE)_SQL/);
assert.doesNotMatch(
  service,
  /\b(actorAccountId|actorRole|actorTenantId|actorMembershipId|occurredAt|recordedAt)\s*:/
);
assert.match(domain, /FORBIDDEN_METADATA_KEY/);
assert.match(concurrency, /Promise\.all/);
assert.match(concurrency, /new Set\(stored\.rows\.map\(\(row\) => row\.audit_event_id\)\)/);
assert.equal(packageJson.scripts["test:audit"], "node scripts/run-audit-tests.mjs");
assert.equal(
  packageJson.scripts["test:audit-platform"],
  "node --test tests/platform/audit-foundation.test.mjs tests/platform/audit-concurrency.test.mjs tests/platform/audit-migration-stack.test.mjs"
);

for (const directory of ["src/app", "src/components"]) {
  for (const file of await filesUnder(resolve(directory))) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(
      source,
      /from ["'][^"']*\/audit\/audit-(domain|repository)["']/,
      `${file} must not import raw audit authority`
    );
  }
}

console.log("Audit foundation source, migration and concurrency contracts passed.");
