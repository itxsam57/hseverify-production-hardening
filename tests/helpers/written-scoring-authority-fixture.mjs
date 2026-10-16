import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "./migration-ceiling.mjs";
import {loadWorkerRegistrationTs} from "./worker-registration-runtime-loader.mjs";
import {seedWorkerPrincipal,seedInProgressAttempt,stableId,ATTEMPT_NOW} from "./assessment-attempt-fixture.mjs";
const {WrittenScoringService}=loadWorkerRegistrationTs("src/lib/scoring/written-scoring-service.ts");
const env={appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:"memory://",releaseSha:"written-live-authority",sessionSecret:"test-session-secret-2026-000000000000000",authPepper:"test-auth-pepper-2026-000000000000000",authSandboxEnabled:false,demoAuthEnabled:false,demoDataEnabled:false};
async function fixture(seed){
 const db=await openScriptDatabase(env);await applyMigrationsThrough(db,env.releaseSha,"0113_written_scoring_final_history");
 const worker=await seedWorkerPrincipal(db,"worker-"+seed);const reviewer=await seedWorkerPrincipal(db,"reviewer-"+seed);
 await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'verifier')",[reviewer.accountId]);
 await db.query("UPDATE auth_sessions SET active_role='verifier' WHERE session_id=$1",[reviewer.sessionId]);
 const actor={...reviewer,activeRole:"verifier"};
 const f=await seedInProgressAttempt(db,worker,seed,[{questionType:"LONG_TEXT",rubric:{maxScore:10,criteria:[{description:"Isolation",points:6},{description:"Zero energy test",points:4}]}}]);
 await db.query("UPDATE assessment_attempts SET status='SUBMITTED',submitted_at=$2 WHERE attempt_id=$1",[f.attemptId,ATTEMPT_NOW]);
 await db.query("UPDATE assurance_cases SET case_status='Review pending',owner_kind='reviewer' WHERE case_id=$1",[f.caseId]);
 const framework=(await db.query("SELECT framework_id FROM assessment_blueprint_versions WHERE blueprint_version_id=$1",[f.blueprintVersionId])).rows[0].framework_id;
 await db.query(`INSERT INTO assurance_case_policy_snapshots(snapshot_id,case_id,tenant_id,framework_id,policy_id,global_policy_version_id,policy_source,effective_value_json,reference_time) VALUES($1,$2,$3,$4,$5,$6,'GLOBAL','{"pass_mark":80}'::jsonb,$7)`,[stableId("policy_snapshot",seed),f.caseId,f.tenantId,framework,stableId("policy",seed),stableId("policy_version",seed),ATTEMPT_NOW]);
 await db.query(`INSERT INTO staff_calibrations(calibration_id,account_id,role,framework_reference,status,valid_from,valid_until,note,recorded_by_account_id,framework_id,framework_version_id) SELECT $1,$2,'verifier',framework_reference,'CURRENT',$3,'2099-01-01','Actual fixture calibration',$2,framework_id,framework_version_id FROM assurance_framework_revisions WHERE framework_id=$4`,[stableId("staff_calibration",seed),actor.accountId,ATTEMPT_NOW,framework]);
 const reviewId=stableId("written_score",seed);
 await db.query(`INSERT INTO written_score_reviews(review_id,tenant_id,case_id,attempt_id,reviewer_account_id,rubric_version,score,decision,reason,status) VALUES($1,$2,$3,$4,$5,$6,NULL,NULL,'Awaiting human review','DRAFT')`,[reviewId,f.tenantId,f.caseId,f.attemptId,actor.accountId,f.blueprintVersionId]);
 return {db,actor,reviewId,...f,service:new WrittenScoringService(db,actor)};
}
export {fixture};
