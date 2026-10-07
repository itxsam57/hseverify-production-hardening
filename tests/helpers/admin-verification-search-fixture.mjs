import {createHash} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {workerAssessmentSearchFixture} from "./worker-assessment-search-fixture.mjs";
const id=(prefix,seed)=>prefix+"_"+createHash("sha256").update(seed).digest("hex").slice(0,24);
// Full-schema submitted queue context only; this does not certify company submission, file scans or approval.
export async function adminVerificationSearchFixture(){
 const fixture=await workerAssessmentSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 try{
  const now=new Date().toISOString(),before=new Date(Date.now()-86400000).toISOString(),owner=fixture.credentials.company.accountId;
  const create=async(name,status="submitted",when=now)=>{
   const tenant=id("tenant",name),caseId=id("company_verification",name),version=id("company_verification_version",name);
   await db.query("INSERT INTO platform_tenants(tenant_id,tenant_type,display_name,tenant_status,created_at,updated_at) VALUES($1,'company',$2,'pending',$3,$3)",[tenant,name,when]);
   await db.query("INSERT INTO company_verification_cases(case_id,tenant_id,owner_account_id,case_status,created_at,updated_at,submitted_at) VALUES($1,$2,$3,$4,$5,$5,$6)",[caseId,tenant,owner,status,when,status==="draft"?null:when]);
   await db.query("INSERT INTO company_verification_versions(version_id,case_id,version_number,version_status,legal_name,registration_number,business_email_normalized,created_at,updated_at,submitted_at) VALUES($1,$2,1,$3,$4,$4,$5,$6,$6,$7)",[version,caseId,status==="draft"?"draft":"submitted",name,name.toLowerCase().replaceAll(" ","-")+"@verification.example.test",when,status==="draft"?null:when]);
   await db.query("UPDATE company_verification_cases SET current_version_id=$2 WHERE case_id=$1",[caseId,version]);
   return {caseId,tenant,name};
  };
  for(let n=0;n<251;n++)await create("Earlier Company "+n,"submitted",before);
  const alpha=await create("SEARCH ALPHA"),beta=await create("SEARCH BETA","under_review"),draft=await create("SEARCH ALPHA DRAFT","draft");
  return {...fixture,alpha,beta,draft};
 }catch(error){await fixture.cleanup();throw error;}finally{await db.close();}
}
