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
  outboxDomain,
  worker,
  scanDomain,
  scannerCore,
  scannerBoundary,
  scanRepository,
  scanService,
  scanHandler,
  packageJson
] = await Promise.all([
  source("database/migrations/0013_secure_file_malware_scan.up.sql"),
  source("database/migrations/0013_secure_file_malware_scan.down.sql"),
  source("src/lib/audit/audit-domain.ts"),
  source("src/lib/outbox/outbox-domain.ts"),
  source("src/lib/outbox/outbox-worker.ts"),
  source("src/lib/secure-files/secure-file-scan-domain.ts"),
  source("src/lib/secure-files/malware-scanner-core.ts"),
  source("src/lib/secure-files/malware-scanner.ts"),
  source("src/lib/secure-files/secure-file-scan-repository.ts"),
  source("src/lib/secure-files/secure-file-scan-service.ts"),
  source("src/lib/secure-files/secure-file-scan-handler.ts"),
  source("package.json")
]);
const packageDefinition = JSON.parse(packageJson);

for (const action of [
  "secure_file.scan.queued",
  "secure_file.scan.available",
  "secure_file.scan.unsafe",
  "secure_file.scan.failed"
]) {
  mustContain(migration, new RegExp(`'${action.replaceAll(".", "\\.")}'`),
    `${action} must remain in immutable audit vocabulary.`);
  mustContain(auditDomain, new RegExp(`"${action.replaceAll(".", "\\.")}"`),
    `${action} must remain in runtime audit vocabulary.`);
}
mustContain(migration, /'secure_file\.scan'/,
  "Migration must register exactly the fixed secure file scan outbox job type.");
mustContain(migration, /scan_generation INTEGER NOT NULL DEFAULT 0/,
  "Secure files must carry durable scan generation.");
mustContain(migration, /scan_job_id TEXT NULL[\s\S]*REFERENCES platform_outbox_jobs\(job_id\)/,
  "Secure scan state must bind the exact durable outbox job.");
mustContain(migration, /platform_secure_file_scan_shape/,
  "Database must enforce lifecycle/scan provenance shape.");
mustContain(migration, /platform_secure_file_sync_terminal_scan_job/,
  "Terminal outbox failure must recover still-pending scan state.");
mustContain(migration, /NEW\.status <> 'terminal_failed'/,
  "Terminal scan recovery must only run on the terminal outbox transition.");
mustContain(migration, /lifecycle_status = 'scan_failed'/,
  "Terminal outbox recovery must fail closed instead of leaving scan_pending forever.");
mustContain(migration, /ON CONFLICT \(audit_event_id\) DO NOTHING/,
  "Terminal recovery audit must be deterministic/idempotent.");
mustNotContain(migration, /public_url|signed_url|preview_token|download_token/i,
  "Subunit 3 migration must not pull preview/download authority forward.");
mustNotContain(rollback, /DROP COLUMN|DROP TABLE|DELETE FROM|TRUNCATE/i,
  "Subunit 3 rollback must preserve durable scan/job/audit history.");

mustContain(outboxDomain, /"secure_file\.scan"/,
  "Outbox runtime vocabulary must contain the fixed scan job type.");
mustContain(outboxDomain, /fileRef: string;[\s\S]*generation: number;/,
  "Scan payload must contain only opaque file reference plus generation.");
mustContain(outboxDomain, /keys\.length !== 2[\s\S]*keys\[0\] !== "fileRef"[\s\S]*keys\[1\] !== "generation"/,
  "Scan payload must reject arbitrary extra fields.");
mustNotContain(outboxDomain, /SecureFileScanPayload[\s\S]{0,250}(objectKey|provider|sha256|content|url)/i,
  "Persisted scan payload must not contain storage/provider/content authority.");

mustContain(worker, /"secure_file\.scan": async \(job, lease\) =>\s*handleSecureFileScanJob\(job, lease\)/,
  "Outbox worker must register one fixed secure-file scan handler.");
