import assert from "node:assert/strict";import test from "node:test";import {openScriptDatabase} from "../../scripts/lib/database.mjs";import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
import {authorizeReviewFixture} from "../helpers/evidence-review-calibration-fixture.mjs";
const {SupervisorObservationService}=loadWorkerRegistrationTs("src/lib/review/supervisor-observation-service.ts");
const {EvidenceReviewService}=loadWorkerRegistrationTs("src/lib/review/evidence-review-service.ts");
const NOW_DATE = new Date("2026-08-18T01:00:00.000Z");
const NOW = NOW_DATE.toISOString();
const FUTURE = "2099-01-01T00:00:00.000Z";
const ENV = {
  appEnvironment: "test", databaseDriver: "pglite", databaseUrl: null,
  pgliteDataDir: "memory://", releaseSha: "m2-02-evidence-review-runtime-test",
  sessionSecret: "m2-02-evidence-review-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m2-02-evidence-review-auth-pepper-with-more-than-thirty-two-characters",
  authSandboxEnabled: false, authSandboxAccessKey: null,
  demoAuthEnabled: false, demoDataEnabled: false
};
const oid = (prefix, c) => `${prefix}_${c.repeat(24)}`;


function companyPrincipal(c) {
  return Object.freeze({
    accountId:`account_m202_company_${c}`,
    sessionId:`session_m202_company_${c}`,
    activeRole:"company",
    accountStatus:"active",
    email:`company-m202-${c.toLowerCase()}@example.com`,
    displayName:`M202 Company ${c}`,
    createdAt:NOW,
    lastSeenAt:NOW,
    expiresAt:FUTURE,
    tenantMembership:{
      tenantId:oid("tenant",c), tenantStatus:"active", membershipId:oid("membership",c),
      role:"owner", status:"active", overrides:[]
    },
    authorizedTenantPermission:"company.orders.manage"
  });
}

async function seedVerifier(database, c) {
  const verifier = {
    accountId:`account_m202_verifier_${c}`,
    sessionId:`session_m202_verifier_${c}`,
    email:`verifier-m202-${c.toLowerCase()}@example.com`,
    displayName:`M202 Verifier ${c}`
  };
  await database.query(`INSERT INTO auth_accounts
    (account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
    VALUES ($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [verifier.accountId,verifier.email,verifier.displayName,"scrypt$16384$8$1$salt$hash",NOW]);
  await database.query(`INSERT INTO auth_account_roles (account_id,role,created_at) VALUES ($1,'verifier',$2)`,[verifier.accountId,NOW]);
  await database.query(`INSERT INTO auth_sessions
    (session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at)
    VALUES ($1,$2,'verifier',$3,$4,$5,$5,$6)`,
    [verifier.sessionId,verifier.accountId,`m202-token-${c}`,`m202-csrf-${c}`,NOW,FUTURE]);
  const tasks=await database.query("SELECT task_id FROM evidence_review_tasks WHERE task_status='QUEUED'");
  for(const task of tasks.rows)await authorizeReviewFixture(database,{taskId:task.task_id,verifiers:[verifier],at:NOW_DATE});
  return Object.freeze({
    ...verifier, activeRole:"verifier", accountStatus:"active", createdAt:NOW,
    lastSeenAt:NOW, expiresAt:FUTURE, tenantMembership:null
  });
}

async function seedCase(database, c, requestedEvidenceChecks=[]) {
  const company = companyPrincipal(c);
  const orderId=oid("assurance_order",c), targetId=oid("assurance_target",c), caseId=oid("assurance_case",c);
  const workerAccountId=`account_m202_worker_${c}`, workerLinkId=oid("company_worker_link",c);
  await database.query(`INSERT INTO assurance_orders
    (order_id,tenant_id,created_by_membership_id,order_name,order_reference,requested_identity_checks,requested_evidence_checks,
     assessment_framework_references,interview_required,order_status,submitted_at,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,'[]'::jsonb,$6::jsonb,$8::jsonb,FALSE,'SUBMITTED',$7,$7,$7)`,
    [orderId,company.tenantMembership.tenantId,company.tenantMembership.membershipId,`M202 Order ${c}`,`M202-${c}`,JSON.stringify(requestedEvidenceChecks),NOW,JSON.stringify([`SUPERVISOR-${c}`])]);
  await database.query(`INSERT INTO assurance_order_workers
    (target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,target_status,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,'worker','submitted',$6,$6)`,
    [targetId,orderId,company.tenantMembership.tenantId,workerLinkId,workerAccountId,NOW]);
  await database.query(`INSERT INTO assurance_cases
    (case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,case_status,owner_kind,next_action,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,'Evidence pending','worker','Submit required evidence.',$7,$7)`,
    [caseId,orderId,targetId,company.tenantMembership.tenantId,workerLinkId,workerAccountId,NOW]);
  return { company, orderId, targetId, caseId, workerAccountId };
}

async function queueObservation(database, c, text="Supervisor directly observed the worker completing the competency safely and independently.") {
  const seeded=await seedCase(database,c);
  const service=new EvidenceReviewService(database);
  for(const [accountId,sessionId,role] of [[seeded.company.accountId,seeded.company.sessionId,"company"],[seeded.workerAccountId,`session_m202_worker_${c}`,"worker"]]){
    await database.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,$1,'active','fixture-hash',$3,$3,$3,$3)`,[accountId,accountId.toLowerCase()+"@supervisor.test",NOW]);
    await database.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)",[accountId,role,NOW]);
    await database.query(`INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,$3,$1,$1,$4,$4,$5)`,[sessionId,accountId,role,NOW,FUTURE]);
  }
  const {tenantId,membershipId}=seeded.company.tenantMembership;
  await database.query(`INSERT INTO platform_tenants(tenant_id,tenant_type,display_name,tenant_status,created_at,updated_at,activated_at) VALUES($1,'company','Supervisor test tenant','active',$2,$2,$2)`,[tenantId,NOW]);
  await database.query(`INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_at,updated_at,activated_at) VALUES($1,$2,$3,'company','owner','active',$4,$4,$4)`,[membershipId,tenantId,seeded.company.accountId,NOW]);
  const frameworkReference=`SUPERVISOR-${c}`;
  const observations=new SupervisorObservationService(Promise.resolve(database));
  const observationId=await observations.create(seeded.company,{
    caseId:seeded.caseId,observerMembershipId:membershipId,frameworkReference,
    competencyReference:`COMP-${c}`,taskReference:"Safe isolation",checklist:["Isolation proved"],
    observedAt:NOW_DATE,observationText:text,outcome:"demonstrated",
    supervisorDeclaration:"I personally observed the safe isolation task."
  },NOW_DATE);
  const worker={accountId:seeded.workerAccountId,sessionId:`session_m202_worker_${c}`,activeRole:"worker",accountStatus:"active",tenantMembership:null};
  await observations.acknowledge(worker,observationId,"I acknowledge the signed observation.",NOW_DATE);
  assert.equal(await service.queueCaseEvidence(seeded.company,seeded.caseId,NOW_DATE),0,"Acknowledgement already queued the exact signed version");
  const rows=await database.query(`SELECT task_id,source_version_id,source_record_id,task_status FROM evidence_review_tasks WHERE case_id=$1`,[seeded.caseId]);
  assert.equal(rows.rows.length,1);
  assert.equal(rows.rows[0].source_version_id,observationId);
  assert.equal(rows.rows[0].source_record_id,observationId);
  assert.equal(rows.rows[0].task_status,"QUEUED");
  return {...seeded,service,observations,worker,frameworkReference,observationId,taskId:rows.rows[0].task_id};
}

