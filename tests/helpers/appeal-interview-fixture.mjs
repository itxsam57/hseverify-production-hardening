import {readFileSync} from "node:fs";
import ts from "typescript";
import {integrityAssessmentFixture} from "./integrity-assessment-fixture.mjs";
import {seedWorkerPrincipal} from "./assessment-attempt-fixture.mjs";
import {assessorSchedulingPrincipal} from "./assessor-scheduling-native-principal.mjs";
import {loadWorkerRegistrationTs} from "./worker-registration-runtime-loader.mjs";
const load=path=>loadWorkerRegistrationTs("src/lib/"+path+".ts");
export const dimensions=["technicalKnowledge","practicalReasoning","safetyAwareness","communication","consistencyWithWrittenAnswers","confidenceClarity","tradeJudgment"];
export const scores=()=>({...Object.fromEntries(dimensions.map(key=>[key,3])),comments:"Independent appeal interview explanation supports the retained recommendation."});
export function actualInterviewActions(database,principal){
 const output=ts.transpileModule(readFileSync("src/app/assessor/(portal)/interviews/actions.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,record={exports:{}};
 const localRequire=request=>{if(request==="next/cache")return {revalidatePath(){}};if(request==="next/navigation")return {redirect(location){throw Object.assign(new Error("Action redirect"),{location});},notFound(){throw new Error("Action not found");}};if(request==="@/lib/authorization/authorization-service")return {requirePlatformPermission:async()=>principal};if(request==="@/lib/database/database")return {getDatabaseClient:async()=>database};if(request.startsWith("@/"))return loadWorkerRegistrationTs("src/"+request.slice(2)+".ts");throw new Error("Unexpected action dependency "+request);};
 new Function("exports","require","module",output)(record.exports,localRequire,record);return record.exports;
}
export function recommendationForm(requestId,sessionId){const form=new FormData();form.set("interviewRequestId",requestId);form.set("interviewSessionId",sessionId);for(const dimension of dimensions)form.set(dimension,"3");form.set("comments",scores().comments);form.set("recommendation","PASS");return form;}
export async function appealInterviewFixture(){
 const f=await integrityAssessmentFixture();try{
 const db=f.database;await f.attempts.submitCurrentAnswer(f.worker,{attemptId:f.attemptId,position:1,answer:"Stop and assess"},new Date(),null);
 const review=(await db.query("SELECT review_id,reviewer_account_id,status FROM written_score_reviews WHERE attempt_id=$1",[f.attemptId])).rows[0];
 if(review?.status==="DRAFT"){
  const {AuthAccessRepository}=load("auth/auth-access-repository"),sessionId="appeal-original-review-session",now=new Date().toISOString();
  await new AuthAccessRepository(db).authentication.insertSession({sessionId,accountId:review.reviewer_account_id,activeRole:"verifier",tokenHash:sessionId.padEnd(64,"0"),csrfTokenHash:sessionId.padEnd(64,"1"),userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:"2099-01-01T00:00:00Z"});
  const actor={accountId:review.reviewer_account_id,sessionId,activeRole:"verifier",accountStatus:"active",tenantMembership:null};const {WrittenScoringService}=load("scoring/written-scoring-service");await new WrittenScoringService(db,actor).finalizeAndAdvance({reviewId:review.review_id,reviewerAccountId:actor.accountId});
 }
 const second=await seedWorkerPrincipal(db,"appeal-independent-admin");await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'admin')",[second.accountId]);await db.query("UPDATE auth_sessions SET active_role='admin' WHERE session_id=$1",[second.sessionId]);const admin={...second,activeRole:"admin"};
 const assessor=await assessorSchedulingPrincipal(db,f.credentials.assessor);
 const revision=(await db.query("SELECT revisions.* FROM assurance_case_policy_snapshots snapshots JOIN assurance_framework_revisions revisions USING(framework_id) WHERE snapshots.case_id=$1 ORDER BY revisions.version_no DESC LIMIT 1",[f.sourceCase.case_id])).rows[0];
 const {StaffCalibrationService}=load("review/staff-calibration-service");await new StaffCalibrationService(Promise.resolve(db)).record(admin,{accountId:assessor.accountId,role:"assessor",frameworkReference:revision.framework_reference,frameworkVersionId:revision.framework_version_id,status:"CURRENT",validFrom:new Date(revision.effective_from),validUntil:new Date("2099-01-01"),note:"Independent benchmark for the pinned interview framework."});
 const {InterviewSchedulingService}=load("interview/interview-scheduling-service"),{InterviewAssignmentService}=load("interview/interview-assignment-service"),{InterviewRuntimeService}=load("interview/interview-runtime-service"),{InterviewPlaybookService}=load("interview/interview-playbook-service");
 await new InterviewAssignmentService(db).upsertProfile(admin,{assessorAccountId:assessor.accountId,tradeScopes:["*"],qualificationScopes:["*"],languages:["*"],jurisdictions:["*"],riskLevels:["*"],availability:{},maxActiveInterviews:5,status:"ACTIVE"});
 const scheduling=new InterviewSchedulingService(db);let originalRequest=await scheduling.requestInterview({tenantId:f.sourceCase.tenant_id,caseId:f.sourceCase.case_id,workerAccountId:f.worker.accountId,requestedAt:new Date().toISOString()});
 if(!originalRequest)throw new Error("Original assessment must produce its interview");
 if(!originalRequest.assessorAccountId){const assignment=await new InterviewAssignmentService(db).evaluateAndPersist(originalRequest.interviewRequestId,new Date());if(assignment.selectedAssessorAccountId!==assessor.accountId)throw new Error("Original fixture assessor matching did not select the calibrated assessor");originalRequest=await scheduling.assignInterview({tenantId:f.sourceCase.tenant_id,request:originalRequest,assessorAccountId:assessor.accountId});}
 originalRequest=await scheduling.scheduleInterview({principal:assessor,tenantId:f.sourceCase.tenant_id,request:originalRequest,scheduledAt:new Date().toISOString()});
 const runtime=new InterviewRuntimeService(Promise.resolve(db)),session=await runtime.claim(assessor,originalRequest.interviewRequestId);await new InterviewPlaybookService(Promise.resolve(db)).ensure(assessor,originalRequest.interviewRequestId);await runtime.markWorkerReady(f.worker,originalRequest.interviewRequestId,{cameraReady:true,microphoneReady:true,connectionReady:true,identityConfirmed:true,recordingConsent:false});await runtime.admit(assessor,originalRequest.interviewRequestId);await runtime.start(assessor,originalRequest.interviewRequestId);
 await scheduling.saveConsoleState({tenantId:f.sourceCase.tenant_id,interviewSessionId:session.interviewSessionId,interviewRequestId:originalRequest.interviewRequestId,notes:[],scorecard:scores(),recommendation:null,submitted:false,updatedAt:new Date().toISOString()});await runtime.end(assessor,originalRequest.interviewRequestId);await actualInterviewActions(db,assessor).submitInterviewConsoleAction(recommendationForm(originalRequest.interviewRequestId,session.interviewSessionId));
 const {DecisionRepository}=load("decision/decision-engine-repository"),{createDecision}=load("decision/decision-engine-domain");
 const key="appeal-interview-signing-secret-more-than-thirty-two";const decision=createDecision({tenantId:f.sourceCase.tenant_id,caseId:f.sourceCase.case_id,state:"APPROVED",reasonCode:"assessment_passed",explanation:"Completed assessment and interview permit the original credential decision.",ruleVersion:"appeal-interview-v1",inputReferences:[f.attemptId],createdAt:new Date().toISOString()});await new DecisionRepository(Promise.resolve(db),key).saveDecisionAndProgressCase(decision,f.credentials.admin.accountId);
 const row=(await db.query("SELECT * FROM assurance_cases WHERE case_id=$1",[f.sourceCase.case_id])).rows[0];
 const {CredentialAppealsService}=load("credential/credential-appeals-service"),appeals=new CredentialAppealsService(Promise.resolve(db),key);const appeal=await appeals.submit({credentialId:row.credential_reference,workerId:row.permanent_worker_id,reason:"Please independently reconsider the original competency evidence and interview me.",createdAt:new Date().toISOString()},"independent-interview");
 const {CredentialAppealFollowupService}=load("credential/credential-appeal-followup-service");const followups=new CredentialAppealFollowupService(Promise.resolve(db));
 return {...f,row,key,admin,assessor,appeal,appeals,followups};
 }catch(error){await f.cleanup();throw error;}
}
