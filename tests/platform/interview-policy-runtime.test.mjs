import assert from "node:assert/strict";
import test from "node:test";
import { policyInterview, configuredPolicy, actions, scoreForm } from "../helpers/interview-policy-fixture.mjs";

test("Published pinned interview policy reaches original request and a stable approved candidate question set", async () => {
  const x = await policyInterview();
  try {
    const request = (await x.database.query("SELECT trade_scope,qualification_scope,risk_level,jurisdiction,recording_policy,recording_retention_days FROM interview_requests WHERE interview_request_id=$1", [x.request.interviewRequestId])).rows[0];
    assert.deepEqual(request, { trade_scope: "electrical", qualification_scope: "level-3", risk_level: "HIGH", jurisdiction: "GB", recording_policy: "NOTES_ONLY", recording_retention_days: 45 });
    assert.equal(x.set.sourceContext.policySnapshotId, x.snapshot.snapshotId);
    assert.equal(x.set.sourceContext.policyVersionId, x.published);
    assert.equal(x.set.sourceContext.policyMode, "CONFIGURED");
    assert(x.set.questions.some(q => q.templateId === "controls"));
    assert(x.set.questions.some(q => q.templateId === "safety"));
    assert.equal(x.set.questions.filter(q => q.kind === "RANDOM").length, 1);
    assert(!x.set.questions.some(q => ["foreign", "follow"].includes(q.templateId)));
    assert.deepEqual(await x.playbook.ensure(x.principal, x.request.interviewRequestId), x.set);
    await assert.rejects(x.playbook.addFollowUp(x.principal, x.request.interviewRequestId, "Invented assessor text must not replace approved follow-up templates."), /approved/i);
    const followed = await x.playbook.addFollowUp(x.principal, x.request.interviewRequestId, "follow");
    assert.equal(followed.questions.at(-1).templateId, "follow");
    assert.deepEqual(followed.questions.slice(0, -1), x.set.questions);
  } finally { await x.cleanup(); }
});

test("Actual policy publisher rejects malformed interview controls before publishing", async () => {
  const x = await policyInterview();
  try {
    for (const policy of [
      { ...configuredPolicy(), minimumActiveSeconds: "60" },
      { ...configuredPolicy(), minimumTopics: ["unrepresented"] },
      { ...configuredPolicy(), questions: [...configuredPolicy().questions, configuredPolicy().questions[0]] },
      { ...configuredPolicy(), recording: { policy: "PROHIBITED", retentionDays: 30, consentRequired: true } }
    ]) {
      await assert.rejects(x.publisher.publishPolicyVersion(x.admin, {
        frameworkReference: "SEARCH-WORKER", policyReference: "INVALID-" + Math.random().toString(36).slice(2),
        title: "Must reject", effectiveFrom: new Date(), effectiveTo: null,
        policyValues: { interview: policy }, overrideAllowedFields: [], overrideDirections: {}
      }), /interview/i);
    }
  } finally { await x.cleanup(); }
});

test("End enforces configured active duration excluding pause and requires frozen coverage and safety findings", async () => {
  const x = await policyInterview();
  try {
    await x.save(x.scores());
    await assert.rejects(x.runtime.end(x.principal, x.request.interviewRequestId, new Date(x.now.getTime() + 30000)), /duration|active/i);
    await x.runtime.pause(x.principal, x.request.interviewRequestId, "Controlled interruption", new Date(x.now.getTime() + 30000));
    await x.runtime.resume(x.principal, x.request.interviewRequestId, new Date(x.now.getTime() + 120000));
    await assert.rejects(x.runtime.end(x.principal, x.request.interviewRequestId, new Date(x.now.getTime() + 140000)), /duration|active/i);
    for (const incomplete of [
      x.scores({ coveredQuestionIds: [] }),
      x.scores({ coveredQuestionIds: ["foreign-question"] }),
      x.scores({ questionSetId: "foreign-question-set" }),
      x.scores({ safetyFindings: [] })
    ]) {
      await x.save(incomplete);
      await assert.rejects(x.runtime.end(x.principal, x.request.interviewRequestId, new Date(x.now.getTime() + 160000)), /coverage|question|safety/i);
      assert.equal((await x.runtime.view(x.principal, x.request.interviewRequestId)).status, "ACTIVE");
    }
    await x.save(x.scores());
    assert.equal((await x.runtime.end(x.principal, x.request.interviewRequestId, new Date(x.now.getTime() + 160000))).status, "ENDED");
    const scorecard = (await x.database.query("SELECT scorecard FROM interview_console_drafts WHERE interview_request_id=$1", [x.request.interviewRequestId])).rows[0].scorecard;
    assert.equal(scorecard.activeSeconds, 70);
    assert.equal(scorecard.questionSetId, x.set.questionSetId);
  } finally { await x.cleanup(); }
});

