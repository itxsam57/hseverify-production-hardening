import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { assessorInterviewSearchFixture } from "../helpers/assessor-interview-search-fixture.mjs";
import { assessorSchedulingPrincipal } from "../helpers/assessor-scheduling-native-principal.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";

const { InterviewSchedulingService } = loadWorkerRegistrationTs("src/lib/interview/interview-scheduling-service.ts");
const { InterviewRuntimeService } = loadWorkerRegistrationTs("src/lib/interview/interview-runtime-service.ts");
const { InterviewPlaybookService } = loadWorkerRegistrationTs("src/lib/interview/interview-playbook-service.ts");
const dimensions = [
  "technicalKnowledge", "practicalReasoning", "safetyAwareness", "communication",
  "consistencyWithWrittenAnswers", "confidenceClarity", "tradeJudgment"
];
const completeScores = () => Object.fromEntries([
  ...dimensions.map((name) => [name, 3]),
  ["comments", "Candidate explained the controls and supported the recommendation."]
]);

// Latest-schema isolated case setup comes from the existing search fixture.
// Actual scheduling, claim/ready/admit/start, draft, playbook and End services run
// against its PGlite database. Readiness inputs are supplied, not media proof.
async function activeInterview({ createPlaybook = true, start = true, scheduleOffset = 0 } = {}) {
  const fixture = await assessorInterviewSearchFixture();
  let database;
  try {
    database = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    const principal = await assessorSchedulingPrincipal(database, fixture.credentials.assessor);
    const worker = {
      accountId: fixture.credentials.worker.accountId,
      activeRole: "worker", accountStatus: "active", tenantMembership: null
    };
    const scheduling = new InterviewSchedulingService(database);
    const runtime = new InterviewRuntimeService(Promise.resolve(database));
    const playbook = new InterviewPlaybookService(Promise.resolve(database));
    const request = await scheduling.scheduleInterview({
      principal, tenantId: fixture.credentials.company.tenantId,
      request: fixture.requests.Alpha, scheduledAt: new Date(Date.now() + scheduleOffset).toISOString()
    });
    let session = await runtime.claim(principal, request.interviewRequestId);
    if (createPlaybook) await playbook.ensure(principal, request.interviewRequestId);
    if (start) {
      await runtime.markWorkerReady(worker, request.interviewRequestId, {
        cameraReady: true, microphoneReady: true, connectionReady: true,
        identityConfirmed: true, recordingConsent: false
      });
      await runtime.admit(principal, request.interviewRequestId);
      session = await runtime.start(principal, request.interviewRequestId);
    }
    return {
      fixture, database, principal, scheduling, runtime, playbook, request, session,
      save: (scorecard, submitted = false) => scheduling.saveConsoleState({
        tenantId: fixture.credentials.company.tenantId,
        interviewSessionId: session.interviewSessionId,
        interviewRequestId: request.interviewRequestId,
        notes: [], scorecard, recommendation: null, submitted,
        updatedAt: new Date().toISOString()
      }),
      cleanup: async () => { await database.close(); await fixture.cleanup(); }
    };
  } catch (error) {
    if (database) await database.close();
    await fixture.cleanup();
    throw error;
  }
}

test("End rejects saved null score dimensions without closing the actual runtime", async () => {
  const x = await activeInterview();
  try {
    const incompleteScores = [
      { ...completeScores(), ...Object.fromEntries(dimensions.map((name) => [name, null])) },
      ...dimensions.map((name) => ({ ...completeScores(), [name]: null }))
    ];
    for (const scorecard of incompleteScores) {
      await x.save(scorecard);
      await assert.rejects(
        x.runtime.end(x.principal, x.request.interviewRequestId),
        { name: "InterviewRuntimeConflictError" }
      );
      assert.equal((await x.runtime.view(x.principal, x.request.interviewRequestId)).status, "ACTIVE");
    }
    assert.equal((await x.database.query(
      "SELECT COUNT(*)::int AS count FROM interview_runtime_events WHERE interview_session_id=$1 AND event_type='ENDED'",
      [x.session.interviewSessionId]
    )).rows[0].count, 0);
  } finally { await x.cleanup(); }
});

test("End rejects stored coercible and out-of-range scores", async () => {
  const x = await activeInterview();
  try {
    for (const invalid of [false, "", "3", -1, 6, 2.5]) {
      await x.save({ ...completeScores(), technicalKnowledge: invalid });
      await assert.rejects(x.runtime.end(x.principal, x.request.interviewRequestId),
        { name: "InterviewRuntimeConflictError" }, "Stored score must be an actual integer 0–5: " + JSON.stringify(invalid));
      assert.equal((await x.runtime.view(x.principal, x.request.interviewRequestId)).status, "ACTIVE");
    }
  } finally { await x.cleanup(); }
});

