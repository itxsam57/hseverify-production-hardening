import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_COMPANY_WORKFORCE_RUNTIME_DIST;
assert.ok(runtime, "HSE_COMPANY_WORKFORCE_RUNTIME_DIST is required");
const serviceModule = await import(pathToFileURL(join(runtime, "company", "company-workforce-service.js")).href);
const domainModule = await import(pathToFileURL(join(runtime, "company", "company-workforce-domain.js")).href);
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
    const active=await service.acceptWorkerLink(workerPrincipal(worker),pending.linkId); assert.equal(active.status,"active");
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