test("Real Submit refuses PASS for a confirmed automatic-fail finding and valid FAIL follows existing reassessment progression", async () => {
  const policy = { ...configuredPolicy(), minimumActiveSeconds: 0 };
  const x = await policyInterview({ policy });
  try {
    await actions(x).saveInterviewConsoleAction(scoreForm(x, { finding: "CONFIRMED" }));
    await x.runtime.end(x.principal, x.request.interviewRequestId);
    await assert.rejects(actions(x).submitInterviewConsoleAction(scoreForm(x, { finding: "CONFIRMED" })), /safety|fail/i);
    assert.equal((await x.database.query("SELECT submitted FROM interview_console_drafts WHERE interview_request_id=$1", [x.request.interviewRequestId])).rows[0].submitted, false);
    await actions(x).submitInterviewConsoleAction(scoreForm(x, { finding: "CONFIRMED", recommendation: "FAIL" }));
    assert.equal((await x.database.query("SELECT recommendation,submitted FROM interview_console_drafts WHERE interview_request_id=$1", [x.request.interviewRequestId])).rows[0].recommendation, "FAIL");
    assert.equal((await x.database.query("SELECT case_status FROM assurance_cases WHERE case_id=$1", [x.request.caseId])).rows[0].case_status, "Reassessment required");
  } finally { await x.cleanup(); }
});

test("Real draft action denies tampered question references and confirmed safety findings cannot be removed after End", async () => {
  const x = await policyInterview({ policy: { ...configuredPolicy(), minimumActiveSeconds: 0 } });
  try {
    await assert.rejects(actions(x).saveInterviewConsoleAction(scoreForm(x, { questionSetId: "foreign-set" })), /question/i);
    await actions(x).saveInterviewConsoleAction(scoreForm(x, { finding: "CONFIRMED" }));
    await x.runtime.end(x.principal, x.request.interviewRequestId);
    await assert.rejects(actions(x).submitInterviewConsoleAction(scoreForm(x)), /safety|ended|frozen/i);
    assert.equal((await x.database.query("SELECT submitted FROM interview_console_drafts WHERE interview_request_id=$1", [x.request.interviewRequestId])).rows[0].submitted, false);
  } finally { await x.cleanup(); }
});


test("End denies tampered replay selection and frozen policy or foreign ownership without closing", async () => {
  const x = await policyInterview({ policy: { ...configuredPolicy(), minimumActiveSeconds: 0 } });
  try {
    await x.save(x.scores());
    await assert.rejects(x.runtime.end({...x.principal,accountId:"foreign-assessor"},x.request.interviewRequestId),{name:"InterviewRuntimeAccessError"});
    const original = (await x.database.query("SELECT source_context_json,questions_json FROM interview_question_sets WHERE question_set_id=$1",[x.set.questionSetId])).rows[0];
    for (const tampered of [
      {...original.source_context_json,selectedTemplateIds:["forged"]},
      {...original.source_context_json,policyVersionId:"foreign-version"}
    ]) {
      await x.database.query("UPDATE interview_question_sets SET source_context_json=$2::jsonb WHERE question_set_id=$1",[x.set.questionSetId,JSON.stringify(tampered)]);
      await assert.rejects(x.runtime.end(x.principal,x.request.interviewRequestId),/question|policy/i);
      assert.equal((await x.runtime.view(x.principal,x.request.interviewRequestId)).status,"ACTIVE");
    }
    await x.database.query("UPDATE interview_question_sets SET source_context_json=$2::jsonb,questions_json=$3::jsonb WHERE question_set_id=$1",[x.set.questionSetId,JSON.stringify(original.source_context_json),JSON.stringify(original.questions_json.map((q,i)=>i===0?{...q,prompt:"Tampered prompt is not the approved policy template."}:q))]);
    await assert.rejects(x.runtime.end(x.principal,x.request.interviewRequestId),/question|template/i);
    await x.database.query("UPDATE interview_question_sets SET questions_json=$2::jsonb WHERE question_set_id=$1",[x.set.questionSetId,JSON.stringify(original.questions_json)]);
    await x.database.query("UPDATE assurance_cases SET interview_reference=$2 WHERE case_id=$1",[x.request.caseId,x.fixture.requests.Alpha.interviewRequestId]);
    await assert.rejects(x.runtime.end(x.principal,x.request.interviewRequestId),/current/i);
    await assert.rejects(actions(x).saveInterviewConsoleAction(scoreForm(x)),error=>error.location?.includes("consoleError=closed"));
    assert.equal((await x.runtime.view(x.principal,x.request.interviewRequestId)).status,"ACTIVE");
  } finally { await x.cleanup(); }
});

