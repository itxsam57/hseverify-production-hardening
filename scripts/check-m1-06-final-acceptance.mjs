import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path) {
  const full = resolve(path);
  assert.equal(existsSync(full), true, `${path} must exist.`);
  return readFileSync(full, "utf8");
}
function mustContain(text, pattern, message) { assert.match(text, pattern, message); }
function mustNotContain(text, pattern, message) { assert.doesNotMatch(text, pattern, message); }

const packageDocument = JSON.parse(source("package.json"));
const runner = source("scripts/run-m1-06-final-tests.mjs");
const lifecycle = source("tests/platform/m1-06-final-acceptance.test.mjs");
const recovery = source("tests/platform/m1-06-final-restart-migration.test.mjs");
const checksumRepair = source("tests/platform/migration-checksum-repair.test.mjs");
const repairedUploadMigration = source("database/migrations/0012_secure_file_upload_quarantine.up.sql");
const repairedScanMigration = source("database/migrations/0013_secure_file_malware_scan.up.sql");
const migrationEngine = source("scripts/lib/migrations.mjs");
const nextBuild = source("docs/NEXT_BUILD_UNIT.md");
const finalAcceptance = source("docs/testing/results/M1_06_FINAL_ACCEPTANCE.md");
const finalClosure = source("docs/testing/results/M1_06_FINAL_CLOSURE.md");

assert.equal(packageDocument.scripts["check:m1-06-final"], "node scripts/check-m1-06-final-acceptance.mjs");
assert.equal(packageDocument.scripts["test:m1-06-final"], "node scripts/run-m1-06-final-tests.mjs");
for (const aggregate of ["verify:quick", "check"]) mustContain(packageDocument.scripts[aggregate], /npm run check:m1-06-final(?:\s|$)/, `${aggregate} must execute the cumulative M1.06 source guard.`);
for (const aggregate of ["test:integration", "check"]) mustContain(packageDocument.scripts[aggregate], /npm run test:m1-06-final(?:\s|$)/, `${aggregate} must execute cumulative M1.06 runtime acceptance.`);

for (const marker of [
  "const ENTRY_FILES", "const RUNTIME_STUBS", "const LIB_ALIAS_PREFIX = \"@/lib/\"", "function resolveSourceImport",
  "specifier.startsWith(LIB_ALIAS_PREFIX)", "function runtimeSpecifier", "function runtimeSource", "function collectRuntimeSources",
  "ts.preProcessFile", "normalizeRelativeSourcePath", "M1.06 final runtime alias could not be resolved",
  "m1-06-final-acceptance.test.mjs", "m1-06-final-restart-migration.test.mjs", "migration-checksum-repair.test.mjs"
]) mustContain(runner, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Cumulative M1.06 runner must retain ${marker}.`);
mustNotContain(runner, /const SOURCE_FILES/, "Cumulative M1.06 runner must not regress to a hand-maintained transitive source list.");
mustNotContain(runner, /if \(!specifier\.startsWith\("\."\)\) return null/, "Cumulative M1.06 runner must not drop canonical @/lib path-alias dependencies.");

for (const marker of [
  "reserve, quarantine, scan and signed-access boundaries", "malicious evidence becomes unsafe", "post-scan private-object tampering",
  "Company file remains bound to the exact tenant membership", "secure_file.quarantined", "secure_file.scan.available",
  "secure_file.access.authorized", "secure_file.access.served", "revoked session must fail before private storage read"
]) mustContain(lifecycle, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Cumulative lifecycle acceptance must retain ${marker}.`);

