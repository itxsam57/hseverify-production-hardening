import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

function fail(message) {
  console.error(`M1.12 source guard failed: ${message}`);
  process.exit(1);
}

function read(path) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) fail(`required surface is missing: ${path}`);
  return readFileSync(absolute, "utf8");
}

function requireMarker(text, marker, label) {
  if (!text.includes(marker)) fail(`${label} is missing required marker: ${marker}`);
}

function requirePattern(text, pattern, label, fact) {
  if (!pattern.test(text)) fail(`${label} is missing contract evidence: ${fact}`);
}

function forbidPattern(text, pattern, label, fact) {
  if (pattern.test(text)) fail(`${label} contains forbidden contract evidence: ${fact}`);
}

function filesUnder(directory) {
  const absolute = resolve(directory);
  if (!existsSync(absolute)) return [];
  const files = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else files.push(path);
  }
  return files;
}

const paths = Object.freeze({
  migrationUp: "database/migrations/0031_public_verification_foundation.up.sql",
  migrationDown: "database/migrations/0031_public_verification_foundation.down.sql",
  evidenceUp: "database/migrations/0032_public_verification_concern_evidence.up.sql",
  evidenceDown: "database/migrations/0032_public_verification_concern_evidence.down.sql",
  domain: "src/lib/public-verification/public-verification-domain.ts",
  capability: "src/lib/public-verification/public-verification-capability.ts",
  repository: "src/lib/public-verification/public-verification-repository.ts",
  request: "src/lib/public-verification/public-verification-request.ts",
  service: "src/lib/public-verification/public-verification-service.ts",
  runtime: "src/lib/public-verification/public-verification-runtime.ts",
  concernFiles: "src/lib/public-verification/public-concern-file-service.ts",
  verifyPage: "src/app/verify/page.tsx",
  verifyActions: "src/app/verify/actions.ts",
  resultPage: "src/app/verify/result/[publicToken]/page.tsx",
  qrPage: "src/app/verify/qr/[publicToken]/page.tsx",
  legacyPage: "src/app/verify/worker/[workerId]/page.tsx",
  contactPage: "src/app/contact/page.tsx",
  contactActions: "src/app/contact/actions.ts",
  verifyForm: "src/components/public-verification/public-verification-form.tsx",
  scanner: "src/components/public-verification/public-qr-scanner.tsx",
  concernForm: "src/components/public-verification/public-concern-form.tsx",
  domainTest: "tests/platform/public-verification-domain.test.mjs",
  migrationTest: "tests/platform/public-verification-migration.test.mjs",
  rateTest: "tests/platform/public-verification-rate-limit.test.mjs",
  serviceTest: "tests/platform/public-verification-service.test.mjs",
  routeTest: "tests/platform/public-verification-routes.test.mjs",
  concernTest: "tests/platform/public-verification-concern.test.mjs",
  evidenceTest: "tests/platform/public-verification-concern-evidence.test.mjs",
  evidenceRollbackTest: "tests/platform/public-verification-concern-evidence-rollback.test.mjs",
  runner: "scripts/run-public-verification-tests.mjs"
});

const sources = Object.fromEntries(
  Object.entries(paths).map(([key, path]) => [key, read(path)])
);

for (const status of [
  "valid",
  "expired",
  "suspended",
  "revoked",
  "not_found_or_invalid",
  "temporarily_unavailable"
]) requireMarker(sources.domain, `"${status}"`, paths.domain);
for (const marker of [
  "publicIdentifier",
  "displayName",
  "status",
  "issuedAt",
  "expiresAt",
  "competencyTitle",
  "restrictions",
  "verifiedAt"
]) requireMarker(sources.domain, marker, paths.domain);
for (const forbidden of [
  "dateOfBirth",
  "nationality",
  "countryOfResidence",
  "verifiedEmail",
  "verifiedPhone",
  "previousLegalName",
  "secureFileId",
  "objectKey",
  "employer"
]) forbidPattern(sources.resultPage, new RegExp(forbidden), paths.resultPage, `private public-result field ${forbidden}`);