test("Configured original request carries pinned context at the insertion boundary", async () => {
  const x = await policyInterview();
  try {
    await x.database.exec(`
      CREATE TABLE interview_policy_insert_observations (
        request_id TEXT, trade_scope TEXT, qualification_scope TEXT, risk_level TEXT,
        jurisdiction TEXT, recording_policy TEXT, recording_retention_days INTEGER
      );
      CREATE FUNCTION observe_interview_policy_insert() RETURNS trigger AS $$
      BEGIN
        INSERT INTO interview_policy_insert_observations VALUES (
          NEW.interview_request_id,NEW.trade_scope,NEW.qualification_scope,NEW.risk_level,
          NEW.jurisdiction,NEW.recording_policy,NEW.recording_retention_days
        );
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER interview_policy_insert_observer AFTER INSERT ON interview_requests
      FOR EACH ROW EXECUTE FUNCTION observe_interview_policy_insert();
    `);
    const created = await x.scheduling.requestAdditionalInterview({
      tenantId: x.fixture.credentials.company.tenantId, caseId: x.request.caseId,
      workerAccountId: x.request.workerAccountId, requestedAt: new Date().toISOString()
    });
    const observed = (await x.database.query(
      "SELECT trade_scope,qualification_scope,risk_level,jurisdiction,recording_policy,recording_retention_days FROM interview_policy_insert_observations WHERE request_id=$1",
      [created.interviewRequestId]
    )).rows[0];
    assert.deepEqual(observed, {
      trade_scope: "electrical", qualification_scope: "level-3", risk_level: "HIGH",
      jurisdiction: "GB", recording_policy: "NOTES_ONLY", recording_retention_days: 45
    });
  } finally { await x.cleanup(); }
});

test("Configured draft action rejects a nonexistent runtime session without saving", async () => {
  const x = await policyInterview();
  try {
    const form = scoreForm(x);
    form.set("interviewSessionId", "not-the-runtime-session");
    await assert.rejects(actions(x).saveInterviewConsoleAction(form), /session/i);
    assert.equal((await x.database.query(
      "SELECT count(*)::int AS count FROM interview_console_drafts WHERE interview_request_id=$1",
      [x.request.interviewRequestId]
    )).rows[0].count, 0);
    await actions(x).saveInterviewConsoleAction(scoreForm(x));
    assert.equal((await x.database.query(
      "SELECT interview_session_id FROM interview_console_drafts WHERE interview_request_id=$1",
      [x.request.interviewRequestId]
    )).rows[0].interview_session_id, x.session.interviewSessionId);
  } finally { await x.cleanup(); }
});

