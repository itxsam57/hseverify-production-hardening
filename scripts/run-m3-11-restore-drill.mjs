import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { openScriptDatabase } from "./lib/database.mjs";
import { applyPendingMigrations } from "./lib/migrations.mjs";
import { ATTEMPT_NOW_DATE, seedInProgressAttempt, seedWorkerPrincipal } from "../tests/helpers/assessment-attempt-fixture.mjs";
import { seedConsoleEvidence, seedConsoleIdentity } from "../tests/helpers/interview-console-file-fixture.mjs";
import { loadAssessmentAttemptRuntime } from "../tests/helpers/assessment-attempt-runtime-loader.mjs";

const root = await mkdtemp(join(tmpdir(), "hse-m311-restore-"));
const sourceDirectory = join(root, "source");
const backupDirectory = join(root, "backup");
const restoredDirectory = join(root, "restored");
const sourceObjects = join(root, "source-objects");
const backupObjects = join(root, "backup-objects");
const restoredObjects = join(root, "restored-objects");
const markerId = "m311_restore_marker";
const markerEvidence = "M3.11 physical PGlite and private object backup/restore";
const runtime = loadAssessmentAttemptRuntime([
  "secure-files/private-object-storage-core.ts",
  "secure-files/secure-file-access-core.ts",
  "secure-files/secure-file-repository.ts",
]);
const load = file => import(pathToFileURL(join(runtime, file)).href);
const { AssessmentAttemptService } = await load("assessment-attempt/assessment-attempt-service.js");
const { FilesystemPrivateObjectStorage } = await load("secure-files/private-object-storage-core.js");
const { DatabaseSecureFileRepository } = await load("secure-files/secure-file-repository.js");
const { authorizeSecureFileAccessCore, readSecureFileAccessCore } = await load("secure-files/secure-file-access-core.js");
const signingSecret = "disposable-restore-drill-private-file-signing-secret";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const environment = dataDirectory => ({ databaseDriver: "pglite", pgliteDataDir: dataDirectory });

async function history(database, fixture) {
  return (await database.query(
    `SELECT a.position,a.text_value,a.question_version_id,i.form_item_id,v.prompt,v.content_fingerprint
       FROM assessment_attempt_answers a
       JOIN generated_assessment_form_items i ON i.form_item_id=a.form_item_id AND i.form_id=a.form_id
       JOIN assessment_question_versions v ON v.question_version_id=a.question_version_id
      WHERE a.attempt_id=$1 ORDER BY a.position`, [fixture.attemptId]
  )).rows;
}

