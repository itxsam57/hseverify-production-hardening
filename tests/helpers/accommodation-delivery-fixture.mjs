import { createHash } from "node:crypto";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { assessorInterviewSearchFixture } from "./assessor-interview-search-fixture.mjs";
import { seedInProgressAttempt } from "./assessment-attempt-fixture.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

export const accommodationId = (prefix, seed) => prefix+"_"+createHash("sha256").update(seed).digest("hex").slice(0,24);
export async function accommodationPrincipal(db, accountId, role, seed) {
 const now=new Date().toISOString(),sessionId="accommodation_session_"+seed;
 const account=(await db.query("SELECT email_normalized,display_name FROM auth_accounts WHERE account_id=$1",[accountId])).rows[0];
 await db.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$6,'2099-01-01T00:00:00Z')",[sessionId,accountId,role,"token_"+seed,"csrf_"+seed,now]);
 return {accountId,sessionId,activeRole:role,accountStatus:"active",email:account.email_normalized,displayName:account.display_name,createdAt:now,lastSeenAt:now,expiresAt:"2099-01-01T00:00:00Z",tenantMembership:null};
}
export async function accommodationDeliveryFixture({seed="delivery",adjustment={timeMultiplier:1.5,extraBreakMinutes:2,captions:true,interpreter:true},separate=false}={}) {
 const fixture=await assessorInterviewSearchFixture(),db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR,appEnvironment:"test"});
 try{
  const worker=await accommodationPrincipal(db,fixture.credentials.worker.accountId,"worker",seed+"_worker");
  const admin=await accommodationPrincipal(db,fixture.credentials.admin.accountId,"admin",seed+"_admin");
  const assessor=await accommodationPrincipal(db,fixture.credentials.assessor.accountId,"assessor",seed+"_assessor");
  const foreign=await accommodationPrincipal(db,"search_foreign_worker","worker",seed+"_foreign");
  const seeded=await seedInProgressAttempt(db,worker,"accommodation_"+seed,[{questionType:"MULTIPLE_CHOICE"},{questionType:"MULTIPLE_CHOICE"}],{readyForBegin:true});
  const framework=(await db.query("SELECT framework_id FROM assessment_blueprint_versions WHERE blueprint_version_id=$1",[seeded.blueprintVersionId])).rows[0].framework_id;
  const now=new Date();
  await db.query("INSERT INTO assurance_case_policy_snapshots(snapshot_id,case_id,tenant_id,framework_id,policy_id,global_policy_version_id,tenant_override_id,policy_source,effective_value_json,reference_time,resolved_at,created_by_account_id) VALUES($1,$2,$3,$4,$5,$6,NULL,'GLOBAL','{}',$7,$7,NULL)",[accommodationId("policy_snapshot",seed),seeded.caseId,seeded.tenantId,framework,accommodationId("policy",seed),accommodationId("policy_version",seed),now.toISOString()]);
  const sections=separate?[{title:"First section",endPosition:1,durationSeconds:150},{title:"Second section",endPosition:2,durationSeconds:150}]:[];
  await db.query("INSERT INTO assessment_blueprint_delivery_settings(blueprint_version_id,progression_mode,section_config_json,require_camera,require_microphone,require_screen_share,record_camera,record_microphone,record_screen,recording_retention_days,integrity_failure_mode,require_fullscreen,require_environment_declaration,require_monitoring_consent,timing_config_json) VALUES($1,$2,$3::jsonb,FALSE,FALSE,FALSE,FALSE,FALSE,FALSE,30,'REVIEW',FALSE,FALSE,FALSE,$4::jsonb)",[seeded.blueprintVersionId,separate?"SECTION_REVIEW":"CONTROLLED_REVIEW",JSON.stringify(sections),JSON.stringify(separate?{mode:"SEPARATE"}:{mode:"COMBINED",durationSeconds:300})]);
  const {PrivacyOperationsService}=loadTs("src/lib/privacy/privacy-operations-service.ts"),{PrivacyOperationsRepository}=loadTs("src/lib/privacy/privacy-operations-repository.ts");
  const privacy=new PrivacyOperationsService(new PrivacyOperationsRepository(Promise.resolve(db)));
  const approve=async(caseId,id,values)=>{await privacy.accommodation({id,tenantId:null,workerId:worker.accountId,type:"Approved accessible delivery"});return privacy.reviewAccommodation({accommodationId:id,reviewerAccountId:admin.accountId,decision:"APPROVED",reason:"Approved accessible delivery without changing competency requirements.",caseId,adjustment:values,now});};
  await approve(seeded.caseId,"accommodation_"+seed,adjustment);
  const {AssessmentAttemptService}=loadTs("src/lib/assessment-attempt/assessment-attempt-service.ts");
  const service=new AssessmentAttemptService(db,requestTime=>requestTime);
  const begun=await service.begin(worker,{caseId:seeded.caseId,catalogueVersionId:seeded.catalogueVersionId},now);
  return {fixture,db,worker,admin,assessor,foreign,seeded,now,service,privacy,approve,begun,cleanup:async()=>{await db.close();await fixture.cleanup();}};
 }catch(error){await db.close();await fixture.cleanup();throw error;}
}
