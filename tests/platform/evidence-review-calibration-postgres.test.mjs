import assert from "node:assert/strict";
import test, { before as beforeAll, after as afterAll } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const { StaffCalibrationService } = loadWorkerRegistrationTs("src/lib/review/staff-calibration-service.ts");
const { EvidenceReviewFrameworkService } = loadWorkerRegistrationTs("src/lib/review/evidence-review-framework-service.ts");
const { EvidenceReviewService } = loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const { EffectivePolicyService, pinAssuranceCasePolicySnapshot } = loadWorkerRegistrationTs("src/lib/policy/effective-policy-service.ts");
const NOW = new Date(), before = new Date(NOW.getTime()-3600000), future = new Date(NOW.getTime()+3600000);
let fixtureRun=0;
const id = (prefix, char) => `${prefix}_${char.repeat(23)}${fixtureRun}`;
const databaseUrl=process.env.HSE_POSTGRES_TEST_DATABASE_URL;
if(!databaseUrl)throw new Error("Set HSE_POSTGRES_TEST_DATABASE_URL for disposable two-connection lock proof.");
const ENV={appEnvironment:"test",databaseDriver:"postgres",databaseUrl:null,releaseSha:"calibration-postgres"};
const disposableName="evidence_calibration_"+Date.now()+"_"+process.pid;
let adminDatabase,created=false;
beforeAll(async()=>{
 const url=new URL(databaseUrl);
 adminDatabase=await openScriptDatabase({...ENV,databaseUrl:url.href});
 await adminDatabase.execute('CREATE DATABASE "'+disposableName+'"');created=true;
 url.pathname="/"+disposableName;ENV.databaseUrl=url.href;
});
afterAll(async()=>{
 try{if(created)await adminDatabase.execute('DROP DATABASE "'+disposableName+'"');}
 finally{await adminDatabase?.close();}
});
let migrated=false;
async function setup(frameworkReference="CAL-B") {
 fixtureRun++;
 const db = await openScriptDatabase(ENV);
 if(!migrated){for(const name of readdirSync("database/migrations").filter(x=>x.endsWith(".up.sql")).sort()) await db.execute(readFileSync(`database/migrations/${name}`,"utf8"));migrated=true;}
 async function account(role,char) {
  const accountId=id("account",char),sessionId=id("session",char);
  await db.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,$3,'active','scrypt$16384$8$1$salt$hash',$4,$4,$4,$4)`,[accountId,`${char}${fixtureRun}@example.test`,role,before.toISOString()]);
  await db.query(`INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)`,[accountId,role,before.toISOString()]);
  await db.query(`INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$6,$7)`,[sessionId,accountId,role,`token-${char}-${fixtureRun}`,`csrf-${char}-${fixtureRun}`,before.toISOString(),future.toISOString()]);
  return {accountId,sessionId,activeRole:role,accountStatus:"active",tenantMembership:null,email:`${char}${fixtureRun}@example.test`,displayName:role,createdAt:before.toISOString(),lastSeenAt:before.toISOString(),expiresAt:future.toISOString()};
 }
 const admin=await account("admin","A"),verifier=await account("verifier","V"),worker=await account("worker","W");
 const frameworkId=id("framework","F");
 await db.query(`INSERT INTO assurance_frameworks(framework_id,framework_reference,title,created_by_account_id,created_at,updated_at) VALUES($1,$4,'Calibration framework',$2,$3,$3)`,[frameworkId,admin.accountId,before.toISOString(),frameworkReference]);
 const calibration=new StaffCalibrationService(Promise.resolve(db));
 async function record(status,from=before,until=future) {return calibration.record(admin,{accountId:verifier.accountId,role:"verifier",frameworkReference,status,validFrom:from,validUntil:until,note:"Observed benchmark result for evidence review."});}
 const recordId=id("worker_evidence_record","R"),versionId=id("worker_evidence_version","R");
 await db.query(`INSERT INTO worker_evidence_records(record_id,worker_account_id,record_kind,lifecycle_status,current_version_id,created_at,updated_at) VALUES($1,$2,'experience','active',NULL,$3,$3)`,[recordId,worker.accountId,before.toISOString()]);
 await db.query(`INSERT INTO worker_evidence_versions(version_id,record_id,version_number,revision,version_status,created_at,updated_at,submitted_at) VALUES($1,$2,1,1,'submitted',$3,$3,$3)`,[versionId,recordId,before.toISOString()]);
 await db.query(`UPDATE worker_evidence_records SET current_version_id=$2 WHERE record_id=$1`,[recordId,versionId]);
 const review=new EvidenceReviewService(db),task=await review.queueIndependentWorkerEvidence(worker,recordId,NOW);
 return {db,admin,verifier,worker,frameworkId,calibration,record,review,task};
}

async function waitBlocked(control,pid){
 const deadline=Date.now()+10000;
 while(Date.now()<deadline){const r=await control.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[pid]);if(r.rows[0]?.wait_event_type==="Lock")return;await new Promise(resolve=>setTimeout(resolve,25));}
 throw new Error("Competing real PostgreSQL producer did not block on authorization lock.");
}
test("actual PostgreSQL writer blocks concurrent claim until FAILED status commits",async()=>{
 const x=await setup(),other=await openScriptDatabase(ENV),control=await openScriptDatabase(ENV);
 let release;const held=new Promise(resolve=>release=resolve);let writerReady;const ready=new Promise(resolve=>writerReady=resolve);
 try{
  const framework=new EvidenceReviewFrameworkService(Promise.resolve(x.db));const revision=(await framework.listFrameworks(x.admin))[0].frameworkVersionId;
  await framework.bind(x.admin,{taskId:x.task.taskId,frameworkVersionId:revision,reason:"Authoritative framework for lock proof.",expectedBindingId:null},NOW);await x.record("CURRENT");
  const pid=(await other.query("SELECT pg_backend_pid() pid")).rows[0].pid;
  const writer=x.db.transaction(async tx=>{
   await new StaffCalibrationService(Promise.resolve(tx)).record(x.admin,{accountId:x.verifier.accountId,role:"verifier",frameworkReference:"CAL-B",status:"FAILED",validFrom:new Date(NOW.getTime()-1000),validUntil:future,note:"Observed calibration failure supersedes earlier current result."});writerReady();await held;
  });await ready;
  const claim=new EvidenceReviewService(other).claim(x.verifier,x.task.taskId,NOW);const outcome=claim.then(()=>({ok:true}),error=>({ok:false,message:error.message}));
  await waitBlocked(control,pid);release();await writer;const result=await outcome;assert.equal(result.ok,false);assert.match(result.message,/calibration/i);
  assert.equal((await x.db.query("SELECT task_status FROM evidence_review_tasks WHERE task_id=$1",[x.task.taskId])).rows[0].task_status,"QUEUED");
 }finally{release();await other.close();await control.close();await x.db.close();}
});

// Each test has distinct real producer fixtures in the disposable database.
// Snapshot publication holds the framework row, without sharing Admin locks.
test("actual PostgreSQL snapshot publication locks out backdated revision until snapshot commits",async()=>{
 const x=await setup("CAL-B-SNAPSHOT"),db=x.db,other=await openScriptDatabase(ENV),control=await openScriptDatabase(ENV);
 let release;const held=new Promise(resolve=>release=resolve);let writerReady;const ready=new Promise(resolve=>writerReady=resolve);
 let writer;
 try{
  const admin=x.admin,accountId=admin.accountId;
  const tenant=id("tenant","T"),caseId=id("assurance_case","C"),order=id("assurance_order","C"),target=id("assurance_target","C"),membership=id("membership","C"),link=id("company_worker_link","C");
  await db.query(`INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,order_reference,requested_identity_checks,requested_evidence_checks,assessment_framework_references,interview_required,order_status,submitted_at,created_at,updated_at) VALUES($1,$2,$3,'Pinned lock order','PIN-LOCK','[]','[]','["CAL-B-SNAPSHOT"]',FALSE,'SUBMITTED',$4,$4,$4)`,[order,tenant,membership,NOW.toISOString()]);
  await db.query(`INSERT INTO assurance_order_workers(target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,target_status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'worker','submitted',$6,$6)`,[target,order,tenant,link,id("account","W"),NOW.toISOString()]);
  await db.query(`INSERT INTO assurance_cases(case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,case_status,owner_kind,next_action,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'Evidence pending','worker','Submit evidence.',$7,$7)`,[caseId,order,target,tenant,link,id("account","W"),NOW.toISOString()]);
  await new EffectivePolicyService(db).publishPolicyVersion(admin,{frameworkReference:"CAL-B-SNAPSHOT",policyReference:"PIN-LOCK",title:"Pinned lock rules",effectiveFrom:before,effectiveTo:null,policyValues:{pass_mark:80},overrideAllowedFields:[],overrideDirections:{}},NOW);
  const pid=(await other.query("SELECT pg_backend_pid() pid")).rows[0].pid;
  writer=db.transaction(async tx=>{
   await pinAssuranceCasePolicySnapshot(tx,{caseId,tenantId:tenant,frameworkReferences:["CAL-B-SNAPSHOT"],policyReference:"PIN-LOCK",referenceTime:NOW,actorAccountId:accountId});
   writerReady();await held;
  });await ready;
  const revision=new EvidenceReviewFrameworkService(Promise.resolve(other)).recordRevision(admin,{frameworkId:id("framework","F"),title:"Backdated race must be denied",effectiveFrom:new Date(NOW.getTime()-1000)},NOW);
  const outcome=revision.then(()=>({ok:true}),error=>({ok:false,message:error.message}));
  await waitBlocked(control,pid);release();await writer;const result=await outcome;
  assert.equal(result.ok,false);assert.match(result.message,/existing case snapshot/i);
  assert.equal((await db.query("SELECT count(*)::integer n FROM assurance_framework_revisions WHERE framework_id=$1",[id("framework","F")])).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::integer n FROM assurance_case_policy_snapshots WHERE case_id=$1",[caseId])).rows[0].n,1);
 }finally{release?.();await writer?.catch(()=>{});await other.close();await control.close();await db.close();}
});