let source = null;
let restored = null;
try {
  source = await openScriptDatabase(environment(sourceDirectory));
  const applied = await applyPendingMigrations(source, "m3-11-restore-source");
  assert(applied.length > 0, "restore source must execute the real migration stack");
  const principal = await seedWorkerPrincipal(source, "restore-owner");
  const foreign = await seedWorkerPrincipal(source, "restore-foreign");
  const fixture = await seedInProgressAttempt(source, principal, "restore-assessment", [
    { questionType: "SHORT_TEXT", prompt: "Explain the safe isolation sequence." },
    { questionType: "TRUE_FALSE", prompt: "Verify isolation before work." },
  ]);
  const service = new AssessmentAttemptService(source, requestTime => requestTime);
  const committed = "Isolate, lock, tag, and verify absence of voltage.";
  await service.submitCurrentAnswer(principal, {
    attemptId: fixture.attemptId, position: 1,
    questionVersionId: fixture.items[0].questionVersionId, answer: committed,
  }, ATTEMPT_NOW_DATE);
  await service.saveCurrentDraft(principal, {
    attemptId: fixture.attemptId, position: 2,
    questionVersionId: fixture.items[1].questionVersionId, value: true,
    expectedRevision: null, mutationKey: "restore-next-question-draft-0001",
  }, ATTEMPT_NOW_DATE);
  const beforeView = await service.getOwnedView(principal, fixture.attemptId, ATTEMPT_NOW_DATE);
  assert.equal(beforeView.attempt.currentPosition, 2);
  assert.equal(beforeView.currentDraft?.value, true);
  assert.equal(beforeView.currentDraft?.revision, 1);
  assert.equal(beforeView.currentQuestion?.questionVersionId, fixture.items[1].questionVersionId);
  const beforeHistory = await history(source, fixture);
  assert.equal(beforeHistory.length, 1);
  assert.equal(beforeHistory[0].text_value, committed);

  const identity = await seedConsoleIdentity(source, principal.accountId, "restore-identity");
  const evidence = await seedConsoleEvidence(source, principal.accountId, "qualification", "restore-evidence", {
    file: identity.identity_document,
  });
  const beforeEvidence = (await source.query(
    `SELECT r.record_id,r.current_version_id,v.version_status,q.qualification_title,a.secure_file_id
       FROM worker_evidence_records r
       JOIN worker_evidence_versions v ON v.version_id=r.current_version_id
       JOIN worker_qualification_versions q ON q.version_id=v.version_id
       JOIN worker_evidence_attachments a ON a.version_id=v.version_id
      WHERE r.record_id=$1 AND r.worker_account_id=$2`, [evidence.recordId, principal.accountId]
  )).rows;
  assert.equal(beforeEvidence.length, 1);
  const objects = new FilesystemPrivateObjectStorage({ trustedBasePath: root, rootPath: sourceObjects });
  const files = [identity.identity_document, identity.profile_photo, identity.selfie];
  for (const file of files) await objects.put(file.objectKey, file.bytes);

  await source.query(
    `INSERT INTO operations_certification_drills(drill_id,drill_name,status,evidence)
     VALUES($1,'restore','passed',$2)`, [markerId, markerEvidence]
  );
  const expectedMigrationCount = Number((await source.query(
    "SELECT COUNT(*)::int AS count FROM hse_schema_migrations"
  )).rows[0]?.count ?? 0);
  assert(expectedMigrationCount > 0);
  await source.close();
  source = null;

  // A consistent cold fixture backup: no database writer is running during the copy.
  await cp(sourceDirectory, backupDirectory, { recursive: true });
  await cp(sourceObjects, backupObjects, { recursive: true });
  await cp(backupDirectory, restoredDirectory, { recursive: true });
  await cp(backupObjects, restoredObjects, { recursive: true });
  restored = await openScriptDatabase(environment(restoredDirectory));

  const marker = (await restored.query(
    "SELECT drill_name,status,evidence FROM operations_certification_drills WHERE drill_id=$1", [markerId]
  )).rows[0];
  assert.deepEqual(marker, { drill_name: "restore", status: "passed", evidence: markerEvidence });
  assert.equal(Number((await restored.query(
    "SELECT COUNT(*)::int AS count FROM hse_schema_migrations"
  )).rows[0]?.count), expectedMigrationCount);

  const recoveredService = new AssessmentAttemptService(restored, requestTime => requestTime);
  const recoveredView = await recoveredService.getOwnedView(principal, fixture.attemptId, ATTEMPT_NOW_DATE);
  assert.deepEqual(recoveredView, beforeView, "actual owned assessment consumer must resume the exact next question and draft");
  assert.equal(recoveredView.currentDraft?.value, true);
  assert.equal(recoveredView.currentDraft?.revision, 1);
  assert.equal(recoveredView.currentQuestion?.questionVersionId, fixture.items[1].questionVersionId);
  assert.deepEqual(await history(restored, fixture), beforeHistory, "committed answer and pinned question history must survive");
  await assert.rejects(() => recoveredService.getOwnedView(foreign, fixture.attemptId, ATTEMPT_NOW_DATE),
    error => error.name === "AssessmentAttemptAccessError");
  const recoveredEvidence = (await restored.query(
    `SELECT r.record_id,r.current_version_id,v.version_status,q.qualification_title,a.secure_file_id
       FROM worker_evidence_records r
       JOIN worker_evidence_versions v ON v.version_id=r.current_version_id
       JOIN worker_qualification_versions q ON q.version_id=v.version_id
       JOIN worker_evidence_attachments a ON a.version_id=v.version_id
      WHERE r.record_id=$1 AND r.worker_account_id=$2`, [evidence.recordId, principal.accountId]
  )).rows;
  assert.deepEqual(recoveredEvidence, beforeEvidence);
  const permanentId = (await restored.query(
    "SELECT permanent_worker_id FROM worker_identity_worker_ids WHERE worker_account_id=$1", [principal.accountId]
  )).rows[0]?.permanent_worker_id;
  assert.equal(permanentId, identity.workerId);

  const storage = new FilesystemPrivateObjectStorage({ trustedBasePath: root, rootPath: restoredObjects });
  const repository = new DatabaseSecureFileRepository(Promise.resolve(restored));
  for (const file of files) {
    assert.equal((await storage.stat(file.objectKey))?.sha256, digest(file.bytes));
    const issued = await authorizeSecureFileAccessCore({
      principal, fileRef: file.fileId, purpose: "download", signingSecret, repository,
    });
    const readInput = {
      principal, token: issued.token, expectedPurpose: "download", signingSecret, repository, storage,
    };
    const content = await readSecureFileAccessCore(readInput);
    assert.equal(digest(content.bytes), digest(file.bytes), "actual signed file consumer must return original restored bytes");
    await assert.rejects(() => readSecureFileAccessCore({ ...readInput, principal: foreign }),
      error => error.name === "SecureFileAccessDeniedError");
  }
  console.log(JSON.stringify({
    status: "PASS", drill: "restore",
    evidence: "Cold disposable PGlite and private objects restored; actual owned assessment and signed file consumers verified.",
    scope: "Disposable local fixture; production PostgreSQL backup, storage encryption, RPO and RTO remain separate release gates.",
    migrationCount: expectedMigrationCount,
    businessRecovery: {
      committedAnswer: true, nextQuestionDraft: true, pinnedQuestionHistory: true,
      versionedEvidence: true, privateObjectDigest: true, permanentWorkerId: true, foreignWorkerDenied: true,
    },
  }));
} finally {
  await source?.close().catch(() => undefined);
  await restored?.close().catch(() => undefined);
  await rm(root, { recursive: true, force: true });
  await rm(runtime, { recursive: true, force: true });
}
