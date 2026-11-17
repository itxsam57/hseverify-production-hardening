import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import { ensureCompanyWorkforceRuntime } from "../helpers/company-workforce-runtime-bootstrap.mjs";

ensureCompanyWorkforceRuntime();
const runtime = process.env.HSE_COMPANY_WORKFORCE_RUNTIME_DIST;
assert.ok(runtime, "HSE_COMPANY_WORKFORCE_RUNTIME_DIST is required");
const serviceModule = await import(pathToFileURL(join(runtime, "company", "company-workforce-service.js")).href);
const domainModule = await import(pathToFileURL(join(runtime, "company", "company-workforce-domain.js")).href);
const receiverModule = await import(pathToFileURL(join(runtime, "company", "company-workforce-worker-read-repository.js")).href);
const { CompanyWorkforceWorkerReadRepository } = receiverModule;
const {
  CompanyWorkforceService,
  CompanyWorkforceAccessError,
  CompanyWorkforceConflictError,
  CompanyWorkforceSecretError
} = serviceModule;

const MIGRATION = "0028_company_worker_invitations_codes";
const NOW_DATE = new Date("2026-08-16T12:00:00.000Z");
const NOW = NOW_DATE.toISOString();
const FUTURE = "2099-01-01T00:00:00.000Z";
const PEPPER = "m1-10-company-workforce-test-pepper-with-more-than-thirty-two-characters";
const ENV = {
  appEnvironment: "test", databaseDriver: "pglite", databaseUrl: null,
  pgliteDataDir: "memory://", releaseSha: "m1-10-company-workforce-test",
  sessionSecret: "m1-10-company-workforce-session-secret-with-more-than-thirty-two-characters",
  authPepper: PEPPER, authSandboxEnabled: false, authSandboxAccessKey: null,
  demoAuthEnabled: false, demoDataEnabled: false
};
const oid = (prefix, c) => `${prefix}_${c.repeat(24)}`;

async function db() {
  const database = await openScriptDatabase(ENV);
  await applyMigrationsThrough(database, ENV.releaseSha, MIGRATION);
  return database;
}

