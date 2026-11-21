import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";
import {
  ATTEMPT_NOW_DATE, seedInProgressAttempt, seedWorkerPrincipal
} from "../helpers/assessment-attempt-fixture.mjs";
import { seedConsoleEvidence, seedConsoleIdentity } from "../helpers/interview-console-file-fixture.mjs";
import { loadAssessmentAttemptRuntime } from "../helpers/assessment-attempt-runtime-loader.mjs";

const databaseUrl = process.env.HSE_POSTGRES_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("M3.12 actual PostgreSQL restore requires HSE_POSTGRES_TEST_DATABASE_URL.");

const runtime = loadAssessmentAttemptRuntime([
  "secure-files/private-object-storage-core.ts",
  "secure-files/secure-file-access-core.ts",
  "secure-files/secure-file-repository.ts"
]);
const load = relative => import(pathToFileURL(join(runtime, relative)).href);
const { AssessmentAttemptService } = await load("assessment-attempt/assessment-attempt-service.js");
const { FilesystemPrivateObjectStorage } = await load("secure-files/private-object-storage-core.js");
const { DatabaseSecureFileRepository } = await load("secure-files/secure-file-repository.js");
const { authorizeSecureFileAccessCore, readSecureFileAccessCore } =
  await load("secure-files/secure-file-access-core.js");

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const signingSecret = "m312-disposable-local-postgres-restoration-signing-key";
const postgres = url => openScriptDatabase({ databaseDriver: "postgres", databaseUrl: url.href });

function restoreCommand(binary, args, parsedUrl) {
  const result = spawnSync(binary, args, {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(parsedUrl.password) },
    encoding: "utf8", timeout: 60_000, maxBuffer: 12 * 1024 * 1024
  });
  assert.equal(result.status, 0, `${binary} failed: ${(result.error?.message ?? result.stderr ?? "").slice(-2500)}`);
}

function pgArgs(url) {
  return [
    "--host", url.hostname, "--port", url.port || "5432",
    "--username", decodeURIComponent(url.username)
  ];
}

function answerHistory(db, attemptId) {
  return db.query(
    `SELECT a.position,a.text_value,a.question_version_id,i.form_item_id,v.prompt,v.content_fingerprint
       FROM assessment_attempt_answers a
       JOIN generated_assessment_form_items i ON i.form_item_id=a.form_item_id AND i.form_id=a.form_id
       JOIN assessment_question_versions v ON v.question_version_id=a.question_version_id
      WHERE a.attempt_id=$1 ORDER BY a.position`, [attemptId]
  ).then(result => result.rows);
}

