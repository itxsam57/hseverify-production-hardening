import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function source(path) {
  return readFile(resolve(path), "utf8");
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
  auditDomain,
  uploadDomain,
  repository,
  service,
  packageJson
] = await Promise.all([
  source("database/migrations/0012_secure_file_upload_quarantine.up.sql"),
  source("database/migrations/0012_secure_file_upload_quarantine.down.sql"),
  source("src/lib/audit/audit-domain.ts"),
  source("src/lib/secure-files/secure-file-upload-domain.ts"),
  source("src/lib/secure-files/secure-file-upload-repository.ts"),
  source("src/lib/secure-files/secure-file-upload-service.ts"),
  source("package.json")
]);

mustContain(migration, /'secure_file\.quarantined'/,
  "Subunit 2 must register one material secure-file quarantine audit action.");
mustContain(migration, /'secure_file'/,
  "Subunit 2 audit facts must target the secure-file identity explicitly.");
mustNotContain(migration, /platform_outbox_jobs|job_type IN|scan_pending/i,
  "Subunit 2 must not add scanner/outbox authority before Subunit 3.");
mustNotContain(rollback, /DROP TABLE|DELETE FROM|platform_secure_files/i,
  "Subunit 2 rollback must not delete accepted secure-file or audit history.");

mustContain(auditDomain, /"secure_file\.quarantined"/,
  "Runtime audit vocabulary must understand secure-file quarantine events.");
mustContain(auditDomain, /"secure_file"/,
  "Runtime audit target vocabulary must understand secure files.");

mustContain(uploadDomain, /new WeakSet<object>\(\)/,
  "Upload policy and validated/stored content authority must be non-copyable capabilities.");
mustContain(uploadDomain, /new WeakMap<object, Uint8Array>\(\)/,
  "Validated bytes must be held behind a capability rather than returned as mutable browser data.");
mustContain(uploadDomain, /Uint8Array\.from\(input\.bytes\)/,
  "Untrusted upload bytes must be copied before validation authority is issued.");
mustContain(uploadDomain, /new Set\(input\.allowedKinds\)\.size !== input\.allowedKinds\.length/,
  "Trusted upload policy creation must reject duplicate allowed-kind declarations.");
mustContain(uploadDomain, /createHash\("sha256"\)/,
  "Content SHA-256 must be computed server-side.");
mustContain(uploadDomain, /detectPdf/,
  "PDF structure must be detected from content.");
mustContain(uploadDomain, /detectPng/,
  "PNG structure must be detected from content.");
mustContain(uploadDomain, /detectJpeg/,
  "JPEG structure must be detected from content.");
mustContain(uploadDomain, /%%EOF|0x45, 0x4f, 0x46/,
  "PDF terminal EOF structure must be checked.");
mustContain(uploadDomain, /IEND/,
  "PNG terminal IEND structure must be checked.");
mustContain(uploadDomain, /0xd9/,
  "JPEG terminal EOI marker must be checked.");
mustContain(uploadDomain, /input\.bytes\.byteLength > policy\.maxBytes/,
  "Trusted policy size ceiling must be checked before storage.");
mustContain(uploadDomain, /input\.objectKey !== deriveSecureFileObjectKey\(fileId\)/,
  "Upload validation must bind to the server-derived object key.");
mustNotContain(uploadDomain, /client.*sha|client.*size|browser.*sha|browser.*size/i,
  "Client-provided hash or size must never become upload authority.");

mustContain(repository, /FOR UPDATE/,
  "Quarantine finalization must lock current authorization/file state transactionally.");
mustContain(repository, /owner_account_id = \$2[\s\S]*owner_role = \$3[\s\S]*tenant_id = \$4[\s\S]*membership_id = \$5/,
  "Quarantine reads/writes must bind exact owner/role/Company scope directly in SQL.");
mustContain(repository, /lifecycle_status = 'reserved'/,
  "Database finalization must only advance a reserved file.");
mustContain(repository, /DatabaseAuditRepository\(Promise\.resolve\(transaction\)\)/,
  "Quarantine metadata and material audit event must share one database transaction.");
mustContain(repository, /action: "secure_file\.quarantined"/,
  "Successful quarantine must write the material audit fact.");
mustContain(repository, /target: \{ type: "secure_file", reference: file\.fileId \}/,
  "Quarantine audit must bind the exact secure-file target.");
mustNotContain(repository, /platform_outbox_jobs|scan_pending|SET\s+lifecycle_status\s*=\s*'available'/i,
  "Subunit 2 repository must not execute scanner or availability transitions.");

mustContain(service, /import "server-only"/,
  "Upload orchestration must remain server-only.");
mustContain(service, /findForPrincipal\(input\.principal, input\.fileId\)/,
  "Upload service must resolve the reservation through current scoped authorization.");
mustContain(service, /validateSecureFileUpload\(/,
  "Upload service must validate before durable object write.");
mustContain(service, /storage\.put\(file\.objectKey, bytes\)/,
  "Accepted bytes must write only to the reservation's server-derived object key.");
mustContain(service, /storage\.stat\(file\.objectKey\)/,
  "Stored bytes must be revalidated before metadata finalization.");
mustContain(service, /confirmStoredSecureFileUpload\(/,
  "Only verified stored content may gain finalization authority.");
mustContain(service, /finalizeQuarantine\(owner, actor, stored\)/,
  "Quarantine finalization must use trusted owner/audit/stored capabilities.");
mustNotContain(service, /storage\.delete\(/,
  "Failure recovery must retain staged bytes for exact retry rather than deleting blindly.");
mustNotContain(service, /\bfetch\s*\(|https?:\/\//i,
  "Subunit 2 must not gain public/network storage authority.");
mustNotContain(service, /outbox|scanner|malware|lifecycleStatus\s*===\s*"available"/i,
  "Subunit 2 must not claim scanner or trusted-availability behavior.");

for (const [name, text] of [
  ["upload domain", uploadDomain],
  ["upload repository", repository],
  ["upload service", service]
]) {
  mustNotContain(text, /\bas any\b|as unknown as|@ts-ignore|@ts-expect-error/,
    `Secure-file ${name} must not bypass type/security contracts.`);
}

mustContain(packageJson, /"check:secure-upload"/,
  "Secure upload source guard must remain wired into package scripts.");
mustContain(packageJson, /"test:secure-upload"/,
  "Secure upload unit/recovery regressions must remain wired into package scripts.");
mustContain(packageJson, /"test:secure-upload-platform"/,
  "Secure upload platform regressions must remain wired into package scripts.");
mustContain(packageJson, /"test:secure-upload-runtime"/,
  "The real quarantine repository runtime/atomicity suite must remain wired into the full gate.");

console.log("Secure upload quarantine source/authority guard passed.");
