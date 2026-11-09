import assert from "node:assert/strict";
import test from "node:test";
import {fixture} from "../helpers/written-scoring-authority-fixture.mjs";
import {stableId} from "../helpers/assessment-attempt-fixture.mjs";

for(const scenario of ["revoked","expired","disabled","demoted","source_replaced","failed_calibration"]){
 test("Actual written scoring denies "+scenario+" without writes",async()=>{const f=await fixture(scenario);try{
 if(scenario==="revoked")await f.db.query("UPDATE auth_sessions SET revoked_at=clock_timestamp(),revocation_reason='test' WHERE session_id=$1",[f.actor.sessionId]);
 if(scenario==="expired")await f.db.query("UPDATE auth_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE session_id=$1",[f.actor.sessionId]);
 if(scenario==="disabled")await f.db.query("UPDATE auth_accounts SET account_status='disabled' WHERE account_id=$1",[f.actor.accountId]);
 if(scenario==="demoted")await f.db.query("DELETE FROM auth_account_roles WHERE account_id=$1 AND role='verifier'",[f.actor.accountId]);
 if(scenario==="source_replaced")await f.db.query("UPDATE assurance_cases SET assessment_reference=NULL WHERE case_id=$1",[f.caseId]);
 if(scenario==="failed_calibration")await f.db.query(`INSERT INTO staff_calibrations(calibration_id,account_id,role,framework_reference,status,valid_from,valid_until,note,recorded_by_account_id,framework_id,framework_version_id) SELECT $1,account_id,role,framework_reference,'FAILED',clock_timestamp()-interval '1 second',valid_until,'Calibration failed now',recorded_by_account_id,framework_id,framework_version_id FROM staff_calibrations WHERE account_id=$2`,[stableId("staff_calibration","failed-"+scenario),f.actor.accountId]);
 await assert.rejects(f.service.saveDraftDecision({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,tenantId:f.tenantId,score:99,decision:"PASS",reason:"Caller supplied score should never bypass actual authority"}),/session|actor|source|calibration|scope|unavailable/i);
 const row=(await f.db.query("SELECT score,decision FROM written_score_reviews WHERE review_id=$1",[f.reviewId])).rows[0];assert.equal(row.score,null);assert.equal(row.decision,null);
 }finally{await f.db.close();}});
}

test("Exact pinned revision cannot fall back to older calibrated revision",async()=>{const f=await fixture("revision-drift");try{
const fw=(await f.db.query("SELECT framework_id FROM assessment_blueprint_versions WHERE blueprint_version_id=$1",[f.blueprintVersionId])).rows[0].framework_id;
await f.db.query(`INSERT INTO assurance_framework_revisions(framework_version_id,framework_id,version_no,framework_reference,title,effective_from,recorded_by_account_id) SELECT $1,framework_id,2,framework_reference,title,effective_from,$2 FROM assurance_framework_revisions WHERE framework_id=$3`,[stableId("framework_revision","revision2"),f.actor.accountId,fw]);
await assert.rejects(f.service.saveDraftDecision({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,score:99,decision:"PASS",reason:"Must use exact latest revision and not historical calibration"}),/calibration/);
}finally{await f.db.close();}});

test("Caller total cannot replace required pinned criterion marks",async()=>{const f=await fixture("missing-criteria");try{
await assert.rejects(f.service.saveDraftDecision({reviewId:f.reviewId,reviewerAccountId:f.actor.accountId,score:100,decision:"PASS",reason:"Caller total has no criterion evidence backing it"}),/criterion|rubric/);
const row=(await f.db.query("SELECT score,decision FROM written_score_reviews WHERE review_id=$1",[f.reviewId])).rows[0];assert.equal(row.score,null);
}finally{await f.db.close();}});
