import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

async function source(path) {
  return readFile(resolve(path), "utf8");
}

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectSourceFiles(path));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function mustContain(text, pattern, message) {
  assert.match(text, pattern, message);
}

function mustNotContain(text, pattern, message) {
  assert.doesNotMatch(text, pattern, message);
}

const [
  migration,
  rollback,
  domain,
  repository,
  storageCore,
  storageBoundary,
  service,
  packageJson
] = await Promise.all([
  source("database/migrations/0011_secure_file_foundation.up.sql"),
  source("database/migrations/0011_secure_file_foundation.down.sql"),
  source("src/lib/secure-files/secure-file-domain.ts"),
  source("src/lib/secure-files/secure-file-repository.ts"),
  source("src/lib/secure-files/private-object-storage-core.ts"),
  source("src/lib/secure-files/private-object-storage.ts"),
  source("src/lib/secure-files/secure-file-service.ts"),
  source("package.json")
]);

mustContain(migration, /CREATE TABLE IF NOT EXISTS platform_secure_files/i,
  "M1.06 Subunit 1 must define one canonical secure-file metadata table.");
mustContain(migration, /storage_adapter_key IN \('local_test'\)/,
  "Subunit 1 storage authority must remain local/test only.");
mustContain(migration, /object_key ~ '\^secure-files\/\[a-f0-9\]\{64\}\$'/,
  "Stored object keys must use the fixed opaque secure-files namespace.");
mustContain(migration, /platform_secure_file_guard_update/,
  "Secure-file immutable provenance and lifecycle transitions must be database guarded.");
mustContain(migration, /platform_secure_file_reject_delete/,
  "Secure-file history must remain non-deletable.");
mustNotContain(migration, /\bBYTEA\b|base64|content_body|file_bytes|blob_bytes/i,
  "Relational secure-file metadata must never store file bytes or base64 payloads.");
mustNotContain(migration, /platform_audit_events|platform_outbox_jobs/i,
  "Subunit 1 must not mutate accepted M1.05 audit/outbox authority before bytes are accepted.");
mustNotContain(rollback, /platform_audit_events|platform_outbox_jobs/i,
  "Subunit 1 rollback must not alter M1.05 authority.");

mustContain(domain, /new WeakSet<object>\(\)/,
  "Trusted secure-file owner/reservation authority must use non-copyable runtime capabilities.");
mustContain(domain, /hse-secure-file-reservation-v1/,
  "Reservation idempotency must be server-derived from trusted scope.");
mustContain(domain, /hse-secure-file-object-v1/,
  "Object keys must be derived from server-generated file identity.");
mustContain(domain, /\[\\\\\/\]/,
  "Display filenames must reject path separators.");

mustContain(repository,
  /owner_account_id = \$1[\s\S]*owner_role = \$2[\s\S]*tenant_id = \$3[\s\S]*membership_id = \$4/,
  "Secure-file reads must bind exact owner/role/Company scope directly in SQL.");
mustContain(repository, /sessions\.revoked_at IS NULL[\s\S]*sessions\.expires_at > CURRENT_TIMESTAMP/,
  "Secure-file access must revalidate the live session.");
mustContain(repository, /memberships\.membership_status = 'active'[\s\S]*tenants\.tenant_status = 'active'/,
  "Company secure-file access must revalidate live membership and tenant state.");
mustContain(repository, /ON CONFLICT \(reservation_key\) DO NOTHING/,
  "Secure-file reservation must remain idempotent.");

mustContain(storageBoundary, /import "server-only"/,
  "Private object storage must expose a server-only application boundary.");
mustContain(storageBoundary,
  /createLocalTestPrivateObjectStorage\(\s*appEnvironment: "development" \| "test"\s*\)/,
  "The application factory must accept environment only, never a caller-chosen root.");
mustContain(storageBoundary, /const trustedBasePath = process\.cwd\(\)/,
  "Application storage roots must be pinned to server authority.");
mustContain(storageBoundary, /resolve\(trustedBasePath, "\.data", "private-objects"\)/,
  "Subunit 1 must use one fixed local private-object root.");
mustNotContain(storageBoundary, /export\s*\{[\s\S]*LocalTestPrivateObjectStorage[\s\S]*\}\s*from/,
  "The low-level constructor must not be re-exported as application authority.");
mustContain(storageCore, /\^secure-files\\\/\[a-f0-9\]\{64\}\$/,
  "Local storage must accept only fixed opaque object keys.");
mustContain(storageCore, /flag: "wx"/,
  "Local storage must never overwrite an existing object on first write.");
mustContain(storageCore, /PrivateObjectConflictError/,
  "Local storage must reject same-key different-content replacement.");
mustContain(storageCore, /isSymbolicLink\(\)/,
  "Private storage paths and objects must explicitly reject symbolic links.");
mustContain(storageCore, /await realpath\(this\.root\)/,
  "Private storage root containment must be verified after filesystem resolution.");
mustContain(storageCore, /ensureDirectoryPathWithoutSymlink/,
  "Private storage directories must be created one segment at a time without following symlink authority.");
mustNotContain(storageCore, /mkdir\(this\.root,\s*\{\s*recursive:\s*true/,
  "Private storage must not recursively create a root before symlink checks run.");
mustContain(storageCore, /regular non-symlink file/,
  "Existing objects must be regular files rather than symbolic links.");
mustNotContain(storageCore, /\bfetch\s*\(|https?:\/\//i,
  "Local/test storage must not gain network or public URL authority.");
mustNotContain(storageCore, /eval\s*\(|new Function/,
  "Storage must not execute dynamically selected code.");

const applicationSources = await collectSourceFiles(resolve("src"));
for (const path of applicationSources) {
  if (path.endsWith("private-object-storage.ts") || path.endsWith("private-object-storage-core.ts")) {
    continue;
  }
  const text = await readFile(path, "utf8");
  mustNotContain(text, /private-object-storage-core/,
    `${path} must not bypass the server-only private storage boundary.`);
}

for (const [name, text] of [
  ["domain", domain],
  ["repository", repository],
  ["storage core", storageCore],
  ["storage boundary", storageBoundary],
  ["service", service]
]) {
  mustNotContain(text, /\bas any\b|@ts-ignore|@ts-expect-error/,
    `Secure-file ${name} must not bypass type/security contracts.`);
}

mustContain(packageJson, /"check:secure-files"/,
  "Secure-file source guard must remain wired into package scripts.");
mustContain(packageJson, /"test:secure-files"/,
  "Secure-file unit regressions must remain wired into package scripts.");
mustContain(packageJson, /"test:secure-files-platform"/,
  "Secure-file platform regressions must remain wired into package scripts.");

console.log("Secure file foundation source/authority guard passed.");