test("Actual PostgreSQL concurrent approval cannot overwrite a newly committed Admin escalation",{skip:!process.env.HSE_POSTGRES_TEST_DATABASE_URL,timeout:60000},async()=>{
 const url=new URL(process.env.HSE_POSTGRES_TEST_DATABASE_URL),name="review_race_"+Date.now()+"_"+process.pid;assert.match(name,/^review_race_[0-9_]+$/);
 const adminDb=await openScriptDatabase({...ENV,databaseDriver:"postgres",databaseUrl:url.href});
 await adminDb.execute('CREATE DATABASE "'+name+'"');url.pathname="/"+name;
 const first=await openScriptDatabase({...ENV,databaseDriver:"postgres",databaseUrl:url.href}),second=await openScriptDatabase({...ENV,databaseDriver:"postgres",databaseUrl:url.href});
 let releaseLock;const waitLock=new Promise(resolve=>{releaseLock=resolve;});let reachedLock;const atLock=new Promise(resolve=>{reachedLock=resolve;});
 try{
 await applyMigrationsThrough(first,ENV.releaseSha,"0118_scoring_assignment_notifications");
 const x=await queueObservation(first,"R"),approver=await seedVerifier(first,"A"),escalator=await seedVerifier(first,"B");
 const observation=await x.observations.create(x.company,{caseId:x.caseId,observerMembershipId:x.company.tenantMembership.membershipId,frameworkReference:x.frameworkReference,competencyReference:"COMP-RACE-SECOND",taskReference:"Safe isolation second task",checklist:["Isolation independently proved"],observedAt:NOW_DATE,observationText:"A second independent observation supports this competency clearly.",outcome:"demonstrated",supervisorDeclaration:"I personally observed the second safe isolation task."},NOW_DATE);
 await x.observations.acknowledge(x.worker,observation,"I acknowledge this second signed observation.",NOW_DATE);
 const secondTask=(await first.query("SELECT task_id FROM evidence_review_tasks WHERE source_version_id=$1",[observation])).rows[0].task_id;
 await authorizeReviewFixture(first,{taskId:secondTask,verifiers:[approver,escalator],at:NOW_DATE});
 await x.service.claim(escalator,x.taskId,NOW_DATE);await x.service.claim(approver,secondTask,NOW_DATE);
 let pause=true;
 const instrument=client=>({query:async(sql,params)=>{if(pause&&sql.includes("SELECT case_status")&&sql.includes("assurance_cases")&&sql.includes("FOR UPDATE")){pause=false;reachedLock();await waitLock;}return client.query(sql,params);},execute:(sql)=>client.execute(sql),transaction:fn=>client.transaction(tx=>fn(instrument(tx)))});
 const approving=new EvidenceReviewService(instrument(first)).decide(approver,secondTask,"APPROVED","Second observation independently verified.",NOW_DATE);
 await atLock;
 await new EvidenceReviewService(second).resolveReview(escalator,x.taskId,{expectedRevision:0,outcome:"ESCALATED",destination:"admin",reason:"Issuer uncertainty needs actual Admin review."},NOW_DATE);
 releaseLock();await approving;
 const row=(await first.query("SELECT case_status,owner_kind,next_action FROM assurance_cases WHERE case_id=$1",[x.caseId])).rows[0];assert.equal(row.owner_kind,"admin");assert.equal(row.case_status,"Review pending");assert.match(row.next_action,/Admin/);
 console.log("ACTUAL_POSTGRES_TWO_CLIENTS committed escalation survives delayed approval case lock");
 }finally{releaseLock();await first.close();await second.close();await adminDb.execute('DROP DATABASE "'+name+'"');await adminDb.close();}
});
