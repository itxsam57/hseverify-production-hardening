import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { workerAssessmentSearchFixture } from "./worker-assessment-search-fixture.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";
const {InterviewSchedulingService}=loadTs("src/lib/interview/interview-scheduling-service.ts");
const id=(prefix,seed)=>prefix+"_"+createHash("sha256").update(seed).digest("hex").slice(0,24);

// Schema-valid case context, then actual request/assignment producers.
// This is search/navigation evidence, not order funding or assessor matching certification.
export async function assessorInterviewSearchFixture({evidenceChecks=[],identityChecks=[],credentialTarget=null}={}){
 const fixture=await workerAssessmentSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const service=new InterviewSchedulingService(db),tenant=fixture.credentials.company.tenantId,now=new Date().toISOString(),requests={};
  for(const name of ["Alpha","Beta","ForeignAlpha"]){
   const order=id("assurance_order",name),target=id("assurance_target",name),caseId=id("assurance_case",name);
   const worker=fixture.credentials.worker.accountId,link=id("company_worker_link",name);
   await db.query("INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,order_reference,credential_target,requested_identity_checks,requested_evidence_checks,assessment_framework_references,interview_required,order_status,submitted_at,created_at,updated_at) VALUES($1,$2,$3,$4,$4,$8,$7::jsonb,$6::jsonb,'[]',TRUE,'SUBMITTED',$5,$5,$5)",[order,tenant,fixture.credentials.company.membershipId,"SEARCH-"+name,now,JSON.stringify(evidenceChecks),JSON.stringify(identityChecks),credentialTarget]);
   await db.query("INSERT INTO assurance_order_workers(target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,target_status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'worker','submitted',$6,$6)",[target,order,tenant,link,worker,now]);
   await db.query("INSERT INTO assurance_cases(case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,case_status,owner_kind,next_action,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'Interview pending','assessor','Complete assigned interview.',$7,$7)",[caseId,order,target,tenant,link,worker,now]);
   const request=await service.requestInterview({tenantId:tenant,caseId,workerAccountId:worker,requestedAt:now});
   requests[name]=await service.assignInterview({tenantId:tenant,request,assessorAccountId:name==="ForeignAlpha"?"search_foreign_assessor":fixture.credentials.assessor.accountId});
   await db.query("UPDATE assurance_cases SET interview_reference=$2 WHERE case_id=$1",[caseId,requests[name].interviewRequestId]);
  }
  // Distinguish searchable case references without replacing generated IDs.
  return {...fixture,requests};
 } catch(error){await fixture.cleanup();throw error;} finally {await db.close();}
}