test("End requires saved nonempty scorecard comments", async () => {
  const x = await activeInterview();
  try {
    for (const comments of [null, "", "   \n ", 123]) {
      await x.save({ ...completeScores(), comments });
      await assert.rejects(x.runtime.end(x.principal, x.request.interviewRequestId),
        { name: "InterviewRuntimeConflictError" });
      assert.equal((await x.runtime.view(x.principal, x.request.interviewRequestId)).status, "ACTIVE");
    }
  } finally { await x.cleanup(); }
});

test("End accepts the zero and five score boundaries with saved comments", async () => {
  const x = await activeInterview();
  try {
    await x.save({ ...completeScores(), technicalKnowledge: 0, safetyAwareness: 5 });
    assert.equal((await x.runtime.end(x.principal, x.request.interviewRequestId)).status, "ENDED");
    assert.equal((await x.database.query(
      "SELECT COUNT(*)::int AS count FROM interview_runtime_events WHERE interview_session_id=$1 AND event_type='ENDED'",
      [x.session.interviewSessionId])).rows[0].count, 1);
  } finally { await x.cleanup(); }
});

// Framework request context/cookie resolution and cache invalidation need a Next
// server. Native action tests inject the persisted fixture actor and real DB at
// those boundaries; all action transactions and business services remain real.
function interviewActions(x) {
  const path = "src/app/assessor/(portal)/interviews/actions.ts";
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const record = { exports: {} };
  const localRequire = (request) => {
    if (request === "next/cache") return { revalidatePath() {} };
    if (request === "next/navigation") return {
      redirect(location) { throw Object.assign(new Error("Action redirect"), { location }); },
      notFound() { throw new Error("Action not found"); }
    };
    if (request === "@/lib/authorization/authorization-service") return {
      requirePlatformPermission: async () => x.principal
    };
    if (request === "@/lib/database/database") return { getDatabaseClient: async () => x.database };
    if (request.startsWith("@/")) return loadWorkerRegistrationTs("src/" + request.slice(2) + ".ts");
    throw new Error("Unexpected action dependency: " + request);
  };
  new Function("exports", "require", "module", output)(record.exports, localRequire, record);
  return record.exports;
}
function recommendationForm(x, comments = "Evidence supports the saved final recommendation.") {
  const form = new FormData();
  form.set("interviewSessionId", x.session.interviewSessionId);
  form.set("interviewRequestId", x.request.interviewRequestId);
  for (const dimension of dimensions) form.set(dimension, "3");
  form.set("comments", comments);
  form.set("recommendation", "PASS");
  return form;
}
async function storedFinalization(x) {
  return {
    request: (await x.database.query("SELECT status FROM interview_requests WHERE interview_request_id=$1", [x.request.interviewRequestId])).rows,
    draft: (await x.database.query("SELECT scorecard,recommendation,submitted FROM interview_console_drafts WHERE interview_request_id=$1", [x.request.interviewRequestId])).rows,
    case: (await x.database.query("SELECT case_status,owner_kind,interview_reference FROM assurance_cases WHERE case_id=$1", [x.request.caseId])).rows,
    timeline: (await x.database.query("SELECT event_type,to_status FROM assurance_case_timeline_events WHERE case_id=$1 ORDER BY occurred_at,timeline_event_id", [x.request.caseId])).rows
  };
}

test("Submit rejects empty comments without locking or advancing the real records", async () => {
  const x = await activeInterview();
  try {
    await x.save(completeScores());
    await x.runtime.end(x.principal, x.request.interviewRequestId);
    const before = await storedFinalization(x);
    await assert.rejects(interviewActions(x).submitInterviewConsoleAction(recommendationForm(x, "   ")),
      /comments.*required|required.*comments/i);
    assert.deepEqual(await storedFinalization(x), before);
  } finally { await x.cleanup(); }
});

test("Complete Submit locks the recommendation and reaches the real decision workflow", async () => {
  const x = await activeInterview();
  try {
    await x.save(completeScores());
    await x.runtime.end(x.principal, x.request.interviewRequestId);
    await interviewActions(x).submitInterviewConsoleAction(recommendationForm(x));
    const result = await storedFinalization(x);
    assert.equal(result.request[0].status, "COMPLETED");
    assert.equal(result.draft[0].submitted, true);
    assert.equal(result.draft[0].recommendation, "PASS");
    assert.equal(result.case[0].case_status, "Decision pending");
    assert.equal(result.case[0].owner_kind, "admin");
    assert(result.timeline.some((row) => row.event_type === "interview_recommendation_submitted"));
    const before = await x.playbook.getAssigned(x.principal, x.request.interviewRequestId);
    await assert.rejects(x.playbook.addFollowUp(x.principal, x.request.interviewRequestId,
      "A submitted recommendation must keep its historical question set."),
      { name: "InterviewPlaybookInputError" });
    assert.deepEqual(await x.playbook.getAssigned(x.principal, x.request.interviewRequestId), before);
  } finally { await x.cleanup(); }
});

