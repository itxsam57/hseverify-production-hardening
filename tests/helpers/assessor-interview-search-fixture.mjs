import { createHash,randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { workerAssessmentSearchFixture } from "./worker-assessment-search-fixture.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";
const {InterviewSchedulingService}=loadTs("src/lib/interview/interview-scheduling-service.ts");
const id=(prefix,seed)=>prefix+"_"+createHash("sha256").update(seed).digest("hex").slice(0,24);

// Schema-valid case context, then actual request/assignment producers.
// This is search/navigation evidence, not order funding or assessor matching certification.
export async function assessorInterviewSearchFixture({evidenceChecks=[],identityChecks=[],credentialTarget=null,frameworkReferences=[],pinPolicies=true}={}){
 const fixture=await workerAssessmentSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const service=new InterviewSchedulingService(db),tenant=fixture.credentials.company.tenantId,now=new Date().toISOString(),requests={};
  const {AuthAccessRepository}=loadTs("src/lib/auth/auth-access-repository.ts"),{EffectivePolicyService,pinAssuranceCasePolicySnapshot}=loadTs("src/lib/policy/effective-policy-service.ts");
  const sessionId="search-admin-"+randomUUID();await new AuthAccessRepository(db).authentication.insertSession({sessionId,accountId:fixture.credentials.admin.accountId,activeRole:"admin",tokenHash:createHash("sha256").update(sessionId).digest("hex"),csrfTokenHash:createHash("sha256").update("csrf:"+sessionId).digest("hex"),userAgentHash:null,ipAddressHash:null,createdAt:now,lastSeenAt:now,expiresAt:new Date(Date.now()+3600000).toISOString()});
  const admin={accountId:fixture.credentials.admin.accountId,sessionId,activeRole:"admin",accountStatus:"active",tenantMembership:null};
  if(pinPolicies)await new EffectivePolicyService(db).publishPolicyVersion(admin,{frameworkReference:"SEARCH-WORKER",policyReference:"SEARCH-INTERVIEW",title:"Search interview authority",effectiveFrom:new Date(Date.now()-60000),effectiveTo:null,policyValues:{pass_mark:70},overrideAllowedFields:[],overrideDirections:{}});
  for(const name of ["Alpha","Beta","ForeignAlpha"]){
   const order=id("assurance_order",name),target=id("assurance_target",name),caseId=id("assurance_case",name);
   const worker=fixture.credentials.worker.accountId,link=id("company_worker_link",name);
   await db.query("INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,order_reference,credential_target,requested_identity_checks,requested_evidence_checks,assessment_framework_references,interview_required,order_status,submitted_at,created_at,updated_at) VALUES($1,$2,$3,$4,$4,$8,$7::jsonb,$6::jsonb,$9::jsonb,TRUE,'SUBMITTED',$5,$5,$5)",[order,tenant,fixture.credentials.company.membershipId,"SEARCH-"+name,now,JSON.stringify(evidenceChecks),JSON.stringify(identityChecks),credentialTarget,JSON.stringify(frameworkReferences)]);
   await db.query("INSERT INTO assurance_order_workers(target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,target_status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'worker','submitted',$6,$6)",[target,order,tenant,link,worker,now]);
   await db.query("INSERT INTO assurance_cases(case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,case_status,owner_kind,next_action,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'Interview pending','assessor','Complete assigned interview.',$7,$7)",[caseId,order,target,tenant,link,worker,now]);
   if(pinPolicies)await pinAssuranceCasePolicySnapshot(db,{caseId,tenantId:tenant,frameworkReferences:["SEARCH-WORKER"],policyReference:"SEARCH-INTERVIEW",referenceTime:new Date(),actorAccountId:admin.accountId});
   const request=await service.requestInterview({tenantId:tenant,caseId,workerAccountId:worker,requestedAt:now});
   requests[name]=await service.assignInterview({tenantId:tenant,request,assessorAccountId:name==="ForeignAlpha"?"search_foreign_assessor":fixture.credentials.assessor.accountId});
   await db.query("UPDATE assurance_cases SET interview_reference=$2 WHERE case_id=$1",[caseId,requests[name].interviewRequestId]);
  }
  const revision=(await db.query("SELECT revisions.* FROM assurance_framework_revisions revisions JOIN assurance_frameworks frameworks USING(framework_id) WHERE frameworks.framework_reference='SEARCH-WORKER' ORDER BY version_no DESC LIMIT 1")).rows[0];
  const {StaffCalibrationService}=loadTs("src/lib/review/staff-calibration-service.ts");await new StaffCalibrationService(Promise.resolve(db)).record(admin,{accountId:fixture.credentials.assessor.accountId,role:"assessor",frameworkReference:"SEARCH-WORKER",frameworkVersionId:revision.framework_version_id,status:"CURRENT",validFrom:new Date(revision.effective_from),validUntil:new Date("2099-01-01"),note:"Exact framework benchmark for assigned interview fixtures."});
  // Distinguish searchable case references without replacing generated IDs.
  return {...fixture,requests};
 } catch(error){await fixture.cleanup();throw error;} finally {await db.close();}
}
