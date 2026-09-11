import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import {
  ATTEMPT_NOW,
  ATTEMPT_NOW_DATE,
  seedInProgressAttempt,
  seedWorkerPrincipal,
  stableId
} from "../helpers/assessment-attempt-fixture.mjs";

const runtime = process.env.HSE_ASSESSMENT_ATTEMPT_RUNTIME_DIST;
assert.ok(runtime, "HSE_ASSESSMENT_ATTEMPT_RUNTIME_DIST is required");
const serviceModule = await import(
  pathToFileURL(join(runtime, "assessment-attempt", "assessment-attempt-service.js")).href
);
const domainModule = await import(
  pathToFileURL(join(runtime, "assessment-attempt", "assessment-attempt-domain.js")).href
);
const draftDomainModule = await import(
  pathToFileURL(join(runtime, "assessment-attempt", "assessment-attempt-draft-domain.js")).href
);

const { AssessmentAttemptService } = serviceModule;
const { AssessmentAttemptAccessError, AssessmentAttemptConflictError } = domainModule;
const { AssessmentAttemptDraftInputError } = draftDomainModule;

const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-08-draft-service-runtime",
  sessionSecret: "m2-08-draft-service-session-secret-more-than-thirty-two-characters",
  authPepper: "m2-08-draft-service-auth-pepper-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

async function database() {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(db, ENV.releaseSha, "0043_assessment_attempt_drafts");
  return db;
}

function request(fixture, item, overrides = {}) {
  return {
    attemptId: fixture.attemptId,
    position: item.position,
    questionVersionId: item.questionVersionId,
    value: "  server-authoritative unsaved answer  ",
    expectedRevision: null,
    mutationKey: "m208-draft-service-save-0001",
    ...overrides
  };
}

async function draftRow(db, attemptId) {
  const result = await db.query(
    `SELECT form_id,form_item_id,position,question_id,question_version_id,question_type,
            text_value,boolean_value,revision,latest_mutation_key,latest_mutation_digest
     FROM assessment_attempt_drafts
     WHERE attempt_id=$1`,
    [attemptId]
  );
  return result.rows[0] ?? null;
}

async function evidenceCounts(db, attemptId) {
  const audits = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM platform_audit_events
     WHERE target_reference=$1`,
    [attemptId]
  );
  const timeline = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM assurance_case_timeline_events
     WHERE case_id=(SELECT case_id FROM assessment_attempts WHERE attempt_id=$1)`,
    [attemptId]
  );
  return {
    audits: audits.rows[0].count,
    timeline: timeline.rows[0].count
  };
}

test("M2.08 active owning Worker saves only the authoritative current item and autosave creates no evidence event", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "draft-service-owner");
    const fixture = await seedInProgressAttempt(db, principal, "draft-service-owner", [
      { questionType: "SHORT_TEXT" }
    ]);
    const item = fixture.items[0];
    const service = new AssessmentAttemptService(db);
    assert.equal(typeof service.saveCurrentDraft, "function", "saveCurrentDraft service command is missing");

    const before = await evidenceCounts(db, fixture.attemptId);
    const saved = await service.saveCurrentDraft(
      principal,
      request(fixture, item),
      ATTEMPT_NOW_DATE
    );
    assert.equal(saved.attemptId, fixture.attemptId);
    assert.equal(saved.position, 1);
    assert.equal(saved.questionVersionId, item.questionVersionId);
    assert.equal(saved.revision, 1);
    assert.deepEqual(saved.value, {
      textValue: "  server-authoritative unsaved answer  ",
      booleanValue: null
    });
    assert.equal(/mutation.*(key|digest)/i.test(JSON.stringify(saved)), false);

    const stored = await draftRow(db, fixture.attemptId);
    assert.ok(stored);
    assert.equal(stored.form_id, fixture.formId);
    assert.equal(stored.form_item_id, item.formItemId);
    assert.equal(Number(stored.position), 1);
    assert.equal(stored.question_id, item.questionId);
    assert.equal(stored.question_version_id, item.questionVersionId);
    assert.equal(stored.question_type, "SHORT_TEXT");
    assert.equal(stored.text_value, "  server-authoritative unsaved answer  ");
    const after = await evidenceCounts(db, fixture.attemptId);
    assert.deepEqual(after, before);
  } finally {
    await db.close();
  }
});

test("M2.08 draft save fails closed for another Worker, non-Worker roles, and revoked session", async () => {
  const db = await database();
  try {
    const owner = await seedWorkerPrincipal(db, "draft-service-auth-owner");
    const other = await seedWorkerPrincipal(db, "draft-service-auth-other");
    const fixture = await seedInProgressAttempt(db, owner, "draft-service-auth-owner", [
      { questionType: "TRUE_FALSE" }
    ]);
    const item = fixture.items[0];
    const service = new AssessmentAttemptService(db);
    const input = request(fixture, item, { value: true });

    await assert.rejects(
      service.saveCurrentDraft(other, input, ATTEMPT_NOW_DATE),
      AssessmentAttemptAccessError
    );
    for (const role of ["root", "admin", "verifier", "company"]) {
      await assert.rejects(
        service.saveCurrentDraft({ ...owner, activeRole: role }, input, ATTEMPT_NOW_DATE),
        AssessmentAttemptAccessError
      );
    }

    await db.query(
      `UPDATE auth_sessions
       SET revoked_at=$2,revocation_reason='m2_08_draft_test'
       WHERE session_id=$1`,
      [owner.sessionId, ATTEMPT_NOW]
    );
    await assert.rejects(
      service.saveCurrentDraft(owner, input, ATTEMPT_NOW_DATE),
      AssessmentAttemptAccessError
    );
    assert.equal(await draftRow(db, fixture.attemptId), null);
  } finally {
    await db.close();
  }
});