test("Ended runtime prevents new follow-up versions and keeps historical questions readable", async () => {
  const x = await activeInterview();
  try {
    const before = await x.playbook.getAssigned(x.principal, x.request.interviewRequestId);
    await x.save(completeScores());
    await x.runtime.end(x.principal, x.request.interviewRequestId);
    await assert.rejects(x.playbook.addFollowUp(x.principal, x.request.interviewRequestId,
      "An ended interview must not accept an additional question version."),
      { name: "InterviewPlaybookInputError" });
    assert.deepEqual(await x.playbook.getAssigned(x.principal, x.request.interviewRequestId), before);
  } finally { await x.cleanup(); }
});

test("Ended runtime cannot generate a previously missing question set", async () => {
  const x = await activeInterview({ createPlaybook: false });
  try {
    await x.save(completeScores());
    await x.runtime.end(x.principal, x.request.interviewRequestId);
    await assert.rejects(x.playbook.ensure(x.principal, x.request.interviewRequestId),
      { name: "InterviewPlaybookInputError" });
    assert.equal(await x.playbook.getAssigned(x.principal, x.request.interviewRequestId), null);
  } finally { await x.cleanup(); }
});

test("Submitted draft prevents playbook creation or follow-up while the runtime is still active", async () => {
  const x = await activeInterview();
  try {
    const before = await x.playbook.getAssigned(x.principal, x.request.interviewRequestId);
    await x.save(completeScores(), true);
    await assert.rejects(x.playbook.ensure(x.principal, x.request.interviewRequestId),
      { name: "InterviewPlaybookInputError" });
    await assert.rejects(x.playbook.addFollowUp(x.principal, x.request.interviewRequestId,
      "An already submitted draft cannot receive a new question version."),
      { name: "InterviewPlaybookInputError" });
    assert.deepEqual(await x.playbook.getAssigned(x.principal, x.request.interviewRequestId), before);
  } finally { await x.cleanup(); }
});

test("A superseded current-case reference prevents writes to an otherwise open playbook", async () => {
  const x = await activeInterview();
  try {
    const before = await x.playbook.getAssigned(x.principal, x.request.interviewRequestId);
    const { advanceAfterInterviewRecommendation } = loadWorkerRegistrationTs("src/lib/assurance/assurance-case-progression-service.ts");
    // Exercise the real second-interview current-reference producer directly;
    // the action's completion ordering is covered by the separate Submit test.
    await advanceAfterInterviewRecommendation(x.database, {
      caseId: x.request.caseId, tenantId: x.fixture.credentials.company.tenantId,
      recommendation: "SECOND_INTERVIEW_REQUIRED",
      actor: { accountId: x.principal.accountId, role: "assessor" }, now: new Date()
    });
    const current = (await x.database.query(
      "SELECT interview_reference FROM assurance_cases WHERE case_id=$1", [x.request.caseId])).rows[0].interview_reference;
    assert.notEqual(current, x.request.interviewRequestId);
    await assert.rejects(x.playbook.ensure(x.principal, x.request.interviewRequestId),
      { name: "InterviewPlaybookInputError" });
    await assert.rejects(x.playbook.addFollowUp(x.principal, x.request.interviewRequestId,
      "A superseded interview cannot change the frozen historical playbook."),
      { name: "InterviewPlaybookInputError" });
    assert.deepEqual(await x.playbook.getAssigned(x.principal, x.request.interviewRequestId), before);
  } finally { await x.cleanup(); }
});

test("No-show runtime cannot create a missing playbook", async () => {
  const x = await activeInterview({ createPlaybook: false, start: false, scheduleOffset: -45 * 60 * 1000 });
  try {
    assert.equal((await x.runtime.noShow(x.principal, x.request.interviewRequestId)).status, "NO_SHOW");
    await assert.rejects(x.playbook.ensure(x.principal, x.request.interviewRequestId),
      { name: "InterviewPlaybookInputError" });
    assert.equal(await x.playbook.getAssigned(x.principal, x.request.interviewRequestId), null);
  } finally { await x.cleanup(); }
});