mustNotContain(worker, /import\s*\(|require\s*\([^"']/,
  "Worker must not dynamically load a persisted/browser-selected handler.");

mustContain(scanDomain, /deriveSecureFileScanBusinessKey/,
  "Scan idempotency business key must be server-derived from immutable scan identity.");
mustContain(scanDomain, /contentSha256[\s\S]*generation/,
  "Scan business key must separate immutable content and generation.");
mustContain(scanDomain, /createHash\("sha256"\)/,
  "Object content must be rehashed server-side before scanner trust.");
mustContain(scanDomain, /normalizeNonCleanCode/,
  "Only a clean scanner outcome may use the reserved clean result code.");

mustContain(scannerBoundary, /import "server-only"/,
  "Application scanner boundary must remain server-only.");
mustContain(scannerBoundary, /createLocalTestMalwareScanner/,
  "Only the deterministic local/test scanner is enabled in this subunit.");
mustContain(scannerCore, /EICAR-STANDARD-ANTIVIRUS-TEST-FILE/,
  "Local/test scanner must support a deterministic malicious fixture.");
mustContain(scannerCore, /HSE_VERIFY_SCAN_RETRY_ONCE/,
  "Local/test scanner must support deterministic retry behavior.");
mustContain(scannerCore, /HSE_VERIFY_SCAN_TERMINAL/,
  "Local/test scanner must support deterministic terminal behavior.");
mustNotContain(scannerCore, /\bfetch\s*\(|https?:\/\//i,
  "Local/test scanner must not use network/provider URLs.");
mustNotContain(scannerCore, /eval\s*\(|new Function/,
  "Scanner must not execute dynamically selected code.");

mustContain(scanRepository, /assertTrustedOutboxLease\(/,
  "Handler repository must require a non-copyable trusted outbox lease capability.");
mustContain(scanRepository, /await this\.assertActiveLease\([\s\S]*SECURE_FILE_SCAN_HANDLER_LOCK_SQL/,
  "Handler lock order must acquire/verify outbox lease before file row to avoid reverse-order deadlocks.");
mustContain(scanRepository, /enqueueInTransaction\(transaction, actor/,
  "Scan scheduling must reuse accepted transactional outbox authority.");
mustContain(scanRepository, /action: "secure_file\.scan\.queued"/,
  "Scheduling must write a material scan-queued audit fact.");
mustContain(scanRepository, /lifecycleStatus !== "quarantined"[\s\S]*lifecycleStatus !== "scan_failed"/,
  "Only quarantined or controlled scan-failed files may schedule a new generation.");
mustContain(scanRepository, /scanGeneration \+ 1/,
  "Controlled rescan must advance generation rather than reuse terminal job identity.");
mustContain(scanRepository, /SECURE_FILE_SCAN_ACTIVE_LEASE_SQL/,
  "Scan finalization must revalidate active exact lease in the database.");
mustContain(scanRepository, /secure_file\.scan\.available/,
  "Clean decision must use shared immutable audit authority.");
mustContain(scanRepository, /secure_file\.scan\.unsafe/,
  "Malicious decision must use shared immutable audit authority.");
mustNotContain(scanRepository, /public_url|signed_url|preview|download/i,
  "Scan repository must not add preview/download behavior.");

mustContain(scanHandler, /storage\.read\(file\.objectKey\)/,
  "Handler must load exactly the server-bound private object.");
mustContain(scanHandler, /bytes\.byteLength !== file\.byteSize/,
  "Handler must revalidate stored byte size.");
mustContain(scanHandler, /computeSecureFileContentSha256\(bytes\) !== file\.contentSha256/,
  "Handler must revalidate stored SHA-256 before scanning.");
mustContain(scanHandler, /createLocalTestMalwareScanner\(environment\.appEnvironment\)/,
  "Handler must use only fixed local/test scanner in this subunit.");
mustContain(scanHandler, /finalStatus: result\.kind === "clean" \? "available" : "unsafe"/,
  "Only a completed clean/malicious scanner decision may set available/unsafe.");
mustNotContain(scanHandler, /public_url|signed_url|preview|download/i,
  "Handler must not mint preview/download authority.");

mustContain(scanService, /scheduleForPrincipal/,
  "Server scan scheduling service must expose only principal+file reference scheduling.");
mustNotContain(scanService, /provider|objectKey|url|handler/i,
  "Scheduling service must not accept provider/storage/handler authority.");

for (const [name, text] of [
  ["scan domain", scanDomain],
  ["scanner core", scannerCore],
  ["scan repository", scanRepository],
  ["scan service", scanService],
  ["scan handler", scanHandler]
]) {
  mustNotContain(text, /\bas any\b|as unknown as|@ts-ignore|@ts-expect-error/,
    `Secure-file ${name} must not bypass type/security contracts.`);
}

assert.equal(
  packageDefinition.scripts["check:secure-scan"],
  "node scripts/check-secure-file-scan.mjs"
);
assert.equal(
  packageDefinition.scripts["test:secure-scan"],
  "node scripts/run-secure-scan-tests.mjs"
);
assert.equal(
  packageDefinition.scripts["test:secure-scan-runtime"],
  "node scripts/run-secure-scan-runtime-tests.mjs"
);
assert.equal(
  packageDefinition.scripts["test:secure-scan-handler-runtime"],
  "node scripts/run-secure-scan-handler-runtime-tests.mjs"
);
assert.equal(
  packageDefinition.scripts["test:secure-scan-platform"],
  "node --test tests/platform/secure-file-scan-migration-stack.test.mjs"
);
for (const [aggregate, requiredScripts] of Object.entries({
  "verify:quick": ["check:secure-scan", "test:unit"],
  "test:unit": ["test:secure-scan"],
  "test:integration": [
    "test:secure-scan-platform",
    "test:secure-scan-runtime",
    "test:secure-scan-handler-runtime"
  ],
  check: [
    "check:secure-scan",
    "test:secure-scan",
    "test:secure-scan-platform",
    "test:secure-scan-runtime",
    "test:secure-scan-handler-runtime"
  ]
})) {
  const command = packageDefinition.scripts[aggregate];
  assert.equal(typeof command, "string", `${aggregate} must remain registered.`);
  for (const required of requiredScripts) {
    assert.match(
      command,
      new RegExp(`npm run ${required.replaceAll("-", "\\-")}(?:\\s|$)`),
      `${aggregate} must execute ${required}.`
    );
  }
}

console.log("Secure file malware scan source/authority guard passed.");
