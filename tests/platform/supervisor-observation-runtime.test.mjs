import assert from "node:assert/strict";
import test from "node:test";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const {EvidenceReviewService}=loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const {SupervisorObservationService}=loadWorkerRegistrationTs("src/lib/review/supervisor-observation-service.ts");
const ENV={appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:"memory://",releaseSha:"supervisor-proof"};
const id=(p,c)=>p+"_"+c.repeat(24),now=new Date().toISOString(),future="2099-01-01T00:00:00Z";
async function fixture(){
 const db=await openScriptDatabase(ENV);await applyMigrationsThrough(db,ENV.releaseSha,"0112_supervisor_signed_evidence");
 const tenant=id("tenant","T"),member=id("membership","M"),other=id("membership","N"),caseId=id("assurance_case","C");
 for(const [a,role] of [["company","company"],["other","company"],["verifier","verifier"],["account_worker_supervisor","worker"]]){
 await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,$1,'active','fixture-hash',$3,$3,$3,$3)",[a,a+"@proof.test",now]);
 await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)",[a,role,now]);
 await db.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,$3,$1,$1,$4,$4,$5)",["session_"+a,a,role,now,future]);}
 await db.query("INSERT INTO platform_tenants(tenant_id,tenant_type,display_name,tenant_status,created_at,updated_at,activated_at) VALUES($1,'company','Proof','active',$2,$2,$2)",[tenant,now]);
 for(const [m,a] of [[member,"company"],[other,"other"]])await db.query("INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_at,updated_at,activated_at) VALUES($1,$2,$3,'company','owner','active',$4,$4,$4)",[m,tenant,a,now]);
 const order=id("assurance_order","O"),target=id("assurance_target","G"),link=id("company_worker_link","L");
 await db.query("INSERT INTO assurance_orders(order_id,tenant_id,created_by_membership_id,order_name,order_reference,assessment_framework_references,order_status,submitted_at,created_at,updated_at) VALUES($1,$2,$3,'Proof','PROOF','[\"HSE-PROOF\"]','SUBMITTED',$4,$4,$4)",[order,tenant,member,now]);
 await db.query("INSERT INTO assurance_order_workers(target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,target_status,created_at,updated_at) VALUES($1,$2,$3,$4,'account_worker_supervisor','worker','submitted',$5,$5)",[target,order,tenant,link,now]);
 await db.query("INSERT INTO assurance_cases(case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,case_status,owner_kind,next_action,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'account_worker_supervisor','Evidence pending','worker','Submit evidence',$6,$6)",[caseId,order,target,tenant,link,now]);
 const principal={accountId:"company",sessionId:"session_company",activeRole:"company",accountStatus:"active",tenantMembership:{tenantId:tenant,membershipId:member,tenantStatus:"active",status:"active",role:"owner",overrides:[]},authorizedTenantPermission:"company.orders.manage"};
 const worker={accountId:"account_worker_supervisor",sessionId:"session_account_worker_supervisor",activeRole:"worker",accountStatus:"active",tenantMembership:null};
 const input={caseId,observerMembershipId:member,frameworkReference:"HSE-PROOF",competencyReference:"COMP-PROOF",taskReference:"Safe isolation",checklist:["Isolation proved"],observationText:"Worker demonstrated safe isolation independently.",outcome:"demonstrated",supervisorDeclaration:"I personally observed this safe isolation task.",observedAt:new Date(now)};
 return {db,service:new SupervisorObservationService(Promise.resolve(db)),principal,worker,input,other,caseId};
}
test("Supervisor declaration cannot be signed as another member",async()=>{const f=await fixture();try{await assert.rejects(f.service.create(f.principal,{...f.input,observerMembershipId:f.other}));}finally{await f.db.close()}});
test("Observation cannot use an unrelated framework",async()=>{const f=await fixture();try{await assert.rejects(f.service.create(f.principal,{...f.input,frameworkReference:"UNRELATED"}));}finally{await f.db.close()}});
test("Revoked Company session cannot create signed evidence",async()=>{const f=await fixture();try{await f.db.query("UPDATE auth_sessions SET revoked_at=$2,revocation_reason='logout' WHERE session_id=$1",[f.principal.sessionId,now]);await assert.rejects(f.service.create(f.principal,f.input));}finally{await f.db.close()}});
test("Revoked Worker session cannot acknowledge or read evidence",async()=>{const f=await fixture();try{const o=await f.service.create(f.principal,f.input);await f.db.query("UPDATE auth_sessions SET revoked_at=$2,revocation_reason='logout' WHERE session_id=$1",[f.worker.sessionId,now]);await assert.rejects(f.service.acknowledge(f.worker,o,"Seen"));await assert.rejects(f.service.listForWorker(f.worker));}finally{await f.db.close()}});
test("Signed supervisor source and acknowledged comment cannot be overwritten",async()=>{const f=await fixture();try{const o=await f.service.create(f.principal,f.input);await f.service.acknowledge(f.worker,o,"I acknowledge the restrictions");await assert.rejects(f.service.acknowledge(f.worker,o,"Replacement"));await assert.rejects(f.db.query("UPDATE supervisor_observation_details SET supervisor_declaration='Forged declaration text' WHERE observation_id=$1",[o]));await assert.rejects(f.db.query("UPDATE supervisor_observation_details SET worker_comment='Replacement' WHERE observation_id=$1",[o]));}finally{await f.db.close()}});