for (const marker of [
  "public-verification-result",
  "aes-256-gcm",
  "identifierKind",
  "normalizedIdentifier",
  "expiresAt"
]) requireMarker(sources.capability.toLowerCase(), marker.toLowerCase(), paths.capability);
requirePattern(sources.capability, /10\s*\*\s*60\s*\*\s*1000|600_?000|TEN_MIN/i, paths.capability, "maximum ten-minute capability lifetime");

for (const action of ["lookup", "result", "concern", "concern_upload"])
  requireMarker(sources.migrationUp, `'${action}'`, paths.migrationUp);
for (const category of [
  "identity_mismatch",
  "suspected_fraud",
  "status_dispute",
  "document_concern",
  "other"
]) requireMarker(sources.migrationUp, `'${category}'`, paths.migrationUp);
requirePattern(sources.repository, /INSERT\s+INTO\s+public_verification_rate_limits[\s\S]{0,1400}ON\s+CONFLICT/i, paths.repository, "atomic public rate-limit upsert");
requirePattern(sources.migrationDown, /monotonic[\s\S]*SELECT\s+1/i, paths.migrationDown, "non-destructive concern rollback");
forbidPattern(sources.migrationDown, /DROP\s+(?:TABLE|TRIGGER|FUNCTION)/i, paths.migrationDown, "destructive M1.12 concern rollback");

for (const marker of [
  "public_verification_concern_evidence_candidates",
  "account_public_concern_intake_system",
  "disabled",
  "cannot authenticate",
  "pending",
  "bound",
  "rejected",
  "available",
  "unsafe",
  "scan_failed",
  "public_verification_concern_evidence_secure_file_id_check"
]) requireMarker(sources.evidenceUp, marker, paths.evidenceUp);
requirePattern(sources.evidenceDown, /monotonic[\s\S]*SELECT\s+1/i, paths.evidenceDown, "non-destructive evidence rollback");
forbidPattern(sources.evidenceDown, /DROP\s+(?:TABLE|TRIGGER|FUNCTION)/i, paths.evidenceDown, "destructive concern-evidence rollback");
forbidPattern(sources.evidenceUp, /ON\s+DELETE\s+CASCADE/i, paths.evidenceUp, "cascade deletion of concern evidence history");
forbidPattern(
  sources.evidenceUp,
  /secure_file_id\s+TEXT[\s\S]{0,180}REFERENCES\s+platform_secure_files/i,
  paths.evidenceUp,
  "hard cross-brick foreign key to M1.06 secure-file storage"
);
requirePattern(
  sources.evidenceRollbackTest,
  /cannot block independent M1\.06 rollback and reapply/i,
  paths.evidenceRollbackTest,
  "lower-brick rollback/reapply regression proof"
);

for (const marker of [
  "lookupPublicVerification",
  "resolvePublicVerificationCapability",
  "submitPublicVerificationConcern"
]) requireMarker(sources.service, marker, paths.service);
for (const marker of [
  "PublicConcernUploadAuthority",
  "uploadConcernEvidence",
  "finalizeConcernEvidenceCandidate",
  "validateSecureFileUpload",
  "PrivateObjectStorage",
  "concern_upload",
  "scan"
]) requireMarker(sources.concernFiles, marker, paths.concernFiles);
requireMarker(sources.repository, "ON CONFLICT (reservation_key) DO NOTHING", paths.repository);
requireMarker(sources.repository, "secure_file.scan", paths.repository);
requireMarker(sources.repository, "public-verification-intake", paths.repository);
forbidPattern(
  `${sources.repository}\n${sources.service}\n${sources.concernFiles}`,
  /INSERT\s+INTO\s+platform_audit_events/i,
  "M1.12 service boundary",
  "direct audit-table writes"
);

for (const marker of ["PublicVerificationForm", "Verify a worker or credential", "public information only"])
  requirePattern(sources.verifyPage, new RegExp(marker, "i"), paths.verifyPage, marker);