test("M2.08 draft save rejects submitted attempts and stale position/question guards", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "draft-service-stale");
    const fixture = await seedInProgressAttempt(db, principal, "draft-service-stale", [
      { questionType: "SHORT_TEXT" },
      { questionType: "SHORT_TEXT" }
    ]);
    const item = fixture.items[0];
    const service = new AssessmentAttemptService(db);

    await assert.rejects(
      service.saveCurrentDraft(
        principal,
        request(fixture, item, { position: 2 }),
        ATTEMPT_NOW_DATE
      ),
      AssessmentAttemptConflictError
    );
    await assert.rejects(
      service.saveCurrentDraft(
        principal,
        request(fixture, item, {
          questionVersionId: stableId("question_version", "different-stale-question")
        }),
        ATTEMPT_NOW_DATE
      ),
      AssessmentAttemptConflictError
    );

    await db.query(
      `UPDATE assessment_attempts
       SET status='SUBMITTED',current_position=question_count,submitted_at=$2,updated_at=$2
       WHERE attempt_id=$1`,
      [fixture.attemptId, ATTEMPT_NOW]
    );
    await assert.rejects(
      service.saveCurrentDraft(principal, request(fixture, item), ATTEMPT_NOW_DATE),
      AssessmentAttemptConflictError
    );
    assert.equal(await draftRow(db, fixture.attemptId), null);
  } finally {
    await db.close();
  }
});

test("M2.08 draft save refuses an already committed current position and validates against pinned type/options", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "draft-service-committed");
    const fixture = await seedInProgressAttempt(db, principal, "draft-service-committed", [
      { questionType: "MULTIPLE_CHOICE", options: ["Alpha", "Bravo"] }
    ]);
    const item = fixture.items[0];
    const service = new AssessmentAttemptService(db);

    await assert.rejects(
      service.saveCurrentDraft(
        principal,
        request(fixture, item, { value: "Outside" }),
        ATTEMPT_NOW_DATE
      ),
      AssessmentAttemptDraftInputError
    );

    await db.query(
      `INSERT INTO assessment_attempt_answers(
         answer_id,attempt_id,form_id,form_item_id,position,question_id,
         question_version_id,question_type,text_value,boolean_value,numeric_value,committed_at
       ) VALUES($1,$2,$3,$4,1,$5,$6,'MULTIPLE_CHOICE','Alpha',NULL,NULL,$7)`,
      [
        stableId("assessment_answer", "draft-service-committed"),
        fixture.attemptId,
        fixture.formId,
        item.formItemId,
        item.questionId,
        item.questionVersionId,
        ATTEMPT_NOW
      ]
    );
    await assert.rejects(
      service.saveCurrentDraft(
        principal,
        request(fixture, item, { value: "Bravo" }),
        ATTEMPT_NOW_DATE
      ),
      AssessmentAttemptConflictError
    );
    assert.equal(await draftRow(db, fixture.attemptId), null);
  } finally {
    await db.close();
  }
});

test("M2.08 service translates CAS conflicts, preserves idempotent retry, and never leaks draft body in errors", async () => {
  const db = await database();
  try {
    const principal = await seedWorkerPrincipal(db, "draft-service-cas");
    const fixture = await seedInProgressAttempt(db, principal, "draft-service-cas", [
      { questionType: "LONG_TEXT" }
    ]);
    const item = fixture.items[0];
    const service = new AssessmentAttemptService(db);
    const secretBody = "private draft body must never enter errors";
    const firstInput = request(fixture, item, {
      value: secretBody,
      mutationKey: "m208-draft-service-cas-0001"
    });
    const first = await service.saveCurrentDraft(principal, firstInput, ATTEMPT_NOW_DATE);
    assert.equal(first.revision, 1);
    const retry = await service.saveCurrentDraft(principal, firstInput, ATTEMPT_NOW_DATE);
    assert.deepEqual(retry, first);

    const second = await service.saveCurrentDraft(
      principal,
      request(fixture, item, {
        value: "newer accepted body",
        expectedRevision: 1,
        mutationKey: "m208-draft-service-cas-0002"
      }),
      ATTEMPT_NOW_DATE
    );
    assert.equal(second.revision, 2);

    for (const conflictInput of [
      request(fixture, item, {
        value: "stale body",
        expectedRevision: 1,
        mutationKey: "m208-draft-service-cas-stale-0001"
      }),
      request(fixture, item, {
        value: "changed body under reused key",
        expectedRevision: 1,
        mutationKey: "m208-draft-service-cas-0002"
      })
    ]) {
      let thrown = null;
      try {
        await service.saveCurrentDraft(principal, conflictInput, ATTEMPT_NOW_DATE);
      } catch (error) {
        thrown = error;
      }
      assert.ok(thrown instanceof AssessmentAttemptConflictError);
      const message = String(thrown?.message ?? "");
      assert.equal(message.includes(secretBody), false);
      assert.equal(message.includes(String(conflictInput.value)), false);
    }

    const stored = await draftRow(db, fixture.attemptId);
    assert.equal(Number(stored.revision), 2);
    assert.equal(stored.text_value, "newer accepted body");
  } finally {
    await db.close();
  }
});
