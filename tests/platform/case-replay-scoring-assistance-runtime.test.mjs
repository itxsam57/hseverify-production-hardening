import assert from "node:assert/strict";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import {
  ATTEMPT_NOW,
  seedInProgressAttempt,
  seedWorkerPrincipal,
  stableId
} from "../helpers/assessment-attempt-fixture.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

const { WrittenScoringAssistanceService } = loadTs(
  "src/lib/scoring/written-scoring-assistance-service.ts"
);
const { CaseReplayService } = loadTs("src/lib/audit/case-replay-service.ts");

const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "case-replay-scoring-assistance-runtime",
  sessionSecret: "case-replay-scoring-assistance-session-secret-more-than-32",
  authPepper: "case-replay-scoring-assistance-auth-pepper-more-than-32",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

async function database() {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(
    db,
    ENV.releaseSha,
    "0073_assessment_option_order_snapshot"
  );
  return db;
}

async function seedStaff(db, accountId, role) {
  await db.query(
    `INSERT INTO auth_accounts(
       account_id,email_normalized,display_name,account_status,password_hash,
       email_verified_at,password_set_at,created_at,updated_at
     ) VALUES($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [
      accountId,
      accountId + "@example.test",
      role + " replay fixture",
      "scrypt$16384$8$1$salt$hash",
      ATTEMPT_NOW
    ]
  );
  await db.query(
    "INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)",
    [accountId, role, ATTEMPT_NOW]
  );
}

test("sandbox scoring guidance stays advisory and Case Replay reconstructs the same submitted case", async () => {
  const previousMode = process.env.HSE_SCORING_AI_MODE;
  process.env.HSE_SCORING_AI_MODE = "sandbox";
  const db = await database();
  try {
    const worker = await seedWorkerPrincipal(db, "replay-written-worker");
    const reviewer = "account_replay_verifier_01";
    const admin = "account_replay_admin_0001";
    await seedStaff(db, reviewer, "verifier");
    await seedStaff(db, admin, "admin");

    const fixture = await seedInProgressAttempt(
      db,
      worker,
      "replay-written-case",
      [{
        questionType: "LONG_TEXT",
        prompt: "Explain how you would isolate an unsafe energy source before maintenance work begins.",
        rubric: {
          maxScore: 10,
          criteria: [
            { description: "Identifies isolation and lockout", points: 5 },
            { description: "Confirms zero-energy verification", points: 5 }
          ]
        }
      }]
    );
    const item = fixture.items[0];
    const answerId = stableId("assessment_answer", "replay-written-answer");
    await db.query(
      `INSERT INTO assessment_attempt_answers(
         answer_id,attempt_id,form_id,form_item_id,position,question_id,question_version_id,
         question_type,text_value,boolean_value,numeric_value,committed_at
       ) VALUES($1,$2,$3,$4,1,$5,$6,'LONG_TEXT',$7,NULL,NULL,$8)`,
      [
        answerId,
        fixture.attemptId,
        fixture.formId,
        item.formItemId,
        item.questionId,
        item.questionVersionId,
        "I would stop the task, identify every energy source, isolate and lock out the equipment, then verify zero energy before maintenance starts.",
        ATTEMPT_NOW
      ]
    );
    await db.query(
      `UPDATE assessment_attempts
          SET status='SUBMITTED',current_position=question_count,submitted_at=$2,updated_at=$2
        WHERE attempt_id=$1`,
      [fixture.attemptId, ATTEMPT_NOW]
    );

    const reviewId = stableId("written_score", "replay-written-review");
    await db.query(
      `INSERT INTO written_score_reviews(
         review_id,tenant_id,case_id,attempt_id,reviewer_account_id,rubric_version,
         score,decision,reason,status,created_at
       ) VALUES($1,$2,$3,$4,$5,'rubric-v1',NULL,NULL,'Awaiting human review.','DRAFT',$6)`,
      [
        reviewId,
        fixture.tenantId,
        fixture.caseId,
        fixture.attemptId,
        reviewer,
        ATTEMPT_NOW
      ]
    );

    const assistanceService = new WrittenScoringAssistanceService(Promise.resolve(db));
    const suggestion = await assistanceService.generate({
      reviewId,
      reviewerAccountId: reviewer,
      now: new Date("2026-10-01T01:00:00.000Z")
    });
    assert.equal(suggestion.providerKey, "sandbox");
    assert.equal(suggestion.suggestion.testingOnly, true);
    assert.equal(suggestion.status, "GENERATED");
    assert.equal(suggestion.suggestion.criteria.length, 2);

    const unchangedReview = await db.query(
      "SELECT score,decision,status FROM written_score_reviews WHERE review_id=$1",
      [reviewId]
    );
    assert.equal(unchangedReview.rows[0].score, null);
    assert.equal(unchangedReview.rows[0].decision, null);
    assert.equal(unchangedReview.rows[0].status, "DRAFT");

    const accepted = await assistanceService.reviewGuidance({
      assistanceId: suggestion.assistanceId,
      reviewerAccountId: reviewer,
      decision: "ACCEPTED_AS_GUIDANCE",
      reason: "Useful prompt, but the human rubric review remains authoritative.",
      now: new Date("2026-10-01T01:05:00.000Z")
    });
    assert.equal(accepted.status, "ACCEPTED_AS_GUIDANCE");

    const events = await db.query(
      "SELECT event_type FROM written_scoring_assistance_events WHERE assistance_id=$1 ORDER BY event_version",
      [suggestion.assistanceId]
    );
    assert.deepEqual(
      events.rows.map((row) => row.event_type),
      ["GENERATED", "ACCEPTED_AS_GUIDANCE"]
    );
    await assert.rejects(
      db.query(
        "UPDATE written_scoring_assistance_events SET reason='tampered' WHERE assistance_id=$1",
        [suggestion.assistanceId]
      ),
      /append-only/i
    );

    const replay = await new CaseReplayService(Promise.resolve(db)).replay(
      {
        accountId: admin,
        sessionId: "session_replay_admin_not_required",
        activeRole: "admin",
        accountStatus: "active",
        email: "replay-admin@example.test",
        displayName: "Replay Admin",
        createdAt: ATTEMPT_NOW,
        lastSeenAt: ATTEMPT_NOW,
        expiresAt: "2099-01-01T00:00:00.000Z",
        tenantMembership: null
      },
      fixture.caseId,
      "Audit the exact assessment and scoring history for an appeal.",
      new Date("2026-10-01T02:00:00.000Z")
    );
    assert.equal(replay.sections.case.length, 1);
    assert.equal(replay.sections.assessmentQuestions.length, 1);
    assert.equal(replay.sections.assessmentAnswers.length, 1);
    assert.equal(replay.sections.scoringReviews.length, 1);
    assert.equal(replay.sections.scoringAssistance.length, 1);
    assert.equal(replay.sections.assessmentAnswers[0].text_value.includes("zero energy"), true);

    const replayAudit = await db.query(
      "SELECT actor_account_id,actor_role,purpose FROM case_replay_access_events WHERE case_id=$1",
      [fixture.caseId]
    );
    assert.equal(replayAudit.rows.length, 1);
    assert.equal(replayAudit.rows[0].actor_account_id, admin);
    assert.equal(replayAudit.rows[0].actor_role, "admin");
    await assert.rejects(
      db.query(
        "DELETE FROM case_replay_access_events WHERE case_id=$1",
        [fixture.caseId]
      ),
      /append-only/i
    );

    await assert.rejects(
      new CaseReplayService(Promise.resolve(db)).replay(
        worker,
        fixture.caseId,
        "Worker should not have privileged Case Replay access."
      ),
      /denied/i
    );
  } finally {
    await db.close();
    if (previousMode === undefined) delete process.env.HSE_SCORING_AI_MODE;
    else process.env.HSE_SCORING_AI_MODE = previousMode;
  }
});


test("Pinned review evidence retains latest revisions, omitted written items and owner isolation",async()=>{
 const previousMode=process.env.HSE_SCORING_AI_MODE;process.env.HSE_SCORING_AI_MODE="sandbox";
 const db=await database();
 try {
  const worker=await seedWorkerPrincipal(db,"review-source-worker");const reviewer="account_review_source_verifier";
  await seedStaff(db,reviewer,"verifier");
  const rubric={maxScore:10,criteria:[{description:"Identify isolation",points:10}]};
  const fixture=await seedInProgressAttempt(db,worker,"review-source-case",[
    {questionType:"LONG_TEXT",prompt:"Pinned answered prompt",rubric},
    {questionType:"SHORT_TEXT",prompt:"Pinned unanswered prompt",rubric}
  ]);
  const item=fixture.items[0];const answerId=stableId("assessment_answer","review-source-answer");
  await db.query("INSERT INTO assessment_attempt_answers(answer_id,attempt_id,form_id,form_item_id,position,question_id,question_version_id,question_type,text_value,committed_at) VALUES($1,$2,$3,$4,1,$5,$6,'LONG_TEXT','Original retained response',$7)",[answerId,fixture.attemptId,fixture.formId,item.formItemId,item.questionId,item.questionVersionId,ATTEMPT_NOW]);
  await db.query("INSERT INTO assessment_answer_revisions(revision_id,attempt_id,answer_id,position,revision_no,text_value,revised_at) VALUES($1,$2,$3,1,1,'Latest retained response',$4)",[stableId("assessment_revision","review-source-revision"),fixture.attemptId,answerId,ATTEMPT_NOW]);
  await db.query("UPDATE assessment_attempts SET status='SUBMITTED',current_position=question_count,submitted_at=$2 WHERE attempt_id=$1",[fixture.attemptId,ATTEMPT_NOW]);
  const reviewId=stableId("written_score","review-source-review");
  await db.query("INSERT INTO written_score_reviews(review_id,tenant_id,case_id,attempt_id,reviewer_account_id,rubric_version,score,decision,reason,status) VALUES($1,$2,$3,$4,$5,'pinned',NULL,NULL,'Awaiting review','DRAFT')",[reviewId,fixture.tenantId,fixture.caseId,fixture.attemptId,reviewer]);
  const {loadAssignedReviewQuestions}=loadTs("src/lib/scoring/assessment-review-source.ts");
  const questions=(await loadAssignedReviewQuestions(db,reviewer,[reviewId])).get(reviewId);
  assert.equal(questions.length,2);assert.equal(questions[0].response,"Latest retained response");
  assert.deepEqual(questions[0].rubricCriteria,rubric.criteria);
  assert.equal(questions[1].answered,false);assert.equal(questions[1].response,null);
  assert.equal((await loadAssignedReviewQuestions(db,"foreign-reviewer",[reviewId])).size,0);
  const guidance=await new WrittenScoringAssistanceService(Promise.resolve(db)).generate({reviewId,reviewerAccountId:reviewer});
  assert.equal(guidance.suggestion.criteria.find(c=>c.questionPosition===2).suggestedPercent,0);
  assert.equal(guidance.suggestion.overallScoreSuggestion,23);
  const review=(await db.query("SELECT score,decision,status FROM written_score_reviews WHERE review_id=$1",[reviewId])).rows[0];
  assert.deepEqual(review,{score:null,decision:null,status:"DRAFT"});
 }finally{await db.close();if(previousMode===undefined)delete process.env.HSE_SCORING_AI_MODE;else process.env.HSE_SCORING_AI_MODE=previousMode;}
});