requireMarker(sources.verifyActions, '"use server"', paths.verifyActions);
requireMarker(sources.verifyActions, "getPublicVerificationRequestRuntime", paths.verifyActions);
requireMarker(sources.verifyActions, "lookupPublicVerification", paths.verifyActions);
requirePattern(sources.verifyActions, /\/verify\/result\//, paths.verifyActions, "opaque canonical result redirect");
requireMarker(sources.resultPage, "resolvePublicVerificationCapability", paths.resultPage);
requirePattern(sources.resultPage, /\/contact\?type=credential-concern/, paths.resultPage, "opaque concern handoff");
requireMarker(sources.qrPage, "verifyPublicVerificationCapability", paths.qrPage);
requireMarker(sources.legacyPage, "redirect", paths.legacyPage);
forbidPattern(sources.legacyPage, /getPublicWorkerProjection|platform_secure_files|worker_identity_version_drafts/, paths.legacyPage, "legacy direct data access");

requireMarker(sources.scanner, '"use client"', paths.scanner);
requireMarker(sources.scanner, "startScanner", paths.scanner);
requireMarker(sources.scanner, "getUserMedia", paths.scanner);
requireMarker(sources.scanner, "BarcodeDetector", paths.scanner);
forbidPattern(sources.scanner, /useEffect\s*\(/, paths.scanner, "automatic camera activation");
forbidPattern(sources.scanner, /fetch\s*\(|XMLHttpRequest|canvas\.toBlob|canvas\.toDataURL/, paths.scanner, "camera-frame upload path");

requireMarker(sources.contactActions, '"use server"', paths.contactActions);
requireMarker(sources.contactActions, "submitPublicVerificationConcern", paths.contactActions);
requireMarker(sources.contactActions, "getPublicConcernFileService", paths.contactActions);
requireMarker(sources.concernForm, 'name="evidence"', paths.concernForm);
forbidPattern(sources.concernForm, /\bencType=/, paths.concernForm, "manual Server Action form encoding override");
for (const forbiddenField of [
  "accountId",
  "identityId",
  "identityVersionId",
  "tenantId",
  "membershipId",
  "concernId",
  "secureFileId",
  "fileId",
  "reservationKey",
  "objectKey",
  "ownerAccountId",
  "ownerRole"
]) {
  forbidPattern(
    sources.contactActions,
    new RegExp(`formData\\.get\\([\"']${forbiddenField}[\"']\\)`),
    paths.contactActions,
    `browser-selected authority ${forbiddenField}`
  );
}

const publicRouteSource = filesUnder("src/app/verify")
  .concat(filesUnder("src/app/contact"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
forbidPattern(
  publicRouteSource,
  /secure-file-access|authorizeSecureFileAccess|createSecureFileAccess|signed[^\n]{0,80}(?:preview|download)|(?:preview|download)[^\n]{0,80}signed/i,
  "public M1.12 routes",
  "public concern-evidence preview/download authority"
);
forbidPattern(
  `${sources.service}\n${sources.repository}\n${sources.contactActions}\n${sources.resultPage}`,
  /reviewer[^\n]{0,120}(?:approve|reject|decision)|assessment[^\n]{0,100}(?:deliver|answer|score)|credential[^\n]{0,100}(?:issue|issuance)|living.?record|scoped.?share/i,
  "M1.12 production boundary",
  "later M2/M3 workflow authority"
);

for (const path of [
  paths.domainTest,
  paths.migrationTest,
  paths.rateTest,
  paths.serviceTest,
  paths.routeTest,
  paths.concernTest,
  paths.evidenceTest,
  paths.evidenceRollbackTest,
  paths.runner
]) read(path);

console.log(
  "M1.12 public verification source contract passed: bounded public projection, opaque capability, non-enumerating rate limits, explicit QR activation, idempotent concern intake, scanned private concern evidence, lower-brick rollback isolation and no M2/M3 authority are present."
);
