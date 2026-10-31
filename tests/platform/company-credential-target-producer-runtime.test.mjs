import {seedPermanentWorkerId} from "../helpers/permanent-worker-id-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const {AssuranceOrderService}=loadWorkerRegistrationTs("src/lib/assurance/assurance-order-service.ts");
const MIGRATION="0103_question_approval_lifecycle",NOW_DATE=new Date("2026-08-18T01:40:00.000Z"),NOW=NOW_DATE.toISOString(),FUTURE="2099-01-01T00:00:00.000Z";
const ENV={appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:"memory://",releaseSha:"m2-03-policy-runtime-test",sessionSecret:"m2-03-session-secret-with-more-than-thirty-two-characters",authPepper:"m2-03-auth-pepper-with-more-than-thirty-two-characters",authSandboxEnabled:false,authSandboxAccessKey:null,demoAuthEnabled:false,demoDataEnabled:false};
const oid=(prefix,c)=>`${prefix}_${c.repeat(24)}`;
async function db(){const d=await openScriptDatabase(ENV);await applyMigrationsThrough(d,ENV.releaseSha,MIGRATION);return d;}
async function seedPolicy(database,c,{from="2026-01-01T00:00:00.000Z",to=null,values={pass_mark:80,max_attempts:2,recording_required:true},allowed=["pass_mark","max_attempts"],directions={pass_mark:"MINIMUM",max_attempts:"MAXIMUM"}}={}){const frameworkId=oid("framework",c),policyId=oid("policy",c),versionId=oid("policy_version",c);await database.query(`INSERT INTO assurance_frameworks(framework_id,framework_reference,title,created_by_account_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)`,[frameworkId,`FRAME-${c}`,`Framework ${c}`,`account_admin_${c}`,NOW]);await database.query(`INSERT INTO assurance_policy_packs(policy_id,framework_id,policy_reference,title,created_by_account_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)`,[policyId,frameworkId,`POLICY-${c}`,`Policy ${c}`,`account_admin_${c}`,NOW]);await database.query(`INSERT INTO assurance_policy_versions(policy_version_id,policy_id,version_no,effective_from,effective_to,policy_values,override_allowed_fields,override_directions,created_by_account_id,created_at) VALUES($1,$2,1,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9)`,[versionId,policyId,from,to,JSON.stringify(values),JSON.stringify(allowed),JSON.stringify(directions),`account_admin_${c}`,NOW]);return{frameworkId,policyId,versionId,frameworkReference:`FRAME-${c}`,policyReference:`POLICY-${c}`};}
async function seedCompany(database,c){const x={accountId:`account_m203_company_${c}`,tenantId:oid("tenant",c),membershipId:oid("membership",c),sessionId:`session_m203_company_${c}`,email:`m203-${c.toLowerCase()}@example.com`};await database.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,$3,'active',$4,$5,$5,$5,$5)`,[x.accountId,x.email,`Company ${c}`,"scrypt$16384$8$1$salt$hash",NOW]);await database.query(`INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'company',$2)`,[x.accountId,NOW]);await database.query(`INSERT INTO platform_tenants(tenant_id,tenant_type,display_name,tenant_status,created_by_account_id,created_at,updated_at,activated_at) VALUES($1,'company',$2,'active',$3,$4,$4,$4)`,[x.tenantId,`Company ${c}`,x.accountId,NOW]);await database.query(`INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at) VALUES($1,$2,$3,'company','owner','active',$3,$4,$4,$4)`,[x.membershipId,x.tenantId,x.accountId,NOW]);await database.query(`INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,'company',$3,$4,$5,$5,$6)`,[x.sessionId,x.accountId,`token-${c}`,`csrf-${c}`,NOW,FUTURE]);await database.query(`INSERT INTO company_verification_cases(case_id,tenant_id,owner_account_id,case_status,lock_version,created_at,updated_at,verified_at) VALUES($1,$2,$3,'verified',0,$4,$4,$4)`,[oid("company_verification",c),x.tenantId,x.accountId,NOW]);return x;}
const settingsPrincipal=x=>Object.freeze({accountId:x.accountId,sessionId:x.sessionId,activeRole:"company",accountStatus:"active",email:x.email,displayName:"Company",createdAt:NOW,lastSeenAt:NOW,expiresAt:FUTURE,tenantMembership:{tenantId:x.tenantId,tenantStatus:"active",membershipId:x.membershipId,role:"owner",status:"active",overrides:[]},authorizedTenantPermission:"company.settings.manage"});
const ordersPrincipal=x=>Object.freeze({...settingsPrincipal(x),authorizedTenantPermission:"company.orders.manage"});
async function seedWorker(database,company,c){const workerId=`account_m203_worker_${c}`,email=`worker-m203-${c.toLowerCase()}@example.com`;await database.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,$3,'active',$4,$5,$5,$5,$5)`,[workerId,email,`Worker ${c}`,"scrypt$16384$8$1$salt$hash",NOW]);await database.query(`INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'worker',$2)`,[workerId,NOW]);const invitationId=oid("worker_invitation",c),linkId=oid("company_worker_link",c);await database.query(`INSERT INTO company_worker_invitations(invitation_id,tenant_id,email_normalized,token_hash,invitation_status,site_id,department_id,payment_responsibility,assessment_reference,invited_by_membership_id,accepted_by_worker_account_id,resend_count,resend_available_at,expires_at,accepted_at,created_at,updated_at) VALUES($1,$2,$3,$4,'accepted',NULL,NULL,'worker',NULL,$5,$6,0,$7,$8,$7,$7,$7)`,[invitationId,company.tenantId,email,`hash-${c}`,company.membershipId,workerId,NOW,FUTURE]);await database.query(`INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,invitation_id,code_id,link_status,site_id,department_id,payment_responsibility,assessment_reference,requested_by_membership_id,worker_accepted_at,activated_at,created_at,updated_at) VALUES($1,$2,$3,NULL,'invitation',$4,NULL,'active',NULL,NULL,'worker',NULL,$5,$6,$6,$6,$6)`,[linkId,company.tenantId,workerId,invitationId,company.membershipId,NOW]);return{workerId,linkId};}


