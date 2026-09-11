import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function read(path) {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    fail(`M1.11 RED: required production surface is missing: ${path}`);
  }
  return readFileSync(absolute, "utf8");
}

function requireMarker(text, marker, label) {
  if (!text.includes(marker)) {
    fail(`${label} is missing M1.11 contract evidence: ${marker}`);
  }
}

function requirePattern(text, pattern, label, fact) {
  if (!pattern.test(text)) {
    fail(`${label} is missing M1.11 contract evidence: ${fact}`);
  }
}

function forbidPattern(text, pattern, label, fact) {
  if (pattern.test(text)) {
    fail(`${label} contains forbidden M1.11 evidence: ${fact}`);
  }
}

const paths = Object.freeze({
  up: "database/migrations/0030_worker_evidence_records.up.sql",
  down: "database/migrations/0030_worker_evidence_records.down.sql",
  domain: "src/lib/worker-evidence/worker-evidence-domain.ts",
  repository: "src/lib/worker-evidence/worker-evidence-repository.ts",
  service: "src/lib/worker-evidence/worker-evidence-service.ts",
  attachments: "src/lib/worker-evidence/worker-evidence-attachment-service.ts",
  fileCandidates: "src/lib/worker-evidence/worker-evidence-file-candidate-repository.ts",
  actionState: "src/lib/worker-evidence/worker-evidence-action-state.ts",
  page: "src/app/worker/(portal)/evidence/page.tsx",
  actions: "src/app/worker/(portal)/evidence/actions.ts",
  workspace: "src/components/worker/worker-evidence-workspace.tsx",
  navigation: "src/components/worker/worker-navigation.tsx",
  auditDomain: "src/lib/audit/audit-domain.ts",
  runtimeTest: "tests/platform/worker-evidence-records.test.mjs",
  asyncRuntimeTest: "tests/platform/worker-evidence-async-scan.test.mjs",
  candidateMigrationTest: "tests/platform/worker-evidence-file-candidate-migration.test.mjs",
  migrationTest: "tests/platform/worker-evidence-migration-stack.test.mjs",
  runner: "scripts/run-worker-evidence-record-tests.mjs"
});

const up = read(paths.up);
const down = read(paths.down);
const domain = read(paths.domain);
const repository = read(paths.repository);
const service = read(paths.service);
const attachments = read(paths.attachments);
const fileCandidates = read(paths.fileCandidates);
read(paths.actionState);
const page = read(paths.page);
const actions = read(paths.actions);
const workspace = read(paths.workspace);
const navigation = read(paths.navigation);
const auditDomain = read(paths.auditDomain);
read(paths.runtimeTest);
read(paths.asyncRuntimeTest);
read(paths.candidateMigrationTest);
read(paths.migrationTest);
read(paths.runner);

for (const marker of [
  "worker_evidence_records",
  "worker_evidence_versions",
  "worker_qualification_versions",
  "worker_experience_versions",
  "worker_employment_versions",
  "worker_skill_versions",
  "worker_evidence_attachments",
  "worker_employment_leaving_letters",
  "worker_evidence_file_candidates"
]) {
  requireMarker(up, marker, paths.up);
}

for (const marker of [
  "qualification",
  "experience",
  "employment",
  "skill",
  "draft",
  "submitted",
  "superseded",
  "self_declared",
  "evidence_verified",
  "competency_assessed",
  "primary_certificate",
  "leaving_letter"
]) {
  requireMarker(`${up}\n${domain}`, marker, "M1.11 persistence/domain");
}

requirePattern(
  down,
  /(?:monotonic|history|compliance)[\s\S]*SELECT\s+1/i,
  paths.down,
  "monotonic non-destructive rollback contract"
);
forbidPattern(
  down,
  /DROP\s+(?:TABLE|TRIGGER|FUNCTION|CONSTRAINT)[\s\S]*worker_(?:evidence|employment)/i,
  paths.down,
  "destructive rollback of retained Worker evidence history"
);

forbidPattern(
  up,
  /worker_account_id\s+text\s+[^;\n]*REFERENCES\s+/i,
  paths.up,
  "hard cross-brick Worker-account foreign key"
);
forbidPattern(
  up,
  /secure_file_id\s+text\s+[^;\n]*REFERENCES\s+/i,
  paths.up,
  "hard cross-brick secure-file foreign key"
);

for (const marker of [
  "WorkerEvidenceRecordKind",
  "WorkerEvidenceVersionStatus",
  "WorkerSkillAssuranceStatus",
  "WorkerEvidenceNotFoundError",
  "WorkerEvidenceConflictError",
  "WorkerEvidenceContractError"
]) {
  requireMarker(domain, marker, paths.domain);
}