test("Closed case cannot receive new signed observation",async()=>{const f=await fixture();try{await f.db.query("UPDATE assurance_cases SET case_status='Closed',closed_at=$2,owner_kind=NULL,next_action=NULL WHERE case_id=$1",[f.caseId,now]);await assert.rejects(f.service.create(f.principal,f.input));}finally{await f.db.close()}});
test("Company context reveals only current signer",async()=>{const f=await fixture();try{const context=await f.service.listCompanyContext(f.principal);assert.deepEqual(context.supervisors.map(x=>x.membershipId),[f.input.observerMembershipId]);}finally{await f.db.close()}});

test("Company cannot queue an unacknowledged supervisor declaration",async()=>{const f=await fixture();try{await f.service.create(f.principal,f.input);await new EvidenceReviewService(f.db).queueCaseEvidence(f.principal,f.caseId);const q=await f.db.query("SELECT count(*)::int AS n FROM evidence_review_tasks WHERE evidence_kind='supervisor_observation'");assert.equal(q.rows[0].n,0);}finally{await f.db.close()}});

for(const [status,caseStatus,owner] of [['ESCALATED','Review pending','admin'],['UNABLE_TO_VERIFY','Evidence pending','worker'],['CHANGES_REQUESTED','Evidence pending','worker']]){
 test('Acknowledgement preserves existing '+status+' owner instead of assigning reviewer',async()=>{
 const f=await fixture();try{
 const first=await f.service.create(f.principal,f.input);await f.service.acknowledge(f.worker,first,'Acknowledged prior source');
 await f.db.query("UPDATE evidence_review_tasks SET task_status=$2,assigned_verifier_account_id='verifier',claimed_at=clock_timestamp(),decided_at=clock_timestamp() WHERE source_record_id=$1",[first,status]);
 await f.db.query('UPDATE assurance_cases SET case_status=$2,owner_kind=$3,next_action=$4 WHERE case_id=$1',[f.caseId,caseStatus,owner,'Retain existing blocker']);
 const second=await f.service.create(f.principal,{...f.input,competencyReference:'COMP-SECOND'});await f.service.acknowledge(f.worker,second,'Acknowledge additional signed evidence');
 const actual=(await f.db.query('SELECT case_status,owner_kind FROM assurance_cases WHERE case_id=$1',[f.caseId])).rows[0];
 assert.deepEqual(actual,{case_status:caseStatus,owner_kind:owner});
 }finally{await f.db.close();}
 });
}

test('Acknowledgement ignores a superseded escalated source',async()=>{const f=await fixture();try{
 const first=await f.service.create(f.principal,f.input);await f.service.acknowledge(f.worker,first,'Prior source acknowledged');
 await f.db.query("UPDATE evidence_review_tasks SET task_status='ESCALATED',assigned_verifier_account_id='verifier',claimed_at=clock_timestamp(),decided_at=clock_timestamp() WHERE source_record_id=$1",[first]);
 await f.db.query("UPDATE supervisor_observations SET observation_status='superseded',superseded_at=clock_timestamp() WHERE observation_id=$1",[first]);
 const second=await f.service.create(f.principal,{...f.input,competencyReference:'CURRENT-COMP'});await f.service.acknowledge(f.worker,second,'Current acknowledged evidence');
 assert.deepEqual((await f.db.query('SELECT case_status,owner_kind FROM assurance_cases WHERE case_id=$1',[f.caseId])).rows[0],{case_status:'Review pending',owner_kind:'reviewer'});
}finally{await f.db.close();}});