test("M3.12 cold PG16 custom archive and private object restore preserves active Worker case, draft, identity, and signed bytes", { timeout: 240_000 }, async () => {
  const url = new URL(databaseUrl);
  const suffix = randomBytes(5).toString("hex");
  const sourceName = `m312_active_source_${suffix}`;
  const targetName = `m312_active_restored_${suffix}`;
  const work = await mkdtemp(join(tmpdir(), "hse-m312-pg-restore-"));
  const archive = join(work, "hseverify.dump");
  const originalObjects = join(work, "original-private");
  const backupObjects = join(work, "backup-private");
  const restoredObjects = join(work, "restored-private");
  let admin, source, restored;
  const created = [];

  try {
    admin = await postgres(url);
    for (const name of [sourceName, targetName]) {
      await admin.execute(`CREATE DATABASE "${name}"`);
      created.push(name);
    }
    const withDb = name => {
      const selected = new URL(url.href);
      selected.pathname = "/" + name;
      return selected;
    };
    source = await postgres(withDb(sourceName));
    const applied = await applyPendingMigrations(source, "m312-actual-postgres-source-" + suffix);
    assert(applied.length > 0, "The actual PostgreSQL migration stack must run.");

    const principal = await seedWorkerPrincipal(source, "m312-active-owner-" + suffix);
    const foreign = await seedWorkerPrincipal(source, "m312-active-foreign-" + suffix);
    const caseFixture = await seedInProgressAttempt(
      source, principal, "m312-active-case-" + suffix, [
        { questionType: "SHORT_TEXT", prompt: "Explain the safe lockout process." },
        { questionType: "TRUE_FALSE", prompt: "Verify isolation before beginning." }
      ]
    );
    const worker = new AssessmentAttemptService(source, time => time);
    const committedAnswer = "Lock, tag, isolate and verify before beginning work.";
    await worker.submitCurrentAnswer(principal, {
      attemptId: caseFixture.attemptId, position: 1,
      questionVersionId: caseFixture.items[0].questionVersionId, answer: committedAnswer
    }, ATTEMPT_NOW_DATE);
    await worker.saveCurrentDraft(principal, {
      attemptId: caseFixture.attemptId, position: 2,
      questionVersionId: caseFixture.items[1].questionVersionId,
      value: true, expectedRevision: null, mutationKey: "m312-restore-draft-" + suffix
    }, ATTEMPT_NOW_DATE);
    const before = await worker.getOwnedView(principal, caseFixture.attemptId, ATTEMPT_NOW_DATE);
    const beforeHistory = await answerHistory(source, caseFixture.attemptId);
    assert.equal(before.attempt.currentPosition, 2);
    assert.equal(before.currentDraft?.value, true);
    assert.equal(beforeHistory[0]?.text_value, committedAnswer);

    const identity = await seedConsoleIdentity(source, principal.accountId, "m312-identity-" + suffix);
    const evidence = await seedConsoleEvidence(
      source, principal.accountId, "qualification", "m312-qualification-" + suffix,
      { file: identity.identity_document }
    );
    const evidenceQuery =
      `SELECT r.record_id,r.current_version_id,v.version_status,q.qualification_title,a.secure_file_id
         FROM worker_evidence_records r
         JOIN worker_evidence_versions v ON v.version_id=r.current_version_id
         JOIN worker_qualification_versions q ON q.version_id=v.version_id
         JOIN worker_evidence_attachments a ON a.version_id=v.version_id
        WHERE r.record_id=$1 AND r.worker_account_id=$2`;
    const beforeEvidence = (await source.query(evidenceQuery, [evidence.recordId, principal.accountId])).rows;
    assert.equal(beforeEvidence.length, 1);

    const storage = new FilesystemPrivateObjectStorage({ trustedBasePath: work, rootPath: originalObjects });
    const files = [identity.identity_document, identity.profile_photo, identity.selfie];
    for (const file of files) await storage.put(file.objectKey, file.bytes);
    const migrationCount = Number((await source.query(
      "SELECT COUNT(*)::int AS count FROM hse_schema_migrations"
    )).rows[0].count);
    assert(migrationCount > 0);

    // Cold snapshot: no further source writes while private object bytes and DB are archived.
    await source.close();
    source = null;
    await cp(originalObjects, backupObjects, { recursive: true });
    restoreCommand(
      process.env.HSE_POSTGRES_PG_DUMP || "pg_dump",
      [...pgArgs(url), "--format=custom", "--file", archive, sourceName], url
    );
    restoreCommand(
      process.env.HSE_POSTGRES_PG_RESTORE || "pg_restore",
      [...pgArgs(url), "--exit-on-error", "--no-owner", "--dbname", targetName, archive], url
    );
    await cp(backupObjects, restoredObjects, { recursive: true });

    restored = await postgres(withDb(targetName));
    const recoveredWorker = new AssessmentAttemptService(restored, time => time);
    const after = await recoveredWorker.getOwnedView(principal, caseFixture.attemptId, ATTEMPT_NOW_DATE);
    assert.deepEqual(after, before, "The real consumer view must resume at the same question and draft.");
    assert.deepEqual(await answerHistory(restored, caseFixture.attemptId), beforeHistory);
    assert.equal(Number((await restored.query(
      "SELECT COUNT(*)::int AS count FROM hse_schema_migrations"
    )).rows[0].count), migrationCount);
    await assert.rejects(
      () => recoveredWorker.getOwnedView(foreign, caseFixture.attemptId, ATTEMPT_NOW_DATE),
      error => error.name === "AssessmentAttemptAccessError"
    );
    assert.deepEqual((await restored.query(
      evidenceQuery, [evidence.recordId, principal.accountId]
    )).rows, beforeEvidence);
    assert.equal((await restored.query(
      "SELECT permanent_worker_id FROM worker_identity_worker_ids WHERE worker_account_id=$1",
      [principal.accountId]
    )).rows[0].permanent_worker_id, identity.workerId);
    const recoveredStorage = new FilesystemPrivateObjectStorage({
      trustedBasePath: work, rootPath: restoredObjects
    });
    const repository = new DatabaseSecureFileRepository(Promise.resolve(restored));
    for (const file of files) {
      assert.equal((await recoveredStorage.stat(file.objectKey))?.sha256, digest(file.bytes));
      const issued = await authorizeSecureFileAccessCore({
        principal, fileRef: file.fileId, purpose: "download", signingSecret, repository
      });
      const access = {
        principal, token: issued.token, expectedPurpose: "download",
        signingSecret, repository, storage: recoveredStorage
      };
      assert.equal(digest((await readSecureFileAccessCore(access)).bytes), digest(file.bytes));
      await assert.rejects(
        () => readSecureFileAccessCore({ ...access, principal: foreign }),
        error => error.name === "SecureFileAccessDeniedError"
      );
    }
    console.log(JSON.stringify({
      scope: "LOCAL_DISPOSABLE_POSTGRES_AND_FILES_ONLY", status: "PASS",
      sourceSha: process.env.HSE_RELEASE_SHA || "caller-exact-git-SHA",
      recovered: {
        workerActiveCase: true, submittedAnswer: true, nextDraft: true,
        pinnedQuestionHistory: true, identityWorkerId: true, evidence: true,
        privateObjectDigest: true, signedObjectAccess: true, foreignAccessDenied: true
      },
      notCertified: "real managed staging, live provider integrations, operational RPO/RTO or complete 218 scenarios"
    }));
  } finally {
    await restored?.close().catch(() => undefined);
    await source?.close().catch(() => undefined);
    if (admin) {
      for (const name of created.reverse()) {
        await admin.execute(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).catch(() => undefined);
      }
      await admin.close().catch(() => undefined);
    }
    await rm(work, { recursive: true, force: true });
    await rm(runtime, { recursive: true, force: true });
  }
});