requirePattern(
  `${repository}\n${service}`,
  /worker_account_id[\s\S]{0,180}(?:accountId|principal)/,
  "M1.11 Worker ownership",
  "server-derived Worker ownership in persistence queries"
);
forbidPattern(
  service,
  /\bdelete(?:Record|Evidence|Employment|Experience|Qualification|Skill)\s*\(/i,
  paths.service,
  "destructive evidence-record deletion API"
);
forbidPattern(
  `${repository}\n${service}`,
  /DELETE\s+FROM\s+worker_evidence_records/i,
  "M1.11 Worker evidence persistence",
  "physical deletion of Worker evidence records"
);

for (const marker of [
  "SecureFileService",
  "SecureFileUploadService",
  "SecureFileScanService",
  "worker-evidence",
  "businessReference",
  "available",
  "finalizePendingCandidate",
  "listPendingForRecord",
  "scan_pending"
]) {
  requireMarker(attachments, marker, paths.attachments);
}
for (const marker of [
  "reservation_key",
  "expected_active_binding_id",
  "candidate_status",
  "finalizeAttachment",
  "finalizeLeavingLetter",
  "DatabaseAuditRepository"
]) {
  requireMarker(`${up}\n${fileCandidates}`, marker, "M1.11 asynchronous file-candidate boundary");
}
requirePattern(
  attachments,
  /recordId[\s\S]{0,220}versionId[\s\S]{0,220}attachmentKind/,
  paths.attachments,
  "record/version/attachment-specific secure-file binding"
);

requireMarker(
  `${repository}\n${service}\n${attachments}\n${fileCandidates}`,
  "DatabaseAuditRepository",
  "M1.11 transactional audit layer"
);
forbidPattern(
  `${repository}\n${service}\n${attachments}\n${fileCandidates}`,
  /INSERT\s+INTO\s+platform_audit_events/i,
  "M1.11 service layer",
  "direct audit-table writes bypassing DatabaseAuditRepository"
);
for (const marker of [
  "worker_evidence.record.created",
  "worker_evidence.version.submitted",
  "worker_evidence.employment.ended",
  "worker_evidence.skill.inactivated",
  "worker_evidence.leaving_letter.attached"
]) {
  requireMarker(auditDomain, marker, paths.auditDomain);
}

requireMarker(actions, '"use server"', paths.actions);
requireMarker(actions, 'requirePortalAuthorization("worker")', paths.actions);
requireMarker(actions, "finalizeWorkerEvidenceFileCandidateAction", paths.actions);
requireMarker(page, "listPendingForRecord", paths.page);
requireMarker(workspace, "pendingCandidates", paths.workspace);
requireMarker(workspace, "Check scan status", paths.workspace);
requirePattern(
  workspace,
  /security scan[\s\S]{0,300}(?:pending|queued)/i,
  paths.workspace,
  "visible asynchronous malware-scan state"
);
forbidPattern(
  actions,
  /export\s+const\s+\w+[\s\S]{0,200}=\s*Object\.freeze\s*\(/,
  paths.actions,
  "non-function object export from a use-server action module"
);
forbidPattern(
  `${actions}\n${workspace}`,
  /name=["']workerAccountId["']|formData\.get\(["']workerAccountId["']\)/,
  "M1.11 Worker evidence UI/actions",
  "browser-supplied Worker ownership"
);
forbidPattern(
  workspace,
  /\bencType=/,
  paths.workspace,
  "manual form encoding override on React Server Action upload forms"
);

requirePattern(`${page}\n${workspace}`, /qualification/i, "M1.11 Worker evidence UI", "qualification workflow");
requirePattern(`${page}\n${workspace}`, /experience/i, "M1.11 Worker evidence UI", "experience workflow");
requirePattern(`${page}\n${workspace}`, /employment/i, "M1.11 Worker evidence UI", "employment workflow");
requirePattern(`${page}\n${workspace}`, /skill/i, "M1.11 Worker evidence UI", "skill workflow");
requirePattern(`${page}\n${workspace}`, /leaving letter/i, "M1.11 Worker evidence UI", "leaving-letter workflow");
requirePattern(
  workspace,
  /qualification[\s\S]{0,4000}(?:type=["']file["']|name=["']file["'])/i,
  paths.workspace,
  "qualification metadata and file control on one evidence workspace"
);
requireMarker(navigation, 'href: "/worker/evidence"', paths.navigation);

forbidPattern(
  `${service}\n${actions}\n${page}`,
  /reviewer.*(?:approve|reject|changes.requested)|(?:approve|reject).*reviewer/i,
  "M1.11 production surface",
  "M2.02 Reviewer verification decision behavior"
);

console.log(
  "M1.11 Worker evidence records source contract passed: typed records, asynchronous secure-file candidate/finalization safety, history preservation, Worker isolation, centralized audit and route ownership are present."
);