test("Company credential target validates through the actual Company order producer and required interview pins validity",async()=>{
 const d=await db();try{
 const p=await seedPolicy(d,"N",{values:{credentialValidityDays:365},allowed:[],directions:{}}),company=await seedCompany(d,"O"),worker=await seedWorker(d,company,"P"),service=new AssuranceOrderService(d),principal=ordersPrincipal(company);
 await seedPermanentWorkerId(d,{accountId:worker.workerId},"Q",NOW);
 const order=await service.createDraft(principal,{orderName:"Credential target order",orderReference:"TARGET-PRODUCER",siteId:null,departmentId:null,requestedIdentityChecks:[],requestedEvidenceChecks:[],assessmentFrameworkReferences:[p.frameworkReference],interviewRequired:true,credentialTarget:"Operational Safety Credential",deadline:null,effectivePolicyReference:p.policyReference,companyNotes:null,purchaseOrderReference:null},NOW_DATE);
 await service.addWorkerTarget(principal,order.orderId,worker.linkId,"worker",NOW_DATE);
 const validation=await service.validateOrder(principal,order.orderId,NOW_DATE);
 assert.equal(validation.ready,true,validation.errors.join("; "));
 const cases=await service.submitOrder(principal,order.orderId,NOW_DATE);assert.equal(cases.length,1);assert.equal(cases[0].caseStatus,"Assessment pending");
 const stored=(await d.query("SELECT credential_target,order_status FROM assurance_orders WHERE order_id=$1",[order.orderId])).rows[0];
 assert.equal(stored.credential_target,"Operational Safety Credential");assert.equal(stored.order_status,"SUBMITTED");
 const pinned=(await d.query("SELECT effective_value_json FROM assurance_case_policy_snapshots WHERE case_id=$1",[cases[0].caseId])).rows[0];assert.equal(pinned.effective_value_json.credentialValidityDays,365);
 }finally{await d.close();}
});

