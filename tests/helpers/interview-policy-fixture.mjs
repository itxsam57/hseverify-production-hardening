import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { assessorInterviewSearchFixture } from "./assessor-interview-search-fixture.mjs";
import { assessorSchedulingPrincipal } from "./assessor-scheduling-native-principal.mjs";
import { loadWorkerRegistrationTs } from "./worker-registration-runtime-loader.mjs";

const { InterviewSchedulingService } = loadWorkerRegistrationTs("src/lib/interview/interview-scheduling-service.ts");
const { InterviewRuntimeService } = loadWorkerRegistrationTs("src/lib/interview/interview-runtime-service.ts");
const { InterviewPlaybookService } = loadWorkerRegistrationTs("src/lib/interview/interview-playbook-service.ts");
const { EffectivePolicyService, pinAssuranceCasePolicySnapshot } = loadWorkerRegistrationTs("src/lib/policy/effective-policy-service.ts");
const { AuthAccessRepository } = loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
export const dimensions = ["technicalKnowledge", "practicalReasoning", "safetyAwareness", "communication", "consistencyWithWrittenAnswers", "confidenceClarity", "tradeJudgment"];
export { configuredPolicy } from "./interview-policy-config.mjs";
import { configuredPolicy } from "./interview-policy-config.mjs";
export async function policyInterview({ policy = configuredPolicy(), start = true, claim = true, credentialTarget = null } = {}) {
  const fixture = await assessorInterviewSearchFixture({ credentialTarget,pinPolicies:false });
  let database;
  try {
    database = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    const adminId = fixture.credentials.admin.accountId, sessionId = "policy-native-" + randomUUID(), now = new Date();
    await new AuthAccessRepository(database).authentication.insertSession({
      sessionId, accountId: adminId, activeRole: "admin",
      tokenHash: createHash("sha256").update(sessionId).digest("hex"),
      csrfTokenHash: createHash("sha256").update("csrf:" + sessionId).digest("hex"),
      userAgentHash: null, ipAddressHash: null, createdAt: now.toISOString(), lastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 3600000).toISOString()
    });
    const admin = { accountId: adminId, sessionId, activeRole: "admin", accountStatus: "active", tenantMembership: null };
    const publisher = new EffectivePolicyService(database);
    const published = await publisher.publishPolicyVersion(admin, {
      frameworkReference: "SEARCH-WORKER", policyReference: "INTERVIEW-POLICY", title: "Approved structured interview",
      effectiveFrom: new Date(now.getTime() - 60000), effectiveTo: null,
      policyValues: policy ? { interview: policy } : { pass_mark: 70 }, overrideAllowedFields: [], overrideDirections: {}
    });
    // Case fixture has no snapshot. Pin through the real immutable-policy producer,
    // then create the original policy-bearing request through the real producer.
    const caseId = fixture.requests.Alpha.caseId, tenantId = fixture.credentials.company.tenantId;
    const snapshot = await pinAssuranceCasePolicySnapshot(database, {
      caseId, tenantId, frameworkReferences: ["SEARCH-WORKER"], policyReference: "INTERVIEW-POLICY",
      referenceTime: now, actorAccountId: adminId
    });
    const principal = await assessorSchedulingPrincipal(database, fixture.credentials.assessor);
    const worker = { accountId: fixture.credentials.worker.accountId, activeRole: "worker", accountStatus: "active", tenantMembership: null };
    const scheduling = new InterviewSchedulingService(database), runtime = new InterviewRuntimeService(Promise.resolve(database)),
      playbook = new InterviewPlaybookService(Promise.resolve(database));
    const original = await scheduling.requestAdditionalInterview({
      tenantId, caseId, workerAccountId: worker.accountId, requestedAt: now.toISOString()
    });
    await database.query("UPDATE assurance_cases SET interview_reference=$2 WHERE case_id=$1", [caseId, original.interviewRequestId]);
    const assigned = await scheduling.assignInterview({ tenantId, request: original, assessorAccountId: principal.accountId });
    const request = await scheduling.scheduleInterview({ principal, tenantId, request: assigned, scheduledAt: now.toISOString() });
    let session = claim ? await runtime.claim(principal, request.interviewRequestId, now) : { interviewSessionId: "legacy-preclaim-" + randomUUID() };
    const set = await playbook.ensure(principal, request.interviewRequestId, now);
    if (start) {
      await runtime.markWorkerReady(worker, request.interviewRequestId, {
        cameraReady: true, microphoneReady: true, connectionReady: true, identityConfirmed: true,
        recordingConsent: false
      }, now);
      await runtime.admit(principal, request.interviewRequestId, now);
      session = await runtime.start(principal, request.interviewRequestId, now);
    }
    const scores = (overrides = {}) => ({
      ...Object.fromEntries(dimensions.map(name => [name, 3])),
      comments: "Candidate demonstrated the controls and supported the recommendation.",
      questionSetId: set.questionSetId, questionSetVersion: set.versionNo,
      coveredQuestionIds: set.questions.map(q => q.questionId),
      safetyFindings: [{ criterionId: "live-work", status: "NOT_OBSERVED", comments: null }],
      ...overrides
    });
    return {
      fixture, database, principal, admin, publisher, published, snapshot, scheduling, runtime, playbook, request, session, set, now, scores,
      save: scorecard => scheduling.saveConsoleState({ tenantId, interviewSessionId: session.interviewSessionId,
        interviewRequestId: request.interviewRequestId, notes: [], scorecard, recommendation: null, submitted: false, updatedAt: now.toISOString() }),
      cleanup: async () => { await database.close(); await fixture.cleanup(); }
    };
  } catch (error) {
    if (database) await database.close();
    await fixture.cleanup();
    throw error;
  }
}
export function actions(x) {
  const output = ts.transpileModule(readFileSync("src/app/assessor/(portal)/interviews/actions.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const record = { exports: {} };
  const localRequire = request => {
    if (request === "next/cache") return { revalidatePath() {} };
    if (request === "next/navigation") return {
      redirect(location) { throw Object.assign(new Error("Action redirect: " + location), { location }); },
      notFound() { throw new Error("Action not found"); }
    };
    if (request === "@/lib/authorization/authorization-service") return { requirePlatformPermission: async () => x.principal };
    if (request === "@/lib/database/database") return { getDatabaseClient: async () => x.database };
    if (request.startsWith("@/")) return loadWorkerRegistrationTs("src/" + request.slice(2) + ".ts");
    throw new Error("Unexpected action dependency: " + request);
  };
  new Function("exports", "require", "module", output)(record.exports, localRequire, record);
  return record.exports;
}
export function scoreForm(x, { recommendation = "PASS", covered = x.set.questions, finding = "NOT_OBSERVED", questionSetId = x.set.questionSetId } = {}) {
  const form = new FormData();
  form.set("interviewSessionId", x.session.interviewSessionId);
  form.set("interviewRequestId", x.request.interviewRequestId);
  form.set("questionSetId", questionSetId);
  form.set("questionSetVersion", String(x.set.versionNo));
  for (const dimension of dimensions) form.set(dimension, "3");
  form.set("comments", "Evidence supports this final recommendation.");
  form.set("recommendation", recommendation);
  for (const q of covered) form.append("coveredQuestionId", q.questionId);
  form.set("safety:live-work", finding);
  form.set("safetyComments:live-work", finding === "CONFIRMED" ? "Candidate explicitly proposed bypassing isolation." : "");
  return form;
}