for (const marker of [
  "survive PGlite/private-storage close and reopen", "full M1.06 migration ownership can roll back and reapply",
  "0011_secure_file_foundation", "0010_email_delivery_foundation", "rollbackLatestMigration", "migrationStatus", "checksumMatches", "secure_file.access.authorized"
]) mustContain(recovery, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Cumulative recovery acceptance must retain ${marker}.`);

const appendOnlyActions = ["secure_file.quarantined", "secure_file.scan.queued", "secure_file.scan.available", "secure_file.scan.unsafe", "secure_file.scan.failed", "secure_file.access.authorized", "secure_file.access.served"];
for (const [migrationName, migrationSource] of [["0012", repairedUploadMigration], ["0013", repairedScanMigration]]) {
  for (const action of appendOnlyActions) mustContain(migrationSource, new RegExp(`'${action.replaceAll(".", "\\.")}'`), `${migrationName} replay must preserve append-only audit action ${action}.`);
}

for (const marker of [
  "0012_secure_file_upload_quarantine", "98507fbb39bfeba540a2a06b71e727f28123d35489a89b562dce8396e790af1b",
  "ca17b96eb02983a365bf2a560b4e2428f90efa0b9e845ea550e9ff7d227b04e5", "0013_secure_file_malware_scan",
  "89a0168ff92b2d0df5dad4d5f1b9b99ab5d5a2c92c1b28ce7e03fdf9a16baada",
  "8156083e26ac2c3ad354eddd44b13af801898db2d1cba35f2441c26ac2a18280",
  "b20f0a844faee01315562d9673a75df0494908259a7997d4a0d9e421bb0742d2", "canonicalizeMigrationSql",
  "acceptedLineEndingChecksums", "approved_line_ending_normalization", "migrationChecksumCompatibility", "approved_repair",
  "normalizeApprovedChecksumRepair", "SET checksum = $1"
]) mustContain(migrationEngine, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Migration repair engine must retain ${marker}.`);
for (const marker of [
  "migration checksum repairs are pinned to exact historical/current pairs", "Windows CRLF checkout hashes normalize to the canonical migration checksum",
  "cdf728a36e2b9ecd83978eeefeed64edd3fb6532ff1a179033c7244cf27a060a",
  "every approved legacy checksum normalizes once while every unknown mismatch still fails closed",
  "a later unapproved edit must not inherit a historical checksum exception", "Applied migration checksum mismatch: 0013_secure_file_malware_scan"
]) mustContain(checksumRepair, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Migration checksum repair regression must retain ${marker}.`);

for (const text of [lifecycle, recovery, checksumRepair]) {
  mustNotContain(text, /https?:\/\//i, "Cumulative M1.06 acceptance must not introduce public object URLs.");
  mustNotContain(text, /src\/app\/(?:worker|company|assessor|verifier|admin|root)\//, "Cumulative M1.06 acceptance must not introduce a later product UI workflow.");
  mustNotContain(text, /@ts-ignore|@ts-expect-error|\bas any\b|as unknown as/, "Cumulative M1.06 acceptance must not bypass type/security contracts.");
}

// Permanent M1.06 acceptance owns M1.06 behavior. It may assert that the accepted
// brick remains DONE, but it must not pin whichever future brick happens to be active.
// That temporal state belongs to NEXT_BUILD_UNIT + the global engineering guard.
mustContain(nextBuild, /M1\.06[\s\S]{0,180}\bDONE\b/i, "The canonical build gate must keep M1.06 DONE after final acceptance.");
mustContain(finalAcceptance, /Status:\s+ACCEPTED FOR FORMAL CLOSURE/i, "The permanent M1.06 acceptance record must retain its accepted status.");
mustContain(finalAcceptance, /M1\.06 Subunit 5 exact implementation head:\s*`86d135f87a2a2b53f12b8d5b1a2438944cd426fc`/i, "The permanent M1.06 acceptance record must retain the exact Subunit 5 implementation evidence.");
mustContain(finalClosure, /M1\.06: IN PROGRESS -> DONE/, "The permanent M1.06 closure record must retain the brick transition.");

console.log("Permanent M1.06 cumulative lifecycle, isolation, restart, migration, approved-checksum-repair, cross-platform line-ending normalization, runtime-alias and acceptance-evidence guard passed.");