const SIGNING_KEY="company-target-disposable-signing-key-more-than-32";
const {DecisionRepository}=loadWorkerRegistrationTs("src/lib/decision/decision-engine-repository.ts");
const {createDecision}=loadWorkerRegistrationTs("src/lib/decision/decision-engine-domain.ts");
const {credentialFromRow,credentialAuthentication}=loadWorkerRegistrationTs("src/lib/credential/credential-issuance-domain.ts");
for(const state of ["APPROVED","REJECTED"]){
 test(`Company target actual producer reaches ${state} decision with correct issuance and Living Record`,async()=>{
  const d=await db();try{
   const company=await seedCompany(d,"A"),worker=await seedWorker(d,company,"B");
   const workerId=await seedPermanentWorkerId(d,{accountId:worker.workerId},"C",NOW);
   const service=new AssuranceOrderService(d),principal=ordersPrincipal(company);
   const order=await service.createDraft(principal,{orderName:"Target decision",orderReference:"TARGET-"+state,siteId:null,departmentId:null,requestedIdentityChecks:[],requestedEvidenceChecks:[],assessmentFrameworkReferences:[],interviewRequired:false,credentialTarget:"Operational Safety Credential",deadline:null,effectivePolicyReference:null,companyNotes:null,purchaseOrderReference:null},NOW_DATE);
   await service.addWorkerTarget(principal,order.orderId,worker.linkId,"worker",NOW_DATE);
   const validation=await service.validateOrder(principal,order.orderId,NOW_DATE);assert.equal(validation.ready,true,validation.errors.join("; "));
   const [created]=await service.submitOrder(principal,order.orderId,NOW_DATE);assert.equal(created.caseStatus,"Decision pending");
   await d.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES('independent_admin_review','independent-target-admin@example.test','Independent target Admin','active','scrypt$16384$8$1$salt$hash',$1,$1,$1,$1)",[NOW]);
   await d.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES('independent_admin_review','admin',$1)",[NOW]);
   const decision=createDecision({tenantId:company.tenantId,caseId:created.caseId,state,reasonCode:"controlled_review",explanation:"Actual Company target order completed independent final review.",ruleVersion:"target-producer",inputReferences:[created.caseId],createdAt:NOW});
   await new DecisionRepository(Promise.resolve(d),SIGNING_KEY).saveDecisionAndProgressCase(decision,"independent_admin_review");
   const linked=(await d.query("SELECT credential_reference,case_status FROM assurance_cases WHERE case_id=$1",[created.caseId])).rows[0];
   const issuances=(await d.query("SELECT * FROM credential_issuances WHERE worker_id=$1",[workerId])).rows;
   const living=(await d.query("SELECT c.title,v.status,v.expires_at FROM living_record_competencies c JOIN living_record_versions v USING(competency_id) WHERE c.worker_id=$1",[workerId])).rows;
   if(state==="APPROVED"){
    assert.equal(issuances.length,1);assert.equal(linked.credential_reference,issuances[0].credential_id);
    assert.equal(issuances[0].qualification,"Operational Safety Credential");assert.equal(issuances[0].worker_id,workerId);
    assert.equal(credentialAuthentication(credentialFromRow(issuances[0]),SIGNING_KEY),"authenticated");
    assert.equal(issuances[0].expires_at,null);assert.equal(living.length,1);assert.equal(living[0].title,"Operational Safety Credential");assert.equal(living[0].status,"valid");
   }else{assert.equal(linked.credential_reference,null);assert.equal(issuances.length,0);assert.equal(living.length,0);}
  }finally{await d.close();}
 });
}

test("Company target retains fail-closed missing effective policy validation",async()=>{
 const d=await db();try{
 const company=await seedCompany(d,"D"),worker=await seedWorker(d,company,"E"),service=new AssuranceOrderService(d),principal=ordersPrincipal(company);
 const order=await service.createDraft(principal,{orderName:"Missing policy target",orderReference:"TARGET-MISSING-POLICY",siteId:null,departmentId:null,requestedIdentityChecks:[],requestedEvidenceChecks:[],assessmentFrameworkReferences:["UNAVAILABLE-FRAMEWORK"],interviewRequired:false,credentialTarget:"Operational Safety Credential",deadline:null,effectivePolicyReference:"UNAVAILABLE-POLICY",companyNotes:null,purchaseOrderReference:null},NOW_DATE);
 await service.addWorkerTarget(principal,order.orderId,worker.linkId,"worker",NOW_DATE);
 const result=await service.validateOrder(principal,order.orderId,NOW_DATE);assert.equal(result.ready,false);assert.match(result.errors.join(" "),/framework|policy/i);
 await assert.rejects(service.submitOrder(principal,order.orderId,NOW_DATE));
 assert.equal((await d.query("SELECT count(*)::int AS n FROM assurance_cases WHERE order_id=$1",[order.orderId])).rows[0].n,0);
 }finally{await d.close();}
});