test("Published risk and jurisdiction recording rule reaches request and actual consent readiness", async () => {
  const policy = {
    ...configuredPolicy(),
    recordingRules: [
      { policy: "PROHIBITED", retentionDays: 10, consentRequired: false,
        selectors: { jurisdictions: ["US"] } },
      { policy: "AUDIO_ONLY", retentionDays: 60, consentRequired: true,
        selectors: { riskLevels: ["HIGH"], jurisdictions: ["GB"] } }
    ]
  };
  const x = await policyInterview({ policy, start: false });
  try {
    const request = (await x.database.query(
      "SELECT recording_policy,recording_retention_days,recording_consent_required FROM interview_requests WHERE interview_request_id=$1",
      [x.request.interviewRequestId]
    )).rows[0];
    assert.deepEqual(request, { recording_policy: "AUDIO_ONLY", recording_retention_days: 60, recording_consent_required: true });
    const worker = { accountId: x.request.workerAccountId, activeRole: "worker", accountStatus: "active", tenantMembership: null };
    const readiness = { cameraReady: true, microphoneReady: true, connectionReady: true, identityConfirmed: true, recordingConsent: false };
    await assert.rejects(x.runtime.markWorkerReady(worker, x.request.interviewRequestId, readiness, x.now), /consent/i);
    await x.runtime.markWorkerReady(worker, x.request.interviewRequestId, { ...readiness, recordingConsent: true }, x.now);
    await x.runtime.admit(x.principal, x.request.interviewRequestId, x.now);
    assert.equal((await x.runtime.start(x.principal, x.request.interviewRequestId, x.now)).status, "ACTIVE");
    assert.equal(x.set.sourceContext.policySnapshotId, x.snapshot.snapshotId);
  } finally { await x.cleanup(); }
});

test("Legacy draft action denies a nonexistent ID while an actual runtime exists", async () => {
  const x = await policyInterview({ policy: null });
  try {
    const form = scoreForm(x);
    form.set("interviewSessionId", "nonexistent-legacy-session");
    await assert.rejects(actions(x).saveInterviewConsoleAction(form), /session/i);
    assert.equal((await x.database.query(
      "SELECT count(*)::int AS count FROM interview_console_drafts WHERE interview_request_id=$1",
      [x.request.interviewRequestId]
    )).rows[0].count, 0);
    await actions(x).saveInterviewConsoleAction(scoreForm(x));
    assert.equal((await x.database.query(
      "SELECT interview_session_id FROM interview_console_drafts WHERE interview_request_id=$1",
      [x.request.interviewRequestId]
    )).rows[0].interview_session_id, x.session.interviewSessionId);
  } finally { await x.cleanup(); }
});

test("Legacy final submission denies a nonexistent ID despite an ended real runtime", async () => {
  const x = await policyInterview({ policy: null });
  try {
    await actions(x).saveInterviewConsoleAction(scoreForm(x));
    await x.runtime.end(x.principal, x.request.interviewRequestId);
    const form = scoreForm(x);
    form.set("interviewSessionId", "nonexistent-legacy-session");
    await assert.rejects(actions(x).submitInterviewConsoleAction(form), /session/i);
    assert.equal((await x.database.query(
      "SELECT submitted FROM interview_console_drafts WHERE interview_request_id=$1",
      [x.request.interviewRequestId]
    )).rows[0].submitted, false);
    assert.equal((await x.database.query(
      "SELECT case_status FROM assurance_cases WHERE case_id=$1",
      [x.request.caseId]
    )).rows[0].case_status, "Interview pending");
    await actions(x).submitInterviewConsoleAction(scoreForm(x));
    assert.equal((await x.database.query(
      "SELECT submitted FROM interview_console_drafts WHERE interview_request_id=$1",
      [x.request.interviewRequestId]
    )).rows[0].submitted, true);
  } finally { await x.cleanup(); }
});

test("Legacy pre-claim draft remains valid without a runtime", async () => {
  const x = await policyInterview({ policy: null, start: false, claim: false });
  try {
    await actions(x).saveInterviewConsoleAction(scoreForm(x));
    assert.equal((await x.database.query(
      "SELECT interview_session_id FROM interview_console_drafts WHERE interview_request_id=$1",
      [x.request.interviewRequestId]
    )).rows[0].interview_session_id, x.session.interviewSessionId);
    assert.equal((await x.database.query(
      "SELECT count(*)::int AS count FROM interview_runtime_sessions WHERE interview_request_id=$1",
      [x.request.interviewRequestId]
    )).rows[0].count, 0);
  } finally { await x.cleanup(); }
});