async function seedCompany(database, c, verified = true) {
  const x = {
    accountId: `account_m110_company_${c}`,
    tenantId: oid("tenant", c),
    membershipId: oid("membership", c),
    sessionId: `session_m110_company_${c}`,
    email: `company-${c.toLowerCase()}@example.com`,
    displayName: `Company ${c}`
  };
  await database.query(`INSERT INTO auth_accounts
    (account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
    VALUES ($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [x.accountId,x.email,x.displayName,"scrypt$16384$8$1$salt$hash",NOW]);
  await database.query(`INSERT INTO auth_account_roles (account_id,role,created_at) VALUES ($1,'company',$2)`,[x.accountId,NOW]);
  await database.query(`INSERT INTO platform_tenants
    (tenant_id,tenant_type,display_name,tenant_status,created_by_account_id,created_at,updated_at,activated_at)
    VALUES ($1,'company',$2,'active',$3,$4,$4,$4)`,[x.tenantId,x.displayName,x.accountId,NOW]);
  await database.query(`INSERT INTO auth_tenant_memberships
    (membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at)
    VALUES ($1,$2,$3,'company','owner','active',$3,$4,$4,$4)`,[x.membershipId,x.tenantId,x.accountId,NOW]);
  await database.query(`INSERT INTO auth_sessions
    (session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at)
    VALUES ($1,$2,'company',$3,$4,$5,$5,$6)`,[x.sessionId,x.accountId,`tok-${c}`,`csrf-${c}`,NOW,FUTURE]);
  await database.query(`INSERT INTO company_verification_cases
    (case_id,tenant_id,owner_account_id,case_status,lock_version,created_at,updated_at,verified_at)
    VALUES ($1,$2,$3,$4,0,$5,$5,$6)`,
    [oid("company_verification",c),x.tenantId,x.accountId,verified?"verified":"draft",NOW,verified?NOW:null]);
  return x;
}

function companyPrincipal(x) {
  return Object.freeze({
    accountId:x.accountId,sessionId:x.sessionId,activeRole:"company",accountStatus:"active",
    email:x.email,displayName:x.displayName,createdAt:NOW,lastSeenAt:NOW,expiresAt:FUTURE,
    tenantMembership:{tenantId:x.tenantId,tenantStatus:"active",membershipId:x.membershipId,role:"owner",status:"active",overrides:[]},
    authorizedTenantPermission:"company.workforce.manage"
  });
}

async function seedWorker(database, c, email=`worker-${c.toLowerCase()}@example.com`) {
  const x={accountId:`account_m110_worker_${c}`,sessionId:`session_m110_worker_${c}`,email,displayName:`Worker ${c}`};
  await database.query(`INSERT INTO auth_accounts
    (account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
    VALUES ($1,$2,$3,'active',$4,$5,$5,$5,$5)`,[x.accountId,x.email,x.displayName,"scrypt$16384$8$1$salt$hash",NOW]);
  await database.query(`INSERT INTO auth_account_roles (account_id,role,created_at) VALUES ($1,'worker',$2)`,[x.accountId,NOW]);
  await database.query(`INSERT INTO auth_sessions
    (session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at)
    VALUES ($1,$2,'worker',$3,$4,$5,$5,$6)`,[x.sessionId,x.accountId,`worker-tok-${c}`,`worker-csrf-${c}`,NOW,FUTURE]);
  return x;
}
function workerPrincipal(x) {
  return Object.freeze({accountId:x.accountId,sessionId:x.sessionId,activeRole:"worker",accountStatus:"active",
    email:x.email,displayName:x.displayName,createdAt:NOW,lastSeenAt:NOW,expiresAt:FUTURE,tenantMembership:null});
}

async function seedUnits(database, company, c) {
  const siteId=oid("site",c), departmentId=oid("department",c);
  await database.query(`INSERT INTO company_sites
    (site_id,tenant_id,name,formatted_address,phone,website,email_normalized,registration_number,site_status,revision,created_by_membership_id,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',1,$9,$10,$10)`,
    [siteId,company.tenantId,`Site ${c}`,`Address ${c}`,"+92510000001",`https://site-${c}.example.com`,`site-${c}@example.com`,`SITE-${c}`,company.membershipId,NOW]);
  await database.query(`INSERT INTO company_departments
    (department_id,tenant_id,name,formatted_address,phone,website,email_normalized,registration_number,department_status,revision,created_by_membership_id,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',1,$9,$10,$10)`,
    [departmentId,company.tenantId,`Dept ${c}`,`Dept address ${c}`,"+92510000002",`https://dept-${c}.example.com`,`dept-${c}@example.com`,`DEPT-${c}`,company.membershipId,NOW]);
  return {siteId,departmentId};
}

async function seedPermanentWorkerId(database, worker, c) {
  const identityId=oid("worker_identity",c), versionId=oid("identity_version",c), checkId=oid("identity_duplicate_check",c), permanentWorkerId=oid("worker_id",c);
  await database.query(`INSERT INTO worker_identities
    (identity_id,worker_account_id,lifecycle_status,current_version_number,lock_version,created_at,updated_at)
    VALUES ($1,$2,'draft',1,1,$3,$3)`,[identityId,worker.accountId,NOW]);
  await database.query(`INSERT INTO worker_identity_versions
    (identity_version_id,identity_id,version_number,parent_version_id,version_kind,version_status,created_by_account_id,created_at,submitted_at)
    VALUES ($1,$2,1,NULL,'initial','submitted',$3,$4,$4)`,[versionId,identityId,worker.accountId,NOW]);
  for (const [status,lock] of [["submitted",2],["automated_checks",3],["manual_review",4],["verified",5]])
    await database.query(`UPDATE worker_identities SET lifecycle_status=$2,lock_version=$3 WHERE identity_id=$1`,[identityId,status,lock]);
  await database.query(`INSERT INTO worker_identity_duplicate_checks
    (check_id,identity_id,identity_version_id,worker_account_id,check_sequence,check_status,created_at)
    VALUES ($1,$2,$3,$4,1,'clear',$5)`,[checkId,identityId,versionId,worker.accountId,NOW]);
  await database.query(`INSERT INTO worker_identity_worker_ids
    (permanent_worker_id,identity_id,identity_version_id,worker_account_id,issued_by_component,issued_at)
    VALUES ($1,$2,$3,$4,'identity-assurance',$5)`,[permanentWorkerId,identityId,versionId,worker.accountId,NOW]);
  return permanentWorkerId;
}

for (const method of ["inviteWorker","bulkInviteWorkers","resendInvitation","revokeInvitation","createRegistrationCode","revokeRegistrationCode","acceptInvitation","redeemRegistrationCode","requestPermanentWorkerLink","acceptWorkerLink"])
  test(`M1.10 service exposes ${method} through one Company↔Worker authority`,()=>assert.equal(typeof CompanyWorkforceService?.prototype?.[method],"function"));

test("M1.10 domain keeps neutral errors and bounded payment responsibility",()=>{
  for(const name of ["CompanyWorkforceAccessError","CompanyWorkforceConflictError","CompanyWorkforceSecretError"])
    assert.equal(typeof domainModule[name],"function");
  assert.equal("CompanyWorkforceCrossTenantError" in domainModule,false);
  assert.deepEqual([...domainModule.COMPANY_WORKFORCE_PAYMENT_RESPONSIBILITIES].sort(),["company","worker"]);
});

test("invitation lifecycle proves live Company authority, same-tenant units, hash rotation and Worker email consent",async()=>{
  const database=await db();
  try{
    const a=await seedCompany(database,"A"), b=await seedCompany(database,"B"), u=await seedCompany(database,"U",false);
    const au=await seedUnits(database,a,"A"), bu=await seedUnits(database,b,"B");
    let clock=new Date(NOW_DATE); const service=new CompanyWorkforceService(database,PEPPER,()=>new Date(clock)); const principal=companyPrincipal(a);
    const invite=await service.inviteWorker(principal,{email:"Invited.Worker@Example.com ",siteId:au.siteId,departmentId:au.departmentId,paymentResponsibility:"company",assessmentReference:"future-ref"});
    const stored=await database.query(`SELECT token_hash FROM company_worker_invitations WHERE invitation_id=$1`,[invite.invitationId]);
    assert.ok(stored.rows[0]?.token_hash); assert.notEqual(stored.rows[0].token_hash,invite.invitationToken);
    await assert.rejects(service.inviteWorker(companyPrincipal(u),{email:"blocked@example.com",siteId:null,departmentId:null,paymentResponsibility:"worker",assessmentReference:null}),CompanyWorkforceAccessError);
    await assert.rejects(service.inviteWorker(principal,{email:"cross@example.com",siteId:bu.siteId,departmentId:null,paymentResponsibility:"worker",assessmentReference:null}),CompanyWorkforceAccessError);
    await database.query(`INSERT INTO auth_tenant_permission_overrides
      (membership_id,membership_role,permission_key,effect,created_by_account_id,reason,created_at)
      VALUES ($1,'owner','company.workforce.manage','deny',$2,'live permission removal',$3)`,[a.membershipId,a.accountId,NOW]);
    await assert.rejects(service.inviteWorker(principal,{email:"stale@example.com",siteId:null,departmentId:null,paymentResponsibility:"worker",assessmentReference:null}),CompanyWorkforceAccessError);
    await database.query(`DELETE FROM auth_tenant_permission_overrides WHERE membership_id=$1 AND permission_key='company.workforce.manage'`,[a.membershipId]);
    await assert.rejects(service.resendInvitation(principal,invite.invitationId),CompanyWorkforceConflictError);
    clock=new Date(NOW_DATE.getTime()+6*60*1000); const resent=await service.resendInvitation(principal,invite.invitationId); assert.notEqual(resent.invitationToken,invite.invitationToken);
    const wrong=await seedWorker(database,"X","wrong@example.com"); await assert.rejects(service.acceptInvitation(workerPrincipal(wrong),resent.invitationToken),CompanyWorkforceSecretError);
    const worker=await seedWorker(database,"M","invited.worker@example.com"); const link=await service.acceptInvitation(workerPrincipal(worker),resent.invitationToken);
    assert.equal(link.status,"active"); assert.equal(link.tenantId,a.tenantId); assert.equal(link.siteId,au.siteId);
    assert.equal((await service.acceptInvitation(workerPrincipal(worker),resent.invitationToken)).linkId,link.linkId);
    await assert.rejects(service.acceptInvitation(workerPrincipal(worker),invite.invitationToken),CompanyWorkforceSecretError);
  }finally{await database.close();}
});

test("Company codes prove hash-only storage, atomic one-use redemption, idempotency and revoke",async()=>{
  const database=await db();
  try{
    const company=await seedCompany(database,"C"), service=new CompanyWorkforceService(database,PEPPER,()=>new Date(NOW_DATE));
    const one=await seedWorker(database,"1"), two=await seedWorker(database,"2");
    const code=await service.createRegistrationCode(companyPrincipal(company),{usageLimit:1,expiresAt:"2026-08-20T12:00:00.000Z",siteId:null,departmentId:null,paymentResponsibility:"worker",assessmentReference:null});
    const hash=await database.query(`SELECT code_hash FROM company_registration_codes WHERE code_id=$1`,[code.codeId]); assert.notEqual(hash.rows[0]?.code_hash,code.registrationCode);
    const first=await service.redeemRegistrationCode(workerPrincipal(one),code.registrationCode); assert.equal(first.status,"active");
    assert.equal((await service.redeemRegistrationCode(workerPrincipal(one),code.registrationCode)).linkId,first.linkId);
    await assert.rejects(service.redeemRegistrationCode(workerPrincipal(two),code.registrationCode),CompanyWorkforceSecretError);
    const usage=await database.query(`SELECT usage_count,code_status FROM company_registration_codes WHERE code_id=$1`,[code.codeId]); assert.equal(usage.rows[0].usage_count,1); assert.equal(usage.rows[0].code_status,"exhausted");
    const rev=await service.createRegistrationCode(companyPrincipal(company),{usageLimit:2,expiresAt:"2026-08-20T12:00:00.000Z",siteId:null,departmentId:null,paymentResponsibility:"company",assessmentReference:null});
    await service.revokeRegistrationCode(companyPrincipal(company),rev.codeId); await service.revokeRegistrationCode(companyPrincipal(company),rev.codeId);
    await assert.rejects(service.redeemRegistrationCode(workerPrincipal(two),rev.registrationCode),CompanyWorkforceSecretError);
  }finally{await database.close();}
});

test("Company code last-slot race allows exactly one Worker",async()=>{
  const database=await db();
  try{
    const company=await seedCompany(database,"R"), service=new CompanyWorkforceService(database,PEPPER,()=>new Date(NOW_DATE));
    const code=await service.createRegistrationCode(companyPrincipal(company),{usageLimit:1,expiresAt:"2026-08-20T12:00:00.000Z",siteId:null,departmentId:null,paymentResponsibility:"worker",assessmentReference:null});
    const w1=await seedWorker(database,"3"),w2=await seedWorker(database,"4");
    const result=await Promise.allSettled([service.redeemRegistrationCode(workerPrincipal(w1),code.registrationCode),service.redeemRegistrationCode(workerPrincipal(w2),code.registrationCode)]);
    assert.equal(result.filter(x=>x.status==="fulfilled").length,1); assert.equal(result.filter(x=>x.status==="rejected").length,1);
    const stored=await database.query(`SELECT usage_count FROM company_registration_codes WHERE code_id=$1`,[code.codeId]); assert.equal(stored.rows[0].usage_count,1);
  }finally{await database.close();}
});

test("permanent Worker-ID request uses M1.07 authority and requires the matching Worker's consent",async()=>{
  const database=await db();
  try{
    const company=await seedCompany(database,"P"),worker=await seedWorker(database,"P"),other=await seedWorker(database,"Q");
    const permanentWorkerId=await seedPermanentWorkerId(database,worker,"P"), service=new CompanyWorkforceService(database,PEPPER,()=>new Date(NOW_DATE));
    const pending=await service.requestPermanentWorkerLink(companyPrincipal(company),permanentWorkerId,{email:worker.email,siteId:null,departmentId:null,paymentResponsibility:"company",assessmentReference:null});
    assert.equal(pending.status,"pending_worker_acceptance"); assert.equal(pending.workerAccountId,worker.accountId);
    await assert.rejects(service.acceptWorkerLink(workerPrincipal(other),pending.linkId),CompanyWorkforceAccessError);
    const acceptanceQueries=[];
    const observedDatabase={...database,query:database.query.bind(database),transaction:operation=>database.transaction(transaction=>operation({...transaction,query:async(sql,parameters)=>{acceptanceQueries.push(sql);return transaction.query(sql,parameters);}}))};
    const observedService=new CompanyWorkforceService(observedDatabase,PEPPER,()=>new Date(NOW_DATE));
    const active=await observedService.acceptWorkerLink(workerPrincipal(worker),pending.linkId); assert.equal(active.status,"active");
    const tenantLock=acceptanceQueries.findIndex(sql=>/FOR UPDATE OF cases, tenants/.test(sql));
    const linkLock=acceptanceQueries.findIndex(sql=>/FROM company_worker_links.*FOR UPDATE/s.test(sql));
    assert(tenantLock>=0 && linkLock>tenantLock,"acceptance must lock tenant before Worker link, matching Company archive order");
    console.log("ACTUAL_WORKER_ACCEPT_LOCK_ORDER real producer pending link accepted with tenant-before-link order");
    assert.equal((await service.acceptWorkerLink(workerPrincipal(worker),pending.linkId)).linkId,active.linkId);
    await assert.rejects(service.requestPermanentWorkerLink(companyPrincipal(company),oid("worker_id","Z"),{email:worker.email,siteId:null,departmentId:null,paymentResponsibility:"worker",assessmentReference:null}),CompanyWorkforceAccessError);
  }finally{await database.close();}
});

test("bulk invitation keeps row order and returns explicit malformed/duplicate row errors",async()=>{
  const database=await db();
  try{
    const company=await seedCompany(database,"L"), service=new CompanyWorkforceService(database,PEPPER,()=>new Date(NOW_DATE));
    const rows=await service.bulkInviteWorkers(companyPrincipal(company),[
      {email:"bulk-one@example.com",siteId:null,departmentId:null,paymentResponsibility:"worker",assessmentReference:null},
      {email:"not-an-email",siteId:null,departmentId:null,paymentResponsibility:"worker",assessmentReference:null},
      {email:" BULK-ONE@EXAMPLE.COM ",siteId:null,departmentId:null,paymentResponsibility:"worker",assessmentReference:null}
    ]);
    assert.deepEqual(rows.map(x=>x.rowNumber),[1,2,3]); assert.deepEqual(rows.map(x=>x.status),["created","error","error"]);
    const stored=await database.query(`SELECT email_normalized FROM company_worker_invitations WHERE tenant_id=$1`,[company.tenantId]); assert.deepEqual(stored.rows.map(x=>x.email_normalized),["bulk-one@example.com"]);
  }finally{await database.close();}
});


test("Company relationship termination requires live tenant authority, preserves Worker identity and history", async () => {
  const database = await db();
  try {
    const company = await seedCompany(database, "E");
    const outsider = await seedCompany(database, "F");
    const worker = await seedWorker(database, "E");
    const permanentWorkerId = await seedPermanentWorkerId(database, worker, "E");
    const service = new CompanyWorkforceService(database, PEPPER, () => new Date(NOW_DATE));
    const requested = await service.requestPermanentWorkerLink(
      companyPrincipal(company), permanentWorkerId,
      { email: worker.email, siteId: null, departmentId: null, paymentResponsibility: "worker", assessmentReference: null }
    );
    const accepted = await service.acceptWorkerLink(workerPrincipal(worker), requested.linkId);
    assert.equal(accepted.status, "active");

    const end = { linkId: accepted.linkId, effectiveDate: "2026-08-16",
      reason: "Employment ended after the agreed project completion." };
    await assert.rejects(service.endWorkerRelationship(companyPrincipal(outsider), end), CompanyWorkforceAccessError);
    await assert.rejects(service.endWorkerRelationship(companyPrincipal(company), {...end, reason: "short"}), domainModule.CompanyWorkforceInputError);
    await assert.rejects(service.endWorkerRelationship(companyPrincipal(company), {...end, effectiveDate: "2026-08-17"}), domainModule.CompanyWorkforceInputError);
    await assert.rejects(service.endWorkerRelationship(companyPrincipal(company), {...end, effectiveDate: "2026-02-01"}), domainModule.CompanyWorkforceInputError);
    const before = await database.query("SELECT link_status FROM company_worker_links WHERE link_id=$1", [accepted.linkId]);
    assert.equal(before.rows[0].link_status, "active");
    await service.endWorkerRelationship(companyPrincipal(company), end);
    const after = await database.query(
      "SELECT link_status,revoked_at,worker_account_id,permanent_worker_id FROM company_worker_links WHERE link_id=$1",
      [accepted.linkId]
    );
    assert.equal(after.rows[0].link_status, "revoked");
    assert.ok(after.rows[0].revoked_at);
    assert.equal(after.rows[0].worker_account_id, worker.accountId);
    assert.equal(after.rows[0].permanent_worker_id, permanentWorkerId);
    const untouched = await database.query("SELECT permanent_worker_id FROM worker_identity_worker_ids WHERE worker_account_id=$1",[worker.accountId]);
    assert.equal(untouched.rows[0].permanent_worker_id,permanentWorkerId);
    const events = await database.query(
      "SELECT actor_account_id,actor_tenant_id,metadata FROM platform_audit_events WHERE action_key='company_workforce.link.revoked' AND target_reference=$1",
      [accepted.linkId]
    );
    assert.equal(events.rows.length,1);
    assert.equal(events.rows[0].actor_account_id,company.accountId);
    assert.equal(events.rows[0].actor_tenant_id,company.tenantId);
    const metadata=typeof events.rows[0].metadata==="string"?JSON.parse(events.rows[0].metadata):events.rows[0].metadata;
    assert.equal(metadata.reason,end.reason);
    assert.equal(metadata.effectiveDate,end.effectiveDate);
    await assert.rejects(service.endWorkerRelationship(companyPrincipal(company),end),CompanyWorkforceConflictError);
    const eventsAfter = await database.query("SELECT COUNT(*)::int AS n FROM platform_audit_events WHERE action_key='company_workforce.link.revoked' AND target_reference=$1",[accepted.linkId]);
    assert.equal(eventsAfter.rows[0].n,1);
  } finally { await database.close(); }
});

test("Company transfer after termination creates only a new consented link, retaining the previous employer history", async () => {
  const database = await db();
  try {
    const oldCompany = await seedCompany(database, "G");
    const newCompany = await seedCompany(database, "H");
    const worker = await seedWorker(database, "G");
    const permanentWorkerId = await seedPermanentWorkerId(database, worker, "G");
    const service = new CompanyWorkforceService(database, PEPPER, () => new Date(NOW_DATE));
    const defaults = {email:worker.email,siteId:null,departmentId:null,paymentResponsibility:"worker",assessmentReference:null};

    const oldRequested = await service.requestPermanentWorkerLink(companyPrincipal(oldCompany),permanentWorkerId,defaults);
    const oldLink = await service.acceptWorkerLink(workerPrincipal(worker),oldRequested.linkId);
    assert.equal(oldLink.status,"active");
    await service.endWorkerRelationship(companyPrincipal(oldCompany),{
      linkId:oldLink.linkId,effectiveDate:"2026-08-16",
      reason:"Worker completed the assignment and moved to a different employer."
    });
    const nextRequested = await service.requestPermanentWorkerLink(companyPrincipal(newCompany),permanentWorkerId,defaults);
    const beforeConsent = await database.query("SELECT link_status FROM company_worker_links WHERE link_id=$1",[nextRequested.linkId]);
    assert.equal(beforeConsent.rows[0].link_status,"pending_worker_acceptance");
    assert.notEqual(nextRequested.linkId,oldLink.linkId);
    const newLink = await service.acceptWorkerLink(workerPrincipal(worker),nextRequested.linkId);
    assert.equal(newLink.status,"active");
    const links = await database.query("SELECT tenant_id,link_status,worker_account_id,permanent_worker_id FROM company_worker_links WHERE worker_account_id=$1 ORDER BY tenant_id",[worker.accountId]);
    assert.deepEqual(links.rows.map(x=>[x.tenant_id,x.link_status]),[
      [oldCompany.tenantId,"revoked"],[newCompany.tenantId,"active"]
    ]);
    assert.ok(links.rows.every(x=>x.worker_account_id===worker.accountId&&x.permanent_worker_id===permanentWorkerId));
    const oldAudit = await database.query("SELECT COUNT(*)::int AS n FROM platform_audit_events WHERE action_key='company_workforce.link.revoked' AND target_reference=$1",[oldLink.linkId]);
    assert.equal(oldAudit.rows[0].n,1);
  } finally { await database.close(); }
});

test("M1.08.02 preissued Company code and invitation cannot be redeemed while tenant pending and resume after activation",async()=>{
  const database=await db();
  try{
    const company=await seedCompany(database,"S");
    const invitedWorker=await seedWorker(database,"T");
    const codeWorker=await seedWorker(database,"U");
    const service=new CompanyWorkforceService(database,PEPPER,()=>new Date(NOW_DATE));
    const invitation=await service.inviteWorker(companyPrincipal(company),{
      email:invitedWorker.email,siteId:null,departmentId:null,
      paymentResponsibility:"worker",assessmentReference:null
    });
    const code=await service.createRegistrationCode(companyPrincipal(company),{
      usageLimit:2,expiresAt:"2026-08-20T12:00:00.000Z",siteId:null,
      departmentId:null,paymentResponsibility:"worker",assessmentReference:null
    });
    const initial=(await database.query(
      "SELECT usage_count,code_status FROM company_registration_codes WHERE code_id=$1",
      [code.codeId]
    )).rows;
    assert.deepEqual(initial,[{usage_count:0,code_status:"active"}]);
    await database.query(
      "UPDATE platform_tenants SET tenant_status='pending',activated_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=$1",
      [company.tenantId]
    );
    await assert.rejects(
      service.redeemRegistrationCode(workerPrincipal(codeWorker),code.registrationCode),
      CompanyWorkforceAccessError,
      "An active, valid Company registration code becomes unusable when the tenant is suspended."
    );
    await assert.rejects(
      service.acceptInvitation(workerPrincipal(invitedWorker),invitation.invitationToken),
      CompanyWorkforceAccessError,
      "A valid Company invitation cannot enroll a Worker while its tenant is pending."
    );
    assert.deepEqual((await database.query(
      "SELECT usage_count,code_status FROM company_registration_codes WHERE code_id=$1",
      [code.codeId]
    )).rows,initial,"Rejected pending-tenant code must not consume capacity or revoke the token.");
    assert.deepEqual((await database.query(
      "SELECT invitation_status,accepted_by_worker_account_id FROM company_worker_invitations WHERE invitation_id=$1",
      [invitation.invitationId]
    )).rows,[{invitation_status:"pending",accepted_by_worker_account_id:null}]);
    assert.equal((await database.query(
      "SELECT count(*)::int n FROM company_worker_links WHERE tenant_id=$1",
      [company.tenantId]
    )).rows[0].n,0,"Neither preissued onboarding route may create a link during suspension.");
    assert.equal((await database.query(
      "SELECT count(*)::int n FROM platform_audit_events WHERE action_key IN "+
      "('company_workforce.code.redeemed','company_workforce.invitation.accepted') "+
      "AND target_reference=ANY($1::text[])",
      [[code.codeId,invitation.invitationId]]
    )).rows[0].n,0,"Denied secret redemption cannot fabricate successful audit.");
    assert.equal((await database.query(
      "SELECT count(*)::int n FROM auth_sessions WHERE account_id=ANY($1::text[]) AND revoked_at IS NULL",
      [[invitedWorker.accountId,codeWorker.accountId]]
    )).rows[0].n,2,"Pending tenant cannot revoke independent Workers' authentication.");
    console.log("M10802_PREISSUED_PENDING_NO_CODE_OR_INVITATION_CONSUMPTION",
      "active preissued code and invitation both denied while Company tenant pending, zero links, zero usage and zero accept/redeem audits; both signed Worker sessions retained");

    await database.query(
      "UPDATE platform_tenants SET tenant_status='active',activated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=$1",
      [company.tenantId]
    );
    const acceptedInvite=await service.acceptInvitation(workerPrincipal(invitedWorker),invitation.invitationToken);
    const redeemed=await service.redeemRegistrationCode(workerPrincipal(codeWorker),code.registrationCode);
    assert.equal(acceptedInvite.tenantId,company.tenantId);
    assert.equal(acceptedInvite.workerAccountId,invitedWorker.accountId);
    assert.equal(redeemed.tenantId,company.tenantId);
    assert.equal(redeemed.workerAccountId,codeWorker.accountId);
    assert.notEqual(acceptedInvite.linkId,redeemed.linkId);
    assert.equal(acceptedInvite.status,"active");
    assert.equal(redeemed.status,"active");
    assert.deepEqual((await database.query(
      "SELECT worker_account_id,link_status FROM company_worker_links WHERE tenant_id=$1 ORDER BY worker_account_id",
      [company.tenantId]
    )).rows,[
      {worker_account_id:invitedWorker.accountId,link_status:"active"},
      {worker_account_id:codeWorker.accountId,link_status:"active"}
    ]);
    assert.deepEqual((await database.query(
      "SELECT usage_count,code_status FROM company_registration_codes WHERE code_id=$1",
      [code.codeId]
    )).rows,[{usage_count:1,code_status:"active"}]);
    assert.equal((await database.query(
      "SELECT count(*)::int n FROM platform_audit_events WHERE action_key IN "+
      "('company_workforce.code.redeemed','company_workforce.invitation.accepted') "+
      "AND target_reference=ANY($1::text[])",
      [[code.codeId,invitation.invitationId]]
    )).rows[0].n,2);
    console.log("M10802_REACTIVATION_PREISSUED_SECRETS_SCOPED_RETRY",
      "after verified tenant activation, original code and invitation each enroll only intended independent Worker, exact two links and two accepted audits, single code use");
  }finally{await database.close();}
});

async function m11001ActualPostgres16(scenario="M11001") {
  const raw=process.env[`HSE_${scenario}_POSTGRES_TEST_DATABASE_URL`];
  if(!raw)throw new Error("M11001 real PG16 requires explicitly approved isolated localhost Postgres.");
  const url=new URL(raw);
  if(!["127.0.0.1","localhost"].includes(url.hostname)||url.pathname!=="/postgres"){
    throw new Error("M11001 must never open shared application or external PostgreSQL.");
  }
  const root=await openScriptDatabase({...ENV,databaseDriver:"postgres",databaseUrl:url.href,releaseSha:"m11001-pg16-root"});
  const dbName=scenario.toLowerCase()+"_invite_race_"+process.pid+"_"+Date.now();
  let created=false,first,second;
  try{
    await root.execute('CREATE DATABASE "'+dbName+'"');created=true;
    url.pathname="/"+dbName;
    const e={...ENV,databaseDriver:"postgres",databaseUrl:url.href,
      releaseSha:"m11001-real-invite-race-"+process.pid};
    first=await openScriptDatabase(e);
    await applyMigrationsThrough(first,e.releaseSha,["M11005","M11006"].includes(scenario)?"0134_company_worker_placement_audit":"0133_company_team_access_revision_cas");
    second=await openScriptDatabase(e);
    return {first,second,cleanup:async()=>{
      try{await second.close();}
      finally{try{await first.close();}
        finally{try{await root.execute('DROP DATABASE "'+dbName+'"');}
          finally{await root.close();}}}
    }};
  }catch(error){
    if(second)await second.close();if(first)await first.close();
    try{if(created)await root.execute('DROP DATABASE "'+dbName+'"');}
    finally{await root.close();}
    throw error;
  }
}

function m11001HoldSuccessfulTransaction(client){
  let signal,release;
  const ready=new Promise(resolve=>{signal=resolve;});
  const permit=new Promise(resolve=>{release=resolve;});
  const wrapped={transaction:callback=>client.transaction(async tx=>{
    const result=await callback(tx);
    signal();await permit;
    return result;
  })};
  return {wrapped,ready,release};
}

test("M1.10.01 actual PostgreSQL16 Worker accept versus Owner revoke and resend races serialize with immutable cross-role evidence",{
  skip:!process.env.HSE_M11001_POSTGRES_TEST_DATABASE_URL,timeout:190000
},async()=>{
  const {first,second,cleanup}=await m11001ActualPostgres16();
  let releaseHeld;
  try{
    const owner=await seedCompany(first,"Q"),foreign=await seedCompany(first,"F");
    const workers=[];
    for(const c of ["A","B","C","D","E"]){
      workers.push(await seedWorker(first,c,"m11001-pg16-"+c.toLowerCase()+"@example.test"));
    }
    const pCompany=companyPrincipal(owner),pForeign=companyPrincipal(foreign);
    const serviceOne=new CompanyWorkforceService(first,PEPPER,()=>new Date(NOW_DATE));
    const serviceTwo=new CompanyWorkforceService(second,PEPPER,()=>new Date(NOW_DATE));
    const inviteData=email=>({email,siteId:null,departmentId:null,
      paymentResponsibility:"company",assessmentReference:"M11001-PG16"});
    const invitedA=await serviceOne.inviteWorker(pCompany,inviteData(workers[0].email));

    // Worker accept completes its writes but stays uncommitted. Owner revoke
    // on another SQL connection must wait; it cannot undo a committed accept.
    const holdWorker=m11001HoldSuccessfulTransaction(first);
    releaseHeld=holdWorker.release;
    const workerHeld=new CompanyWorkforceService(holdWorker.wrapped,PEPPER,()=>new Date(NOW_DATE));
    const accepting=workerHeld.acceptInvitation(workerPrincipal(workers[0]),invitedA.invitationToken);
    await holdWorker.ready;
    const competingRevoke=serviceTwo.revokeInvitation(pCompany,invitedA.invitationId)
      .then(()=>({ok:true}),error=>({ok:false,error}));
    const earlyRevoke=await Promise.race([competingRevoke.then(()=>({finished:true})),
      new Promise(resolve=>setTimeout(()=>resolve({waiting:true}),300))]);
    assert.equal(earlyRevoke.waiting,true,"Owner revoke must block until Worker acceptance transaction commits");
    holdWorker.release();releaseHeld=null;
    const aLink=await accepting;
    assert.equal(aLink.status,"active");
    const revokeAfterAccept=await competingRevoke;
    assert.equal(revokeAfterAccept.ok,false);
    assert.equal(revokeAfterAccept.error?.name,"CompanyWorkforceConflictError");
    const aReplay=await serviceTwo.acceptInvitation(workerPrincipal(workers[0]),invitedA.invitationToken);
    assert.equal(aReplay.linkId,aLink.linkId,"Retrying accepted invitation by same Worker must be idempotent");
    await assert.rejects(serviceTwo.acceptInvitation(workerPrincipal(workers[4]),invitedA.invitationToken),
      error=>error?.name==="CompanyWorkforceSecretError");
    console.log("M11001_ACTUAL_PG16_WORKER_ACCEPT_COMMIT_WINS_OWNER_REVOKE_BLOCKED_AND_REPLAY_ONE_LINK");

    // Opposite interleaving: Owner revoke writes, then holds the transaction;
    // Worker tries the now-revoked invitation on a separate SQL connection.
    const invitedB=await serviceOne.inviteWorker(pCompany,inviteData(workers[1].email));
    const holdOwner=m11001HoldSuccessfulTransaction(first);
    releaseHeld=holdOwner.release;
    const ownerHeld=new CompanyWorkforceService(holdOwner.wrapped,PEPPER,()=>new Date(NOW_DATE));
    const revoking=ownerHeld.revokeInvitation(pCompany,invitedB.invitationId);
    await holdOwner.ready;
    const conflictingAccept=serviceTwo.acceptInvitation(workerPrincipal(workers[1]),invitedB.invitationToken)
      .then(value=>({ok:true,value}),error=>({ok:false,error}));
    const earlyAccept=await Promise.race([conflictingAccept.then(()=>({finished:true})),
      new Promise(resolve=>setTimeout(()=>resolve({waiting:true}),300))]);
    assert.equal(earlyAccept.waiting,true,"Worker must wait until Owner revocation commits");
    holdOwner.release();releaseHeld=null;
    await revoking;
    const afterRevoke=await conflictingAccept;
    assert.equal(afterRevoke.ok,false,"Revoked invitation must never link Worker");
    assert.equal(afterRevoke.error?.name,"CompanyWorkforceSecretError");
    assert.equal((await first.query("SELECT COUNT(*)::integer AS n FROM company_worker_links WHERE worker_account_id=$1",[workers[1].accountId])).rows[0].n,0);
    console.log("M11001_ACTUAL_PG16_OWNER_REVOKE_COMMIT_WINS_WORKER_ACCEPT_BLOCKED_NO_LINK");

    // Resend commits a new token under the same locked invitation row. A
    // simultaneous Worker with the original token cannot bypass rotation.
    const invitedC=await serviceOne.inviteWorker(pCompany,inviteData(workers[2].email));
    const later=new Date(NOW_DATE.getTime()+6*60*1000);
    const holdResend=m11001HoldSuccessfulTransaction(first);
    releaseHeld=holdResend.release;
    const ownerResend=new CompanyWorkforceService(holdResend.wrapped,PEPPER,()=>new Date(later));
    const workerLater=new CompanyWorkforceService(second,PEPPER,()=>new Date(later));
    const resending=ownerResend.resendInvitation(pCompany,invitedC.invitationId);
    await holdResend.ready;
    const staleWorker=workerLater.acceptInvitation(workerPrincipal(workers[2]),invitedC.invitationToken)
      .then(value=>({ok:true,value}),error=>({ok:false,error}));
    const earlyStale=await Promise.race([staleWorker.then(()=>({finished:true})),
      new Promise(resolve=>setTimeout(()=>resolve({waiting:true}),300))]);
    assert.equal(earlyStale.waiting,true,"Original token must block while Owner rotates it");
    holdResend.release();releaseHeld=null;
    const fresh=await resending;
    assert.notEqual(fresh.invitationToken,invitedC.invitationToken);
    const oldWorker=await staleWorker;
    assert.equal(oldWorker.ok,false,"Stale token must fail after concurrent resend");
    assert.equal(oldWorker.error?.name,"CompanyWorkforceSecretError");
    const cLink=await workerLater.acceptInvitation(workerPrincipal(workers[2]),fresh.invitationToken);
    assert.equal(cLink.status,"active");
    await assert.rejects(serviceOne.revokeInvitation(pForeign,invitedC.invitationId),
      error=>error?.name==="CompanyWorkforceAccessError");
    await assert.rejects(serviceTwo.acceptInvitation(pCompany,fresh.invitationToken),
      error=>error?.name==="CompanyWorkforceAccessError");
    console.log("M11001_ACTUAL_PG16_CONCURRENT_RESEND_ROTATES_TOKEN_OLD_WORKER_REPLAY_BLOCKED_FOREIGN_ROLE_DENIED");

    // Actual expiry against the authoritative DB clock, no test sleeps.
    const invitedD=await serviceOne.inviteWorker(pCompany,inviteData(workers[3].email));
    const afterExpiry=new Date(NOW_DATE.getTime()+8*86400000);
    const expiredWorker=new CompanyWorkforceService(second,PEPPER,()=>new Date(afterExpiry));
    await assert.rejects(expiredWorker.acceptInvitation(workerPrincipal(workers[3]),invitedD.invitationToken),
      error=>error?.name==="CompanyWorkforceSecretError");
    const ownerAfterExpiry=new CompanyWorkforceService(first,PEPPER,()=>new Date(afterExpiry));
    const replacement=await ownerAfterExpiry.inviteWorker(pCompany,inviteData(workers[3].email));
    assert.notEqual(replacement.invitationId,invitedD.invitationId);
    await assert.rejects(expiredWorker.acceptInvitation(workerPrincipal(workers[3]),invitedD.invitationToken),
      error=>error?.name==="CompanyWorkforceSecretError");
    console.log("M11001_ACTUAL_PG16_EXPIRED_TOKEN_DENIED_DURABLE_EXPIRY_AND_FRESH_INVITATION");

    // Read the authoritative Company + Worker receiving records and actual
    // immutable audit across both roles, including no success for failures.
    const status=await first.query("SELECT invitation_id,email_normalized,invitation_status,resend_count,accepted_by_worker_account_id,token_hash "+
      "FROM company_worker_invitations WHERE tenant_id=$1 ORDER BY email_normalized,created_at",
      [owner.tenantId]);
    const byId=new Map(status.rows.map(row=>[row.invitation_id,row]));
    assert.equal(byId.get(invitedA.invitationId)?.invitation_status,"accepted");
    assert.equal(byId.get(invitedB.invitationId)?.invitation_status,"revoked");
    assert.equal(byId.get(invitedC.invitationId)?.invitation_status,"accepted");
    assert.equal(Number(byId.get(invitedC.invitationId)?.resend_count),1);
    assert.equal(byId.get(invitedD.invitationId)?.invitation_status,"expired");
    assert.equal(byId.get(replacement.invitationId)?.invitation_status,"pending");
    assert.equal(byId.get(invitedA.invitationId)?.accepted_by_worker_account_id,workers[0].accountId);
    assert.equal(byId.get(invitedC.invitationId)?.accepted_by_worker_account_id,workers[2].accountId);
    const links=await first.query("SELECT worker_account_id,link_status,invitation_id "+
      "FROM company_worker_links WHERE tenant_id=$1 ORDER BY worker_account_id",[owner.tenantId]);
    assert.deepEqual(links.rows.map(row=>[row.worker_account_id,row.link_status]),[
      [workers[0].accountId,"active"],[workers[2].accountId,"active"]
    ]);
    const audits=await first.query("SELECT action_key,actor_account_id,target_reference "+
      "FROM platform_audit_events WHERE target_reference IN ("+
      "SELECT invitation_id FROM company_worker_invitations WHERE tenant_id=$1) "+
      "AND action_key LIKE 'company_workforce.invitation.%' ORDER BY audit_sequence",[owner.tenantId]);
    const types=audits.rows.map(row=>row.action_key);
    const occurrences=(name)=>types.filter(x=>x===name).length;
    assert.equal(occurrences("company_workforce.invitation.accepted"),2,
      "Wrong Worker, replay, revoked and expired attempts cannot emit a successful accept audit");
    assert.equal(occurrences("company_workforce.invitation.revoked"),1);
    assert.equal(occurrences("company_workforce.invitation.resent"),1);
    assert.equal(occurrences("company_workforce.invitation.created"),5);
    assert.deepEqual(audits.rows.filter(x=>x.action_key==="company_workforce.invitation.accepted")
      .map(x=>x.actor_account_id),[workers[0].accountId,workers[2].accountId]);
    assert(audits.rows.filter(x=>x.action_key!=="company_workforce.invitation.accepted")
      .every(x=>x.actor_account_id===owner.accountId),
      "All Company issuer audit actions must name the authenticated Company Owner");
    console.log("M11001_ACTUAL_PG16_ALL_FIVE_STATES_TWO_LINKS_EXACT_WORKER_COMPANY_IMMUTABLE_AUDIT");
  }finally{
    if(releaseHeld)releaseHeld();
    await cleanup();
  }
});

test("M1.10.02 actual PostgreSQL16 concurrent Company bulk CSV duplicate recovery blocks stale sessions and cross-tenant units",{
  skip:!process.env.HSE_M11002_POSTGRES_TEST_DATABASE_URL,timeout:170000
},async()=>{
  const {first,second,cleanup}=await m11001ActualPostgres16("M11002");
  let releaseHeld;
  try{
    const owner=await seedCompany(first,"K"),foreign=await seedCompany(first,"Z");
    const worker=await seedWorker(first,"K","m11002-pg-worker@example.test");
    const site=await seedUnits(first,owner,"K");
    const principalOwner=companyPrincipal(owner),principalForeign=companyPrincipal(foreign);
    const anotherSession="session_m11002_same_owner_second";
    await first.query("INSERT INTO auth_sessions "+
      "(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) "+
      "VALUES($1,$2,'company',$3,$4,$5,$5,$6)",
      [anotherSession,owner.accountId,"m11002-second-owner-token","m11002-second-owner-csrf",NOW,FUTURE]);
    const anotherPrincipal=Object.freeze({...principalOwner,sessionId:anotherSession});
    const input=(email,siteId=site.siteId)=>({
      email,siteId,departmentId:null,paymentResponsibility:"company",assessmentReference:"M11002-PG-BULK"
    });
    const holding=m11001HoldSuccessfulTransaction(first);
    releaseHeld=holding.release;
    const serviceHeld=new CompanyWorkforceService(holding.wrapped,PEPPER,()=>new Date(NOW_DATE));
    const serviceSecond=new CompanyWorkforceService(second,PEPPER,()=>new Date(NOW_DATE));
    const firstBatch=serviceHeld.bulkInviteWorkers(principalOwner,[
      input("m11002-pg-common@example.test"),
      input("not-an-email"),
      input(" M11002-PG-COMMON@EXAMPLE.TEST "),
      input("m11002-pg-b@example.test")
    ]);
    await holding.ready;
    const secondBatch=serviceSecond.bulkInviteWorkers(anotherPrincipal,[
      input("M11002-PG-COMMON@example.test"),
      input("m11002-pg-c@example.test")
    ]);
    const early=await Promise.race([
      secondBatch.then(()=>({finished:true})),
      new Promise(resolve=>setTimeout(()=>resolve({waiting:true}),300))
    ]);
    assert.equal(early.waiting,true,"Other signed Company session must wait on the first real SQL row/tenant lock");
    holding.release();releaseHeld=null;
    const a=await firstBatch,b=await secondBatch;
    assert.deepEqual(a.map(x=>[x.rowNumber,x.status]),[
      [1,"created"],[2,"error"],[3,"error"],[4,"created"]
    ]);
    assert.deepEqual(b.map(x=>[x.rowNumber,x.status]),[
      [1,"error"],[2,"created"]
    ]);
    assert.match(a[1].message,/valid Worker email/);
    assert.match(a[2].message,/Duplicate Worker email/);
    console.log("M11002_ACTUAL_PG16_TWO_AUTHENTICATED_COMPANY_SESSIONS_CONCURRENT_BULK_ONE_WINNER_DUPLICATE_DENIED");

    const retry=await serviceSecond.bulkInviteWorkers(principalOwner,[
      input("m11002-pg-b@example.test"),input("m11002-pg-fixed@example.test")
    ]);
    assert.deepEqual(retry.map(x=>x.status),["error","created"]);
    assert.equal(retry[0].invitationId,null);
    const forgedRole=await serviceSecond.bulkInviteWorkers(workerPrincipal(worker),[
      input("m11002-pg-role-spoof@example.test")
    ]);
    assert.deepEqual(forgedRole.map(x=>x.status),["error"]);
    const foreignSite=await serviceSecond.bulkInviteWorkers(principalForeign,[
      input("m11002-pg-foreign@example.test",site.siteId)
    ]);
    assert.deepEqual(foreignSite.map(x=>x.status),["error"]);
    await second.query("UPDATE auth_sessions SET revoked_at=$2,revocation_reason='M11002 controlled revoked-session QA' WHERE session_id=$1",
      [anotherSession,NOW]);
    const revokedSession=await serviceSecond.bulkInviteWorkers(anotherPrincipal,[
      input("m11002-pg-revoked-session@example.test")
    ]);
    assert.deepEqual(revokedSession.map(x=>x.status),["error"]);
    console.log("M11002_ACTUAL_PG16_CORRECTED_RETRY_ONE_NEW_WRONG_ROLE_FOREIGN_SITE_REVOKED_SESSION_DENIED");

    const invitationRows=(await first.query("SELECT invitation_id,tenant_id,email_normalized,invitation_status,site_id,"+
      "payment_responsibility,assessment_reference FROM company_worker_invitations "+
      "WHERE tenant_id=$1 ORDER BY email_normalized",[owner.tenantId])).rows;
    assert.deepEqual(invitationRows.map(x=>x.email_normalized),[
      "m11002-pg-b@example.test","m11002-pg-c@example.test","m11002-pg-common@example.test","m11002-pg-fixed@example.test"
    ]);
    assert(invitationRows.every(x=>x.tenant_id===owner.tenantId && x.invitation_status==="pending" &&
      x.site_id===site.siteId && x.payment_responsibility==="company" &&
      x.assessment_reference==="M11002-PG-BULK"));
    assert.equal((await first.query("SELECT COUNT(*)::integer AS n FROM company_worker_invitations WHERE tenant_id=$1",
      [foreign.tenantId])).rows[0].n,0);
    const audits=(await first.query("SELECT action_key,actor_account_id,target_reference FROM platform_audit_events "+
      "WHERE target_reference IN (SELECT invitation_id FROM company_worker_invitations WHERE tenant_id=$1) "+
      "AND action_key='company_workforce.invitation.created' ORDER BY audit_sequence",[owner.tenantId])).rows;
    assert.equal(audits.length,4,"Each accepted valid distinct row creates exactly one immutable audit, no duplicate/denied success");
    assert(audits.every(x=>x.actor_account_id===owner.accountId));
    assert.deepEqual([...new Set(audits.map(x=>x.target_reference))].sort(),
      invitationRows.map(x=>x.invitation_id).sort());
    console.log("M11002_ACTUAL_PG16_DB_EXACT_FOUR_PENDING_ONE_PER_DISTINCT_VALID_ROW_AND_IMMUTABLE_OWNER_AUDIT");
  }finally{
    if(releaseHeld)releaseHeld();
    await cleanup();
  }
});

test("M1.10.03 actual PostgreSQL16 Worker last-slot race enforces code expiry usage/default Site Department and immutable cross-role audit",{
  skip:!process.env.HSE_M11003_POSTGRES_TEST_DATABASE_URL,timeout:180000
},async()=>{
  const {first,second,cleanup}=await m11001ActualPostgres16("M11003");
  let releaseHeld;
  try{
    const owner=await seedCompany(first,"M"),foreign=await seedCompany(first,"N");
    const units=await seedUnits(first,owner,"M");
    const foreignUnits=await seedUnits(first,foreign,"N");
    const a=await seedWorker(first,"P","m11003-pg-a@example.test");
    const b=await seedWorker(first,"Q","m11003-pg-b@example.test");
    const c=await seedWorker(first,"R","m11003-pg-c@example.test");
    const d=await seedWorker(first,"S","m11003-pg-d@example.test");
    const wrong=await seedWorker(first,"T","m11003-pg-evil@example.test");
    const pOwner=companyPrincipal(owner),pForeign=companyPrincipal(foreign);
    const svc1=new CompanyWorkforceService(first,PEPPER,()=>new Date(NOW_DATE));
    const svc2=new CompanyWorkforceService(second,PEPPER,()=>new Date(NOW_DATE));
    const make=(limit,siteId=units.siteId,departmentId=units.departmentId,expiresAt="2026-08-20T12:00:00.000Z")=>
      ({usageLimit:limit,expiresAt,siteId,departmentId,paymentResponsibility:"company",assessmentReference:"M11003-PG"});
    for(const bad of [make(0),make(10001),make(1,foreignUnits.siteId),make(1,units.siteId,foreignUnits.departmentId),
      make(1,units.siteId,units.departmentId,"2026-08-16T11:00:00.000Z"),
      make(1,units.siteId,units.departmentId,"2027-08-16T12:00:00.000Z")]){
      await assert.rejects(svc1.createRegistrationCode(pOwner,bad),
        error=>["CompanyWorkforceInputError","CompanyWorkforceAccessError"].includes(error?.name));
    }
    await assert.rejects(svc1.createRegistrationCode(workerPrincipal(wrong),make(1)),
      error=>error?.name==="CompanyWorkforceAccessError");
    console.log("M11003_ACTUAL_PG16_INVALID_CODE_LIMIT_EXPIRY_FOREIGN_SITE_DEPARTMENT_WRONG_ROLE_DENIED");

    const code=await svc1.createRegistrationCode(pOwner,make(1));
    const rawStored=(await first.query("SELECT code_hash,site_id,department_id,usage_limit,usage_count FROM company_registration_codes WHERE code_id=$1",[code.codeId])).rows[0];
    assert.notEqual(rawStored.code_hash,code.registrationCode);
    assert.equal(rawStored.site_id,units.siteId);
    assert.equal(rawStored.department_id,units.departmentId);
    assert.equal(Number(rawStored.usage_count),0);
    const hold=m11001HoldSuccessfulTransaction(first);
    releaseHeld=hold.release;
    const svcHeld=new CompanyWorkforceService(hold.wrapped,PEPPER,()=>new Date(NOW_DATE));
    const workerA=svcHeld.redeemRegistrationCode(workerPrincipal(a),code.registrationCode);
    await hold.ready;
    const workerB=svc2.redeemRegistrationCode(workerPrincipal(b),code.registrationCode)
      .then(value=>({ok:true,value}),error=>({ok:false,error}));
    const premature=await Promise.race([workerB.then(()=>({done:true})),new Promise(resolve=>setTimeout(()=>resolve({waiting:true}),300))]);
    assert.equal(premature.waiting,true,"The other authenticated Worker must block while first last-slot redemption is uncommitted");
    hold.release();releaseHeld=null;
    const linked=await workerA,failed=await workerB;
    assert.equal(linked.status,"active");
    assert.equal(failed.ok,false);
    assert.equal(failed.error?.name,"CompanyWorkforceSecretError");
    const same=await svc2.redeemRegistrationCode(workerPrincipal(a),code.registrationCode);
    assert.equal(same.linkId,linked.linkId,"Original Worker retry must be idempotent without using a second slot");
    await assert.rejects(svc2.redeemRegistrationCode(pOwner,code.registrationCode),
      error=>error?.name==="CompanyWorkforceAccessError");
    console.log("M11003_ACTUAL_PG16_TWO_INDEPENDENT_WORKERS_LAST_SLOT_ONE_WINS_OTHER_FAILS_IDEMPOTENT");

    const multi=await svc2.createRegistrationCode(pOwner,make(3));
    const third=await svc1.redeemRegistrationCode(workerPrincipal(c),multi.registrationCode);
    const fourth=await svc2.redeemRegistrationCode(workerPrincipal(d),multi.registrationCode);
    assert.notEqual(third.linkId,fourth.linkId);
    const codeMulti=(await first.query("SELECT usage_count,usage_limit,code_status FROM company_registration_codes WHERE code_id=$1",[multi.codeId])).rows[0];
    assert.equal(Number(codeMulti.usage_count),2);assert.equal(codeMulti.code_status,"active");
    const revoke=await svc1.createRegistrationCode(pOwner,make(2));
    await assert.rejects(svc2.revokeRegistrationCode(pForeign,revoke.codeId),
      error=>error?.name==="CompanyWorkforceAccessError");
    await svc1.revokeRegistrationCode(pOwner,revoke.codeId);
    await svc2.revokeRegistrationCode(pOwner,revoke.codeId);
    await assert.rejects(svc2.redeemRegistrationCode(workerPrincipal(b),revoke.registrationCode),
      error=>error?.name==="CompanyWorkforceSecretError");
    const expiring=await svc1.createRegistrationCode(pOwner,make(2));
    const later=new Date("2026-08-21T12:00:00.000Z");
    const lateSvc=new CompanyWorkforceService(second,PEPPER,()=>later);
    await assert.rejects(lateSvc.redeemRegistrationCode(workerPrincipal(b),expiring.registrationCode),
      error=>error?.name==="CompanyWorkforceSecretError");
    await assert.rejects(lateSvc.redeemRegistrationCode(workerPrincipal(wrong),"not-real"),
      error=>error?.name==="CompanyWorkforceSecretError");
    console.log("M11003_ACTUAL_PG16_MULTI_USE_REMAINS_ACTIVE_REVOKE_EXPIRED_TAMPERED_DENIED_FOREIGN_OWNER_BLOCKED");

    const rows=(await first.query("SELECT code_id,tenant_id,code_hash,code_status,usage_limit,usage_count,site_id,department_id "+
      "FROM company_registration_codes WHERE tenant_id=$1 ORDER BY created_at,code_id",[owner.tenantId])).rows;
    assert.equal(rows.length,4);
    const byId=new Map(rows.map(x=>[x.code_id,x]));
    assert.deepEqual([byId.get(code.codeId).code_status,Number(byId.get(code.codeId).usage_count)],["exhausted",1]);
    assert.deepEqual([byId.get(multi.codeId).code_status,Number(byId.get(multi.codeId).usage_count)],["active",2]);
    assert.deepEqual([byId.get(revoke.codeId).code_status,Number(byId.get(revoke.codeId).usage_count)],["revoked",0]);
    assert.deepEqual([byId.get(expiring.codeId).code_status,Number(byId.get(expiring.codeId).usage_count)],["active",0],
      "A time-expired code may need explicit lifecycle sweep to persist expired status; redemption must deny regardless");
    assert(rows.every(x=>x.site_id===units.siteId && x.department_id===units.departmentId));
    const links=(await first.query("SELECT worker_account_id,link_status,code_id,site_id,department_id,payment_responsibility,assessment_reference "+
      "FROM company_worker_links WHERE tenant_id=$1 ORDER BY worker_account_id",[owner.tenantId])).rows;
    assert.deepEqual(links.map(x=>[x.worker_account_id,x.link_status]),[
      [a.accountId,"active"],[c.accountId,"active"],[d.accountId,"active"]
    ]);
    assert(links.every(x=>x.site_id===units.siteId && x.department_id===units.departmentId && x.payment_responsibility==="company" &&
      x.assessment_reference==="M11003-PG"));
    const audit=(await first.query("SELECT action_key,actor_account_id,target_reference FROM platform_audit_events WHERE target_reference IN "+
      "(SELECT code_id FROM company_registration_codes WHERE tenant_id=$1) AND action_key LIKE 'company_workforce.code.%' ORDER BY audit_sequence",
      [owner.tenantId])).rows;
    const occurrences=(key)=>audit.filter(x=>x.action_key===key);
    assert.equal(occurrences("company_workforce.code.created").length,4);
    assert.equal(occurrences("company_workforce.code.redeemed").length,3);
    assert.equal(occurrences("company_workforce.code.revoked").length,1);
    assert(occurrences("company_workforce.code.created").concat(occurrences("company_workforce.code.revoked"))
      .every(x=>x.actor_account_id===owner.accountId));
    assert.deepEqual(occurrences("company_workforce.code.redeemed").map(x=>x.actor_account_id),[a.accountId,c.accountId,d.accountId]);
    assert.equal((await first.query("SELECT COUNT(*)::integer AS n FROM company_worker_links WHERE tenant_id=$1",[foreign.tenantId])).rows[0].n,0);
    console.log("M11003_ACTUAL_PG16_DB_ONE_EXHAUSTED_ONE_MULTI_ACTIVE_REVOKED_EXPIRED_REDEMPTION_DENIAL_THREE_ACTIVE_LINKS_CROSS_ROLE_AUDITS");
  }finally{if(releaseHeld)releaseHeld();await cleanup();}
});

test("M1.10.04 actual PostgreSQL16 wrong Worker copied link ID cannot accept during rightful cross-tenant Worker race",{
  skip:!process.env.HSE_M11004_POSTGRES_TEST_DATABASE_URL,timeout:170000
},async()=>{
  const {first,second,cleanup}=await m11001ActualPostgres16("M11004");
  let releaseHeld;
  try{
    const companyA=await seedCompany(first,"V"),companyB=await seedCompany(first,"W");
    const workerA=await seedWorker(first,"G","m11004.right-a@example.test");
    const workerB=await seedWorker(first,"H","m11004.right-b@example.test");
    const permanentA=await seedPermanentWorkerId(first,workerA,"G");
    const permanentB=await seedPermanentWorkerId(first,workerB,"H");
    const companyService=new CompanyWorkforceService(first,PEPPER,()=>new Date(NOW_DATE));
    const workerService=new CompanyWorkforceService(second,PEPPER,()=>new Date(NOW_DATE));
    const input=email=>({email,siteId:null,departmentId:null,
      paymentResponsibility:"company",assessmentReference:"M11004-INDEPENDENT-WORKER"});
    const pendingA=await companyService.requestPermanentWorkerLink(
      companyPrincipal(companyA),permanentA,input(workerA.email));
    const pendingB=await companyService.requestPermanentWorkerLink(
      companyPrincipal(companyB),permanentB,input(workerB.email));
    assert.equal(pendingA.status,"pending_worker_acceptance");
    assert.equal(pendingB.status,"pending_worker_acceptance");
    await assert.rejects(workerService.acceptWorkerLink(workerPrincipal(workerB),pendingA.linkId),
      error=>error?.name==="CompanyWorkforceAccessError");
    await assert.rejects(workerService.acceptWorkerLink(workerPrincipal(workerA),pendingB.linkId),
      error=>error?.name==="CompanyWorkforceAccessError");
    await assert.rejects(workerService.acceptWorkerLink(companyPrincipal(companyA),pendingA.linkId),
      error=>error?.name==="CompanyWorkforceAccessError");
    await assert.rejects(workerService.acceptWorkerLink({...workerPrincipal(workerB),accountId:workerA.accountId},pendingA.linkId),
      error=>error?.name==="CompanyWorkforceAccessError");
    await assert.rejects(workerService.acceptWorkerLink({...workerPrincipal(workerA),sessionId:"session_m11004_nonexistent"},pendingA.linkId),
      error=>error?.name==="CompanyWorkforceAccessError");
    await assert.rejects(workerService.acceptWorkerLink(workerPrincipal(workerB),"company_worker_link_"+"J".repeat(24)),
      error=>error?.name==="CompanyWorkforceAccessError");
    const before=(await first.query("SELECT link_id,worker_account_id,tenant_id,link_status,worker_accepted_at "+
      "FROM company_worker_links WHERE link_id IN ($1,$2) ORDER BY link_id",[pendingA.linkId,pendingB.linkId])).rows;
    assert.equal(before.length,2);
    assert(before.every(x=>x.link_status==="pending_worker_acceptance"&&x.worker_accepted_at===null));
    const beforeAudit=(await first.query("SELECT COUNT(*)::integer AS n FROM platform_audit_events WHERE "+
      "target_reference IN ($1,$2) AND action_key='company_workforce.link.accepted'",
      [pendingA.linkId,pendingB.linkId])).rows[0].n;
    assert.equal(beforeAudit,0,"Forged IDs, roles, sessions and cross-tenant Workers cannot emit success audit");
    console.log("M11004_ACTUAL_PG16_COPIED_CROSS_TENANT_LINK_IDS_WRONG_ROLE_FORGED_SESSION_AND_INVALID_ID_DENIED_NO_MUTATION");

    // Worker A completes all mutations but deliberately holds the PG16 SQL commit;
    // wrong Worker B submits the copied link from an independent live SQL session.
    const hold=m11001HoldSuccessfulTransaction(first);
    releaseHeld=hold.release;
    const serviceHeld=new CompanyWorkforceService(hold.wrapped,PEPPER,()=>new Date(NOW_DATE));
    const accepting=serviceHeld.acceptWorkerLink(workerPrincipal(workerA),pendingA.linkId);
    await hold.ready;
    const attacker=await workerService.acceptWorkerLink(workerPrincipal(workerB),pendingA.linkId)
      .then(value=>({ok:true,value}),error=>({ok:false,error}));
    assert.equal(attacker.ok,false,
      "Copied victim link cannot be accepted even while rightful Worker transaction is in progress");
    assert.equal(attacker.error?.name,"CompanyWorkforceAccessError");
    hold.release();releaseHeld=null;
    const acceptedA=await accepting;
    assert.equal(acceptedA.linkId,pendingA.linkId);
    assert.equal(acceptedA.status,"active");
    await assert.rejects(workerService.acceptWorkerLink(workerPrincipal(workerB),pendingA.linkId),
      error=>error?.name==="CompanyWorkforceAccessError");
    const replay=await workerService.acceptWorkerLink(workerPrincipal(workerA),pendingA.linkId);
    assert.equal(replay.linkId,pendingA.linkId);
    console.log("M11004_ACTUAL_PG16_WRONG_WORKER_DURING_REAL_UNCOMMITTED_RIGHTFUL_ACCEPT_DENIED_RIGHTFUL_REPLAY_ONE_LINK");

    // Real revoked session cannot consume a pending link. It becomes
    // actionable again only after controlled session recovery.
    await second.query("UPDATE auth_sessions SET revoked_at=$2,revocation_reason='M11004 signed Worker session negative' "+
      "WHERE session_id=$1",[workerB.sessionId,NOW]);
    await assert.rejects(workerService.acceptWorkerLink(workerPrincipal(workerB),pendingB.linkId),
      error=>error?.name==="CompanyWorkforceAccessError");
    await second.query("UPDATE auth_sessions SET revoked_at=NULL,revocation_reason=NULL WHERE session_id=$1",
      [workerB.sessionId]);
    const acceptedB=await workerService.acceptWorkerLink(workerPrincipal(workerB),pendingB.linkId);
    assert.equal(acceptedB.linkId,pendingB.linkId);
    assert.equal(acceptedB.status,"active");
    await assert.rejects(companyService.acceptWorkerLink(workerPrincipal(workerA),pendingB.linkId),
      error=>error?.name==="CompanyWorkforceAccessError");
    console.log("M11004_ACTUAL_PG16_REVOKED_WORKER_SESSION_DENIED_RECOVERED_RIGHTFUL_WORKER_ACCEPTS_NO_TENANT_CROSSOVER");

    const links=(await first.query("SELECT link_id,tenant_id,worker_account_id,link_status,worker_accepted_at,activated_at,"+
      "permanent_worker_id,payment_responsibility,assessment_reference FROM company_worker_links "+
      "WHERE link_id IN ($1,$2) ORDER BY link_id",[pendingA.linkId,pendingB.linkId])).rows;
    assert.equal(links.length,2);
    const byId=new Map(links.map(x=>[x.link_id,x]));
    for(const [pending,company,worker,permanent] of [
      [pendingA,companyA,workerA,permanentA],[pendingB,companyB,workerB,permanentB]]){
      const row=byId.get(pending.linkId);
      assert.equal(row.tenant_id,company.tenantId);
      assert.equal(row.worker_account_id,worker.accountId);
      assert.equal(row.permanent_worker_id,permanent);
      assert.equal(row.link_status,"active");
      assert.ok(row.worker_accepted_at&&row.activated_at);
      assert.equal(row.payment_responsibility,"company");
      assert.equal(row.assessment_reference,"M11004-INDEPENDENT-WORKER");
    }
    const audits=(await first.query("SELECT action_key,actor_account_id,target_reference FROM platform_audit_events "+
      "WHERE target_reference IN ($1,$2) AND action_key LIKE 'company_workforce.link.%' "+
      "ORDER BY audit_sequence",[pendingA.linkId,pendingB.linkId])).rows;
    const accepted=audits.filter(x=>x.action_key==="company_workforce.link.accepted");
    const requested=audits.filter(x=>x.action_key==="company_workforce.link.requested");
    assert.equal(accepted.length,2);
    assert.equal(requested.length,2);
    assert.deepEqual(new Map(accepted.map(x=>[x.target_reference,x.actor_account_id])),new Map([
      [pendingA.linkId,workerA.accountId],[pendingB.linkId,workerB.accountId]
    ]));
    assert.deepEqual(new Map(requested.map(x=>[x.target_reference,x.actor_account_id])),new Map([
      [pendingA.linkId,companyA.accountId],[pendingB.linkId,companyB.accountId]
    ]));
    console.log("M11004_ACTUAL_PG16_TWO_COMPANIES_TWO_RIGHTFUL_WORKERS_ONE_SUCCESS_AUDIT_EACH_ZERO_FORGED_PERSISTED_STATES");
  }finally{
    if(releaseHeld)releaseHeld();
    await cleanup();
  }
});

test("M1.10.05 actual PostgreSQL16 Company termination race preserves Worker ID then independent second-employer placement and historical receiver",{
  skip:!process.env.HSE_M11005_POSTGRES_TEST_DATABASE_URL,timeout:200000
},async()=>{
  const {first,second,cleanup}=await m11001ActualPostgres16("M11005");
  let releaseHeld;
  try{
    const oldCompany=await seedCompany(first,"X"),newCompany=await seedCompany(first,"Y");
    const oldUnits=await seedUnits(first,oldCompany,"X");
    const newUnits=await seedUnits(first,newCompany,"Y");
    const worker=await seedWorker(first,"J","m11005-individual-worker@example.test");
    const unrelatedWorker=await seedWorker(first,"K","m11005-other-worker@example.test");
    const permanentId=await seedPermanentWorkerId(first,worker,"J");
    const svc1=new CompanyWorkforceService(first,PEPPER,()=>new Date(NOW_DATE));
    const svc2=new CompanyWorkforceService(second,PEPPER,()=>new Date(NOW_DATE));
    const receiver=new CompanyWorkforceWorkerReadRepository(Promise.resolve(second),()=>new Date(NOW_DATE));
    const pOld=companyPrincipal(oldCompany),pNew=companyPrincipal(newCompany),pWorker=workerPrincipal(worker);
    const defaults=(company,units)=>({email:worker.email,siteId:units.siteId,departmentId:units.departmentId,
      paymentResponsibility:company===oldCompany?"worker":"company",
      assessmentReference:company===oldCompany?"M11005-OLD-SCOPE":"M11005-NEW-SCOPE"});
    const oldPending=await svc1.requestPermanentWorkerLink(pOld,permanentId,defaults(oldCompany,oldUnits));
    assert.equal(oldPending.status,"pending_worker_acceptance");
    const pendingView=await receiver.listLinks(pWorker);
    assert.deepEqual(pendingView.map(x=>[x.linkId,x.status]),[[oldPending.linkId,"pending_worker_acceptance"]]);
    assert.equal(pendingView[0].siteName,"Site X");
    assert.equal(pendingView[0].departmentName,"Dept X");
    await assert.rejects(receiver.listLinks(pOld),error=>error?.name==="CompanyWorkforceAccessError");
    assert.deepEqual(await receiver.listLinks(workerPrincipal(unrelatedWorker)),[],
      "Unrelated Worker cannot view the legitimate placement");
    const oldActive=await svc2.acceptWorkerLink(pWorker,oldPending.linkId);
    assert.equal(oldActive.status,"active");
    assert.equal((await receiver.listLinks(pWorker))[0].status,"active");
    console.log("M11005_ACTUAL_PG16_FIRST_COMPANY_PENDING_TO_RIGHTFUL_WORKER_ACTIVE_WITH_OWN_SITE_DEPARTMENT_RECEIVER");

    const end={linkId:oldActive.linkId,effectiveDate:"2026-08-16",
      reason:"Assignment complete; verified Worker has chosen a new employer."};
    await assert.rejects(svc2.endWorkerRelationship(pNew,end),
      error=>error?.name==="CompanyWorkforceAccessError");
    await assert.rejects(svc2.endWorkerRelationship(pWorker,end),
      error=>error?.name==="CompanyWorkforceAccessError");
    const before=(await first.query("SELECT link_status,revoked_at FROM company_worker_links WHERE link_id=$1",[oldActive.linkId])).rows[0];
    assert.equal(before.link_status,"active");assert.equal(before.revoked_at,null);
    const hold=m11001HoldSuccessfulTransaction(first);
    releaseHeld=hold.release;
    const heldService=new CompanyWorkforceService(hold.wrapped,PEPPER,()=>new Date(NOW_DATE));
    const firstEnding=heldService.endWorkerRelationship(pOld,end);
    await hold.ready;
    // Same verified Company, separate SQL connection and real session, must
    // serialize the second end behind the first uncommitted transaction.
    const competingEnd=svc2.endWorkerRelationship(pOld,end)
      .then(()=>({ok:true}),error=>({ok:false,error}));
    const waiting=await Promise.race([competingEnd.then(()=>({finished:true})),
      new Promise(resolve=>setTimeout(()=>resolve({waiting:true}),300))]);
    assert.equal(waiting.waiting,true,
      "Second Company end must wait while the same relationship end is uncommitted");
    hold.release();releaseHeld=null;
    await firstEnding;
    const secondEnd=await competingEnd;
    assert.equal(secondEnd.ok,false);
    assert.equal(secondEnd.error?.name,"CompanyWorkforceConflictError");
    const afterEnd=await receiver.listLinks(pWorker);
    assert.deepEqual(afterEnd.map(x=>[x.linkId,x.status]),[[oldActive.linkId,"revoked"]]);
    assert.equal(afterEnd[0].siteName,"Site X");
    assert.equal(afterEnd[0].departmentName,"Dept X");
    assert.ok(afterEnd[0].revokedAt);
    console.log("M11005_ACTUAL_PG16_TWO_CONNECTION_SAME_LINK_END_SERIALIZES_ONE_REVOKE_WORKER_HISTORY_RETAINS_OLD_PLACEMENT");

    // Employer Y must create a brand-new pending consented link. The previous
    // Company owner cannot mutate or re-use Y's scope or the Worker identity.
    const nextPending=await svc2.requestPermanentWorkerLink(pNew,permanentId,defaults(newCompany,newUnits));
    assert.equal(nextPending.status,"pending_worker_acceptance");
    assert.notEqual(nextPending.linkId,oldActive.linkId);
    const pendingNew=await receiver.listLinks(pWorker);
    assert.deepEqual(pendingNew.map(x=>[x.linkId,x.status]),[
      [nextPending.linkId,"pending_worker_acceptance"],[oldActive.linkId,"revoked"]
    ]);
    assert.equal(pendingNew[0].siteName,"Site Y");
    assert.equal(pendingNew[0].departmentName,"Dept Y");
    await assert.rejects(svc1.endWorkerRelationship(pOld,{...end,linkId:nextPending.linkId}),
      error=>error?.name==="CompanyWorkforceAccessError");
    await assert.rejects(svc1.acceptWorkerLink(companyPrincipal(newCompany),nextPending.linkId),
      error=>error?.name==="CompanyWorkforceAccessError");
    const newActive=await svc1.acceptWorkerLink(pWorker,nextPending.linkId);
    assert.equal(newActive.status,"active");
    assert.equal((await svc2.acceptWorkerLink(pWorker,nextPending.linkId)).linkId,newActive.linkId);
    await assert.rejects(svc1.endWorkerRelationship(pOld,{...end,linkId:newActive.linkId}),
      error=>error?.name==="CompanyWorkforceAccessError");
    console.log("M11005_ACTUAL_PG16_NEW_COMPANY_REQUIRES_FRESH_WORKER_CONSENT_REJECTS_OLD_TENANT_LINK_ID_AND_PRESERVES_WORKER_ID");

    const finalView=await receiver.listLinks(pWorker);
    assert.deepEqual(finalView.map(x=>[x.linkId,x.status]),[
      [newActive.linkId,"active"],[oldActive.linkId,"revoked"]
    ]);
    assert.equal(finalView[0].companyName,newCompany.displayName);
    assert.equal(finalView[1].companyName,oldCompany.displayName);
    assert.equal(finalView[0].siteName,"Site Y");
    assert.equal(finalView[0].departmentName,"Dept Y");
    assert.equal(finalView[1].siteName,"Site X");
    assert.equal(finalView[1].departmentName,"Dept X");
    assert.equal(finalView[0].permanentWorkerId,permanentId);
    assert.equal(finalView[1].permanentWorkerId,permanentId);
    const identity=(await first.query("SELECT account_status FROM auth_accounts WHERE account_id=$1",[worker.accountId])).rows[0];
    assert.equal(identity.account_status,"active");
    const workerIds=(await first.query("SELECT permanent_worker_id,worker_account_id FROM worker_identity_worker_ids "+
      "WHERE worker_account_id=$1",[worker.accountId])).rows;
    assert.deepEqual(workerIds,[{permanent_worker_id:permanentId,worker_account_id:worker.accountId}]);
    assert.deepEqual(await receiver.listLinks(workerPrincipal(unrelatedWorker)),[]);
    console.log("M11005_ACTUAL_PG16_WORKER_RECEIVER_OLD_HISTORY_NEW_ACTIVE_SITE_DEPARTMENT_AND_PERMANENT_ID_UNCHANGED");

    const links=(await first.query("SELECT tenant_id,link_id,worker_account_id,permanent_worker_id,link_status,site_id,department_id,payment_responsibility,assessment_reference,revoked_at "+
      "FROM company_worker_links WHERE worker_account_id=$1 ORDER BY tenant_id",[worker.accountId])).rows;
    assert.equal(links.length,2);
    assert.deepEqual(links.map(x=>[x.tenant_id,x.link_id,x.link_status]),[
      [oldCompany.tenantId,oldActive.linkId,"revoked"],[newCompany.tenantId,newActive.linkId,"active"]
    ]);
    assert.equal(links[0].site_id,oldUnits.siteId);assert.equal(links[0].department_id,oldUnits.departmentId);
    assert.equal(links[1].site_id,newUnits.siteId);assert.equal(links[1].department_id,newUnits.departmentId);
    assert.equal(links[0].payment_responsibility,"worker");
    assert.equal(links[1].payment_responsibility,"company");
    assert.equal(links[0].assessment_reference,"M11005-OLD-SCOPE");
    assert.equal(links[1].assessment_reference,"M11005-NEW-SCOPE");
    assert(links[0].revoked_at&&!links[1].revoked_at);
    const audits=(await first.query("SELECT action_key,actor_account_id,actor_tenant_id,target_reference,metadata "+
      "FROM platform_audit_events WHERE target_reference IN ($1,$2) "+
      "AND action_key LIKE 'company_workforce.link.%' ORDER BY audit_sequence",
      [oldActive.linkId,newActive.linkId])).rows;
    const events=key=>audits.filter(x=>x.action_key==="company_workforce.link."+key);
    assert.equal(events("requested").length,2);
    assert.equal(events("accepted").length,2);
    assert.equal(events("revoked").length,1);
    assert.deepEqual(new Map(events("requested").map(x=>[x.target_reference,x.actor_account_id])),
      new Map([[oldActive.linkId,oldCompany.accountId],[newActive.linkId,newCompany.accountId]]));
    assert(events("accepted").every(x=>x.actor_account_id===worker.accountId));
    assert.equal(events("revoked")[0].actor_account_id,oldCompany.accountId);
    assert.equal(events("revoked")[0].actor_tenant_id,oldCompany.tenantId);
    const metadata=typeof events("revoked")[0].metadata==="string"
      ?JSON.parse(events("revoked")[0].metadata):events("revoked")[0].metadata;
    assert.equal(metadata.reason,end.reason);
    assert.equal(metadata.effectiveDate,end.effectiveDate);
    console.log("M11005_ACTUAL_PG16_EXACT_TWO_CONSENTED_LINKS_ONE_END_FIVE_IMMUTABLE_ROLE_SCOPED_AUDITS_NO_REPLAY");
  }finally{
    if(releaseHeld)releaseHeld();
    await cleanup();
  }
});

test("M1.10.05 actual PostgreSQL16 active Worker Site Department move serializes with end and preserves receiver audit",{
  skip:!process.env.HSE_M11005_POSTGRES_TEST_DATABASE_URL,timeout:180000
},async()=>{
  const {first,second,cleanup}=await m11001ActualPostgres16("M11005");
  let releaseHeld;
  try{
    const company=await seedCompany(first,"C"),foreigner=await seedCompany(first,"D");
    const initial=await seedUnits(first,company,"C");
    const target=await seedUnits(first,company,"E");
    const foreign=await seedUnits(first,foreigner,"D");
    const worker=await seedWorker(first,"F","m11005-move-worker@example.test");
    const permanentId=await seedPermanentWorkerId(first,worker,"F");
    const svc1=new CompanyWorkforceService(first,PEPPER,()=>new Date(NOW_DATE));
    const svc2=new CompanyWorkforceService(second,PEPPER,()=>new Date(NOW_DATE));
    const receiver=new CompanyWorkforceWorkerReadRepository(Promise.resolve(second),()=>new Date(NOW_DATE));
    const pCompany=companyPrincipal(company),pForeign=companyPrincipal(foreigner),pWorker=workerPrincipal(worker);
    const request=await svc1.requestPermanentWorkerLink(pCompany,permanentId,{
      email:worker.email,siteId:initial.siteId,departmentId:initial.departmentId,
      paymentResponsibility:"company",assessmentReference:"M11005-MOVE"
    });
    const active=await svc2.acceptWorkerLink(pWorker,request.linkId);
    assert.equal(active.status,"active");
    const move=(siteId,departmentId)=>({linkId:active.linkId,siteId,departmentId});
    await assert.rejects(svc2.updateWorkerPlacement(pForeign,move(target.siteId,target.departmentId)),
      error=>error?.name==="CompanyWorkforceAccessError");
    await assert.rejects(svc2.updateWorkerPlacement(pWorker,move(target.siteId,target.departmentId)),
      error=>error?.name==="CompanyWorkforceAccessError");
    await assert.rejects(svc2.updateWorkerPlacement(pCompany,move(foreign.siteId,target.departmentId)),
      error=>error?.name==="CompanyWorkforceAccessError");
    await assert.rejects(svc2.updateWorkerPlacement(pCompany,move(target.siteId,foreign.departmentId)),
      error=>error?.name==="CompanyWorkforceAccessError");
    assert.equal((await receiver.listLinks(pWorker))[0].siteName,"Site C");
    const before=(await first.query("SELECT site_id,department_id FROM company_worker_links WHERE link_id=$1",
      [active.linkId])).rows[0];
    assert.deepEqual(before,{site_id:initial.siteId,department_id:initial.departmentId});
    const priorAudit=(await first.query("SELECT COUNT(*)::integer AS n FROM platform_audit_events "+
      "WHERE target_reference=$1 AND action_key='company_workforce.link.placement_updated'",
      [active.linkId])).rows[0].n;
    assert.equal(priorAudit,0);
    console.log("M11005_ACTUAL_PG16_MOVEMENT_WRONG_ROLE_FOREIGN_TENANT_SITE_DEPARTMENT_DENIED_NO_CHANGES");

    const held=m11001HoldSuccessfulTransaction(first);releaseHeld=held.release;
    const serviceHeld=new CompanyWorkforceService(held.wrapped,PEPPER,()=>new Date(NOW_DATE));
    const relocation=serviceHeld.updateWorkerPlacement(pCompany,move(target.siteId,target.departmentId));
    await held.ready;
    const ending=svc2.endWorkerRelationship(pCompany,{
      linkId:active.linkId,effectiveDate:"2026-08-16",
      reason:"Contract complete after moving the Worker to the final assigned Site and Department."
    }).then(()=>({ok:true}),error=>({ok:false,error}));
    const early=await Promise.race([ending.then(()=>({done:true})),
      new Promise(resolve=>setTimeout(()=>resolve({waiting:true}),300))]);
    assert.equal(early.waiting,true,"End must wait while active Worker placement change is uncommitted");
    held.release();releaseHeld=null;
    const relocated=await relocation;
    assert.equal(relocated.siteId,target.siteId);
    assert.equal(relocated.departmentId,target.departmentId);
    const result=await ending;assert.equal(result.ok,true);
    await assert.rejects(svc1.updateWorkerPlacement(pCompany,move(initial.siteId,initial.departmentId)),
      error=>error?.name==="CompanyWorkforceConflictError");
    const final=(await receiver.listLinks(pWorker));
    assert.equal(final.length,1);
    assert.equal(final[0].status,"revoked");
    assert.equal(final[0].siteName,"Site E");
    assert.equal(final[0].departmentName,"Dept E");
    assert.equal(final[0].permanentWorkerId,permanentId);
    assert.ok(final[0].revokedAt);
    console.log("M11005_ACTUAL_PG16_ACTIVE_PLACEMENT_MOVE_COMMITS_BEFORE_CONCURRENT_END_WORKER_HISTORY_SHOWS_LAST_SCOPE");

    const links=(await first.query("SELECT site_id,department_id,worker_account_id,permanent_worker_id,link_status,revoked_at "+
      "FROM company_worker_links WHERE link_id=$1 AND tenant_id=$2",[active.linkId,company.tenantId])).rows;
    assert.equal(links.length,1);
    assert.equal(links[0].site_id,target.siteId);assert.equal(links[0].department_id,target.departmentId);
    assert.equal(links[0].worker_account_id,worker.accountId);
    assert.equal(links[0].permanent_worker_id,permanentId);assert.equal(links[0].link_status,"revoked");
    const events=(await first.query("SELECT action_key,actor_account_id,actor_tenant_id,metadata FROM platform_audit_events "+
      "WHERE target_reference=$1 AND action_key LIKE 'company_workforce.link.%' ORDER BY audit_sequence",[active.linkId])).rows;
    const acts=events.map(e=>e.action_key);
    assert.deepEqual(acts,[
      "company_workforce.link.requested","company_workforce.link.accepted",
      "company_workforce.link.placement_updated","company_workforce.link.revoked"
    ]);
    assert.equal(events[2].actor_account_id,company.accountId);
    assert.equal(events[2].actor_tenant_id,company.tenantId);
    const meta=typeof events[2].metadata==="string"?JSON.parse(events[2].metadata):events[2].metadata;
    assert.equal(meta.oldSiteId,initial.siteId);
    assert.equal(meta.oldDepartmentId,initial.departmentId);
    assert.equal(meta.siteId,target.siteId);assert.equal(meta.departmentId,target.departmentId);
    const account=(await first.query("SELECT account_status FROM auth_accounts WHERE account_id=$1",
      [worker.accountId])).rows[0];assert.equal(account.account_status,"active");
    console.log("M11005_ACTUAL_PG16_ONE_MOVE_ONE_END_ORDERED_IMMUTABLE_AUDIT_NO_WRONG_TENANT_OR_WORKER_ID_MUTATION");
  }finally{if(releaseHeld)releaseHeld();await cleanup();}
});


// M1.10.06 adds only the gap missing from the already-passing signed real
// Chromium two-employer lifecycle: independent SQL-client concurrent consent,
// live scoped placement while the other employer ends, and immutable DB proof.
test("M1.10.06 actual PostgreSQL16 two simultaneously active employers retain independent Worker scope during cross-company end and placement",{
  skip:!process.env.HSE_M11006_POSTGRES_TEST_DATABASE_URL,timeout:200000
},async()=>{
  const {first,second,cleanup}=await m11001ActualPostgres16("M11006");
  let releaseHeld;
  try{
    const companyA=await seedCompany(first,"L"),companyB=await seedCompany(first,"M");
    const unitsA=await seedUnits(first,companyA,"L");
    const unitsB=await seedUnits(first,companyB,"M");
    const unitsBNew=await seedUnits(first,companyB,"N");
    const worker=await seedWorker(first,"V","m11006-dual-worker@example.test");
    const unrelated=await seedWorker(first,"W","m11006-unrelated@example.test");
    const permanentId=await seedPermanentWorkerId(first,worker,"V");
    const ownerA=companyPrincipal(companyA),ownerB=companyPrincipal(companyB);
    const rightWorker=workerPrincipal(worker),foreignWorker=workerPrincipal(unrelated);
    const serviceA=new CompanyWorkforceService(first,PEPPER,()=>new Date(NOW_DATE));
    const serviceB=new CompanyWorkforceService(second,PEPPER,()=>new Date(NOW_DATE));
    const receiving=new CompanyWorkforceWorkerReadRepository(Promise.resolve(second),()=>new Date(NOW_DATE));
    const defaults=(company,units)=>({
      email:worker.email,siteId:units.siteId,departmentId:units.departmentId,
      paymentResponsibility:company===companyA?"worker":"company",
      assessmentReference:company===companyA?"M11006-FIRST":"M11006-SECOND"
    });
    const pendingA=await serviceA.requestPermanentWorkerLink(ownerA,permanentId,defaults(companyA,unitsA));
    const pendingB=await serviceB.requestPermanentWorkerLink(ownerB,permanentId,defaults(companyB,unitsB));
    assert.notEqual(pendingA.linkId,pendingB.linkId);
    assert.equal(pendingA.status,"pending_worker_acceptance");
    assert.equal(pendingB.status,"pending_worker_acceptance");
    const twoPending=await receiving.listLinks(rightWorker);
    assert.deepEqual(new Set(twoPending.map(x=>x.linkId)),new Set([pendingA.linkId,pendingB.linkId]));
    assert(twoPending.every(x=>x.status==="pending_worker_acceptance"));
    assert.deepEqual(await receiving.listLinks(foreignWorker),[]);
    await assert.rejects(receiving.listLinks(ownerA),error=>error?.name==="CompanyWorkforceAccessError");
    await assert.rejects(serviceA.acceptWorkerLink(foreignWorker,pendingB.linkId),
      error=>error?.name==="CompanyWorkforceAccessError");
    await assert.rejects(serviceB.acceptWorkerLink(ownerB,pendingA.linkId),
      error=>error?.name==="CompanyWorkforceAccessError");
    const preAccept=(await first.query("SELECT COUNT(*)::integer n FROM platform_audit_events "+
      "WHERE action_key='company_workforce.link.accepted' AND target_reference IN($1,$2)",
      [pendingA.linkId,pendingB.linkId])).rows[0].n;
    assert.equal(preAccept,0);
    console.log("M11006_ACTUAL_PG16_TWO_COMPANIES_INDEPENDENT_PENDING_NO_WRONG_WORKER_OR_ROLE_CONSENT");

    // Genuine separate Postgres16 connections attempt the two rightful
    // Worker acceptances together; their shared signed Worker session is
    // serialized, but BOTH Company link identities must remain independent.
    const accepts=await Promise.all([
      serviceA.acceptWorkerLink(rightWorker,pendingA.linkId),
      serviceB.acceptWorkerLink(rightWorker,pendingB.linkId)
    ]);
    assert(accepts.every(x=>x.status==="active"));
    assert.equal(new Set(accepts.map(x=>x.linkId)).size,2);
    const bothActive=await receiving.listLinks(rightWorker);
    assert.equal(bothActive.length,2);
    assert(bothActive.every(x=>x.status==="active"));
    const byTenant=Object.fromEntries(bothActive.map(x=>[x.tenantId,x]));
    assert.equal(byTenant[companyA.tenantId]?.siteName,"Site L");
    assert.equal(byTenant[companyB.tenantId]?.siteName,"Site M");
    assert.equal(byTenant[companyA.tenantId]?.departmentName,"Dept L");
    assert.equal(byTenant[companyB.tenantId]?.departmentName,"Dept M");
    assert(bothActive.every(x=>x.permanentWorkerId===permanentId));
    await assert.rejects(serviceA.updateWorkerPlacement(ownerA,{
      linkId:pendingB.linkId,siteId:unitsA.siteId,departmentId:unitsA.departmentId
    }),error=>error?.name==="CompanyWorkforceAccessError");
    await assert.rejects(serviceB.endWorkerRelationship(ownerB,{
      linkId:pendingA.linkId,effectiveDate:"2026-08-16",
      reason:"Attempted foreign tenant Company relationship termination."
    }),error=>error?.name==="CompanyWorkforceAccessError");
    console.log("M11006_ACTUAL_PG16_CONCURRENT_RIGHTFUL_CONSENT_TWO_ACTIVE_LINKS_SAME_WORKER_ID_TENANT_SCOPES_ISOLATED");

    const endA={linkId:pendingA.linkId,effectiveDate:"2026-08-16",
      reason:"First Company assignment ended while second independent Company remains active."};
    const held=m11001HoldSuccessfulTransaction(first);releaseHeld=held.release;
    const endingA=new CompanyWorkforceService(held.wrapped,PEPPER,()=>new Date(NOW_DATE))
      .endWorkerRelationship(ownerA,endA);
    await held.ready;
    const moveB={linkId:pendingB.linkId,siteId:unitsBNew.siteId,departmentId:unitsBNew.departmentId};
    const movingB=serviceB.updateWorkerPlacement(ownerB,moveB);
    const movedBeforeA=await Promise.race([
      movingB.then(()=>({done:true}),error=>({done:false,error})),
      new Promise(resolve=>setTimeout(()=>resolve({done:false,timeout:true}),1100))
    ]);
    assert.equal(movedBeforeA.done,true,
      "Second Company placement must independently commit while first Company end remains uncommitted");
    await movingB;
    const pendingEndingView=await receiving.listLinks(rightWorker);
    assert.equal(pendingEndingView.find(x=>x.tenantId===companyA.tenantId).status,"active");
    assert.equal(pendingEndingView.find(x=>x.tenantId===companyB.tenantId).siteName,"Site N");
    held.release();releaseHeld=null;
    await endingA;
    const final=await receiving.listLinks(rightWorker);
    const old=final.find(x=>x.tenantId===companyA.tenantId);
    const active=final.find(x=>x.tenantId===companyB.tenantId);
    assert.equal(final.length,2);
    assert.equal(old.status,"revoked");assert(old.revokedAt);
    assert.equal(old.siteName,"Site L");assert.equal(old.departmentName,"Dept L");
    assert.equal(active.status,"active");assert.equal(active.revokedAt,null);
    assert.equal(active.siteName,"Site N");assert.equal(active.departmentName,"Dept N");
    assert(old.permanentWorkerId===permanentId&&active.permanentWorkerId===permanentId);
    await assert.rejects(serviceA.endWorkerRelationship(ownerA,endA),
      error=>error?.name==="CompanyWorkforceConflictError");
    assert.equal((await serviceB.acceptWorkerLink(rightWorker,pendingB.linkId)).linkId,pendingB.linkId);
    assert.deepEqual(await receiving.listLinks(foreignWorker),[]);
    console.log("M11006_ACTUAL_PG16_FIRST_EMPLOYER_END_HELD_SECOND_SITE_MOVE_COMMITS_INDEPENDENTLY_WORKER_HISTORY_REMAINS");

    const links=(await first.query("SELECT tenant_id,link_id,worker_account_id,permanent_worker_id,link_status,site_id,department_id "+
      "FROM company_worker_links WHERE worker_account_id=$1 ORDER BY tenant_id",
      [worker.accountId])).rows;
    assert.equal(links.length,2);
    assert.deepEqual(links.map(x=>x.link_status),["revoked","active"]);
    assert.deepEqual(links.map(x=>x.tenant_id),[companyA.tenantId,companyB.tenantId]);
    assert(links.every(x=>x.worker_account_id===worker.accountId&&x.permanent_worker_id===permanentId));
    assert.equal(links[0].site_id,unitsA.siteId);
    assert.equal(links[1].site_id,unitsBNew.siteId);
    const identity=(await first.query(
      "SELECT permanent_worker_id FROM worker_identity_worker_ids WHERE worker_account_id=$1",
      [worker.accountId])).rows;
    assert.deepEqual(identity,[{permanent_worker_id:permanentId}]);
    const audit=(await first.query(
      "SELECT action_key,actor_account_id,actor_tenant_id,target_reference,metadata FROM platform_audit_events "+
      "WHERE target_reference IN($1,$2) AND action_key LIKE 'company_workforce.link.%' ORDER BY audit_sequence",
      [pendingA.linkId,pendingB.linkId])).rows;
    assert.deepEqual(audit.map(x=>x.action_key).sort(),[
      "company_workforce.link.requested","company_workforce.link.requested",
      "company_workforce.link.accepted","company_workforce.link.accepted",
      "company_workforce.link.placement_updated","company_workforce.link.revoked"
    ].sort());
    for(const event of audit){
      const isA=event.target_reference===pendingA.linkId;
      const expectedCompany=isA?companyA:companyB;
      const expectedActor=event.action_key==="company_workforce.link.accepted"?worker.accountId:expectedCompany.accountId;
      assert.equal(event.actor_account_id,expectedActor);
      assert.equal(event.actor_tenant_id,event.action_key==="company_workforce.link.accepted"?null:expectedCompany.tenantId);
      if(event.action_key==="company_workforce.link.placement_updated"){
        const meta=typeof event.metadata==="string"?JSON.parse(event.metadata):event.metadata;
        assert.equal(meta.oldSiteId,unitsB.siteId);
        assert.equal(meta.siteId,unitsBNew.siteId);
        assert.equal(meta.oldDepartmentId,unitsB.departmentId);
        assert.equal(meta.departmentId,unitsBNew.departmentId);
      }
    }
    console.log("M11006_ACTUAL_PG16_EXACT_TWO_LINKS_ONE_PERMANENT_WORKER_ID_SIX_ROLE_SCOPED_AUDITS_NO_FOREIGN_MUTATION_OR_REPLAY");
  }finally{if(releaseHeld)releaseHeld();await cleanup();}
});
