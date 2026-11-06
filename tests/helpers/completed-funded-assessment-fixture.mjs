
import { createHash } from "node:crypto";
import { loadWorkerRegistrationTs } from "./worker-registration-runtime-loader.mjs";

const digest=(value)=>createHash("sha256").update(value).digest("hex");
const id=(prefix,seed)=>prefix+"_"+digest(prefix+":"+seed).slice(0,24);

/**
 * Completes the already-funded case's one pinned published MCQ through the
 * actual objective scoring/progression producer. This is a controlled test
 * fixture; it never changes production evidence or skips a required exam.
 */
export async function completeFundedCaseObjectiveAssessment(database,caseId,now=new Date(),submissionStatus="SUBMITTED") {
  if(!["SUBMITTED","AUTO_SUBMITTED"].includes(submissionStatus))throw new Error("Invalid synthetic submission status.");
  const caseRow=(await database.query(
    `SELECT cases.worker_account_id,application.catalogue_version_id,
            catalogue.blueprint_version_id,catalogue.framework_id
       FROM assurance_cases cases
       JOIN worker_assessment_applications application ON application.assurance_case_id=cases.case_id
       JOIN assessment_catalogue_versions catalogue ON catalogue.catalogue_version_id=application.catalogue_version_id
      WHERE cases.case_id=$1`,[caseId]
  )).rows[0];
  if(!caseRow) throw new Error("Completed fixture requires a funded Worker assessment case.");
  const question=(await database.query(
    `SELECT questions.question_id,versions.question_version_id,
            versions.question_type,versions.answer_key_json
       FROM assessment_questions questions
       JOIN assessment_question_versions versions
         ON versions.question_id=questions.question_id
        AND versions.question_version_id=questions.current_version_id
      WHERE versions.framework_id=$1 AND questions.question_status='ACTIVE'
        AND versions.question_type='MULTIPLE_CHOICE'
        AND NOT EXISTS (SELECT 1 FROM generated_assessment_form_items prior WHERE prior.worker_account_id=$2 AND prior.exposure_family_reference=questions.exposure_family_reference)
      ORDER BY questions.question_id LIMIT 1`,[caseRow.framework_id,caseRow.worker_account_id]
  )).rows[0];
  if(!question || typeof question.answer_key_json!=="string")throw new Error("Published pinned MCQ answer source is unavailable.");
  const when=now.toISOString(),formId=id("assessment_form",caseId),itemId=id("assessment_form_item",caseId),
    attemptId=id("assessment_attempt",caseId);
  await database.transaction(async (tx) => {
  await tx.query(
    `INSERT INTO generated_assessment_forms(
       form_id,case_id,worker_account_id,blueprint_version_id,generation_nonce_hex,question_count,generated_at)
       VALUES($1,$2,$3,$4,$5,1,$6)`,
    [formId,caseId,caseRow.worker_account_id,caseRow.blueprint_version_id,digest("nonce:"+caseId),when]
  );
  await tx.query(
    `INSERT INTO generated_assessment_form_items(
       form_item_id,form_id,position,question_id,question_version_id,created_at)
       VALUES($1,$2,1,$3,$4,$5)`,
    [itemId,formId,question.question_id,question.question_version_id,when]
  );
  await tx.query(
    `INSERT INTO assessment_attempts(
       attempt_id,case_id,worker_account_id,catalogue_version_id,blueprint_version_id,form_id,
       status,current_position,question_count,started_at,submitted_at,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$8,1,1,$7,$7,$7,$7)`,
    [attemptId,caseId,caseRow.worker_account_id,caseRow.catalogue_version_id,caseRow.blueprint_version_id,formId,when,submissionStatus]
  );
  await tx.query(
    `INSERT INTO assessment_attempt_answers(
       answer_id,attempt_id,form_id,form_item_id,position,question_id,question_version_id,
       question_type,text_value,committed_at)
       VALUES($1,$2,$3,$4,1,$5,$6,'MULTIPLE_CHOICE',$7,$8)`,
    [id("assessment_answer",caseId),attemptId,formId,itemId,question.question_id,question.question_version_id,question.answer_key_json,when]
  );
  await tx.query(
    "UPDATE assurance_cases SET case_status='Assessment in progress',owner_kind='worker',next_action='Submit the objective assessment.',assessment_reference=$2 WHERE case_id=$1",
    [caseId,attemptId]
  );
  });
  const { completeSubmittedAssessment }=loadWorkerRegistrationTs(
    "src/lib/assessment-attempt/assessment-submission-progression-service.ts"
  );
  await completeSubmittedAssessment(database,{
    caseId,attemptId,blueprintVersionId:caseRow.blueprint_version_id,
    actor:{accountId:caseRow.worker_account_id,role:"worker"},now
  });
  const result=(await database.query("SELECT tenant_id,case_status,interview_reference FROM assurance_cases WHERE case_id=$1",[caseId])).rows[0];
  if(result?.case_status==="Interview pending"){
    // Credential-replacement native fixtures test signed lineage, not the
    // interview console. Supply only its explicitly declared completed stage
    // here; full assessor/Worker interview tests run independently.
    const requestId=result.interview_reference;
    if(!requestId)throw new Error("Required fixture interview was not requested.");
    await database.query("UPDATE interview_requests SET status='COMPLETED' WHERE interview_request_id=$1 AND tenant_id=$2",[requestId,result.tenant_id]);
    await database.query(
      "INSERT INTO interview_console_drafts(tenant_id,interview_session_id,interview_request_id,recommendation,submitted,scorecard,updated_at) VALUES($1,$2,$3,'PASS',TRUE,$4::jsonb,$5)",
      [result.tenant_id,"fixture_session_"+digest(caseId).slice(0,24),requestId,
        JSON.stringify({technicalKnowledge:5,practicalReasoning:5,safetyAwareness:5,communication:5,consistencyWithWrittenAnswers:5,confidenceClarity:5,tradeJudgment:5,comments:"Synthetic signed-credential replacement native test prerequisite."}),when]
    );
    const {advanceAfterInterviewRecommendation}=loadWorkerRegistrationTs("src/lib/assurance/assurance-case-progression-service.ts");
    await advanceAfterInterviewRecommendation(database,{caseId,tenantId:result.tenant_id,recommendation:"PASS",actor:{accountId:"assessor_fixture",role:"assessor"},now});
  }
  const final=(await database.query("SELECT case_status FROM assurance_cases WHERE case_id=$1",[caseId])).rows[0];
  if(final?.case_status!=="Decision pending") { const reviews=(await database.query("SELECT status,score,decision FROM written_score_reviews WHERE attempt_id=$1",[attemptId])).rows; throw new Error("Scored objective assessment did not reach Decision pending: "+JSON.stringify({status:final?.case_status,reviews})); }
  return attemptId;
}
