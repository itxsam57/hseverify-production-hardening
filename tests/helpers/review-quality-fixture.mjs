
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "./migration-ceiling.mjs";
import { loadWorkerRegistrationTs } from "./worker-registration-runtime-loader.mjs";
const {EvidenceReviewService}=loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const {SupervisorObservationService}=loadWorkerRegistrationTs("src/lib/review/supervisor-observation-service.ts");
const ENV={appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:"memory://",releaseSha:"supervisor-proof"};
const id=(p,c)=>p+"_"+c.repeat(24),now=new Date().toISOString(),future="2099-01-01T00:00:00Z";
export async function reviewQualityFixture({policyValues={},database=null}={}){
 const db=database??await openScriptDatabase(ENV);if(!database)await applyMigrationsThrough(db,ENV.releaseSha,"0119_evidence_review_quality_controls");
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

 const {seedWorkerPrincipal}=await import("./assessment-attempt-fixture.mjs");
 const adminBase=await seedWorkerPrincipal(db,"quality-admin");
 await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'admin')",[adminBase.accountId]);
 await db.query("UPDATE auth_sessions SET active_role='admin' WHERE session_id=$1",[adminBase.sessionId]);
 const admin={...adminBase,activeRole:"admin"};
 const verifiers=[];
 for(const seed of ["quality-first","quality-second","quality-third"]){const v=await seedWorkerPrincipal(db,seed);await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'verifier')",[v.accountId]);await db.query("UPDATE auth_sessions SET active_role='verifier' WHERE session_id=$1",[v.sessionId]);verifiers.push({...v,activeRole:"verifier"});}
 const {EffectivePolicyService}=loadWorkerRegistrationTs("src/lib/policy/effective-policy-service.ts");
 const {EvidenceReviewFrameworkService}=loadWorkerRegistrationTs("src/lib/review/evidence-review-framework-service.ts");
 const {StaffCalibrationService}=loadWorkerRegistrationTs("src/lib/review/staff-calibration-service.ts");
 const from=new Date("2000-01-01T00:00:00Z"),policy=new EffectivePolicyService(db);
 const frameworkId=await policy.createFramework(admin,{reference:"HSE-PROOF",title:"Observed safety competence"},from);
 await policy.publishPolicyVersion(admin,{frameworkReference:"HSE-PROOF",policyReference:"HSE-PROOF",title:"Pinned evidence review controls",effectiveFrom:from,effectiveTo:null,policyValues:{pass_mark:80,...policyValues},overrideAllowedFields:[],overrideDirections:{}});
 const revision=(await db.query("SELECT framework_version_id,effective_from FROM assurance_framework_revisions WHERE framework_id=$1",[frameworkId])).rows[0];
 for(const verifier of verifiers)await new StaffCalibrationService(Promise.resolve(db)).record(admin,{accountId:verifier.accountId,role:"verifier",frameworkReference:"HSE-PROOF",frameworkVersionId:revision.framework_version_id,status:"CURRENT",validFrom:new Date(revision.effective_from),validUntil:new Date(future),note:"Independent benchmark calibration against this exact safety revision."});
 const service=new SupervisorObservationService(Promise.resolve(db));
 async function queue(competency="COMP-PROOF"){
  const observationId=await service.create(principal,{...input,competencyReference:competency});await service.acknowledge(worker,observationId,"I acknowledge this signed observed competency.");
  const task=(await db.query("SELECT task_id FROM evidence_review_tasks WHERE source_version_id=$1",[observationId])).rows[0];
  await new EvidenceReviewFrameworkService(Promise.resolve(db)).bind(admin,{taskId:task.task_id,frameworkVersionId:revision.framework_version_id,policyReference:"HSE-PROOF",reason:"Explicit applicability of the observed competency and pinned published review controls.",expectedBindingId:null});
  return {taskId:task.task_id,observationId};
 }
 return {db,service,principal,worker,input,other,caseId,admin,verifiers,queue,review:new EvidenceReviewService(db),frameworkId};
}
