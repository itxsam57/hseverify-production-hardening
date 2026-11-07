import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { assessorInterviewSearchFixture } from "./assessor-interview-search-fixture.mjs";
import { authorizeReviewFixture } from "./evidence-review-calibration-fixture.mjs";
const id=seed=>"evidence_review_"+createHash("sha256").update(seed).digest("hex").slice(0,24);
// Full-schema queue context; this certifies search/claim/navigation, not evidence submission or review decisions.
export async function verifierReviewSearchFixture(){
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
 const alpha=id("search-alpha"),beta=id("search-beta"),foreign=id("search-foreign-alpha");
 try{
  const now=new Date(),before=new Date(now.getTime()-86400000).toISOString(),caseId=fixture.requests.Alpha.caseId,tenant=fixture.credentials.company.tenantId,worker=fixture.credentials.worker.accountId;
  for(let n=0;n<251;n++){
   await db.query("INSERT INTO evidence_review_tasks(task_id,tenant_id,case_id,worker_account_id,evidence_kind,source_record_id,source_version_id,evidence_label,task_status,created_at,updated_at) VALUES($1,$2,$3,$4,'skill',$5,$5,'Earlier task','QUEUED',$6,$6)",[id("earlier-"+n),tenant,caseId,worker,"earlier-search-version-"+n,before]);
  }
  for(const [taskId,version,assignee] of [[alpha,"SEARCH-ALPHA-VERSION",null],[beta,"SEARCH-BETA-VERSION",fixture.credentials.verifier.accountId],[foreign,"SEARCH-ALPHA-FOREIGN","search_foreign_verifier"]]){
   await db.query("INSERT INTO evidence_review_tasks(task_id,tenant_id,case_id,worker_account_id,evidence_kind,source_record_id,source_version_id,evidence_label,task_status,assigned_verifier_account_id,claimed_at,created_at,updated_at) VALUES($1,$2,$3,$4,'skill',$5,$5,$5,$6,$7,$8,$9,$9)",[taskId,tenant,caseId,worker,version,assignee?"ASSIGNED":"QUEUED",assignee,assignee?now.toISOString():null,now.toISOString()]);
  }
  await authorizeReviewFixture(db,{taskId:alpha,verifiers:[{accountId:fixture.credentials.verifier.accountId}],at:now});
  return {...fixture,alpha,beta,foreign};
 }catch(error){await fixture.cleanup();throw error;}finally{await db.close();}
}
