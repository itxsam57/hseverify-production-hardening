import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

import { seedCredentialDecisionFixture } from "../helpers/credential-decision-fixture.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

async function database() {
  const environment={appEnvironment:"test",databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:"memory://",releaseSha:"appeal-consumer-runtime",sessionSecret:"consumer-session-secret-more-than-thirty-two-characters",authPepper:"consumer-auth-pepper-more-than-thirty-two-characters",authSandboxEnabled:false,authSandboxAccessKey:null,demoAuthEnabled:false,demoDataEnabled:false};
  const db=await openScriptDatabase(environment);
  await applyMigrationsThrough(db,environment.releaseSha,"0067_assessment_review_orchestration");
  const fixture=await seedCredentialDecisionFixture(db,{policy:{credentialValidity:"no_expiry"},qualification:"HSE Operational Assurance",permanentWorkerId:"worker_id_"+"p".repeat(24)});
  const at = "2026-09-25T11:00:00.127Z";
  await applyMigrationsThrough(db, fixture.environment.releaseSha, "0074_credential_appeal_operational_workflow");
  for (const id of ["original_decision_admin", "account_admin_reviewer_01", "account_admin_reviewer_02"]) {
    await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,'Independent test admin','active','test-only',$3,$3,$3,$3)", [id,id+"@example.test",at]);
    await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)",[id,at]);
  }
  await fixture.repo.saveDecisionAndProgressCase(fixture.decision,"original_decision_admin");
  const credentialId=(await db.query("SELECT credential_reference FROM assurance_cases WHERE case_id=$1",[fixture.caseId])).rows[0].credential_reference;
  return {db,credentialId,workerId:"worker_id_"+"p".repeat(24)};
}


for(const [action,expected] of [["reassessment","reassessment_required"],["suspend","suspended"],["revoke","revoked"],["none","valid"]])
test("accepted "+action+" reaches an existing public capability without leaking private appeal text",async()=>{
 const {db,credentialId,workerId}=await database();
 try {
  const {PublicVerificationRepository}=loadTs("src/lib/public-verification/public-verification-repository.ts");
  const {PublicVerificationService}=loadTs("src/lib/public-verification/public-verification-service.ts");
  const verifier=new PublicVerificationService(new PublicVerificationRepository(db),"public-test-session-secret-more-than-thirty-two-characters",["credential-validity-dedicated-test-signing-key-more-than-32"]);
  const fingerprint="b".repeat(64), now=new Date("2026-10-02T02:00:00Z");
  const lookup=await verifier.lookupPublicVerification({rawIdentifier:credentialId,requestFingerprint:fingerprint,now});
  assert.equal(lookup.kind,"redirect");
  const resolve=()=>verifier.resolvePublicVerificationCapability({publicToken:lookup.publicToken,requestFingerprint:fingerprint,now});
  const signedBefore=(await db.query("SELECT signature,qr_payload FROM credential_issuances WHERE credential_id=$1",[credentialId])).rows[0];
  const before=await resolve();assert.equal(before.kind,"projection");assert.equal(before.projection.status,"valid");
  const {CredentialAppealsService}=loadTs("src/lib/credential/credential-appeals-service.ts");
  const service=new CredentialAppealsService(Promise.resolve(db));
  const appeal=await service.submit({credentialId,workerId,reason:"PRIVATE_GROUNDS_c029d4 should never reach recipients",createdAt:"2026-10-02T01:00:00Z"},"consumer-regression");
  await service.reviewOutcome(appeal,{status:"accepted",reviewerId:"account_admin_reviewer_01",reason:"PRIVATE_REVIEW_847cca requires reassessment",outcomeAction:action,reviewedAt:"2026-10-02T01:30:00Z"});
  const after=await resolve();
  assert.equal(after.kind,"projection");
  assert.equal(after.projection.status,expected,"Existing public capability must stop reporting unconditional validity after accepted reassessment");
  assert.doesNotMatch(JSON.stringify(after),/PRIVATE_GROUNDS|PRIVATE_REVIEW/);
  const issuance=(await db.query("SELECT status FROM credential_issuances WHERE credential_id=$1",[credentialId])).rows[0];
  assert.equal(issuance.status,action==="suspend"?"suspended":action==="revoke"?"revoked":"valid");
  assert.deepEqual((await db.query("SELECT signature,qr_payload FROM credential_issuances WHERE credential_id=$1",[credentialId])).rows[0],signedBefore);
  assert.equal((await new PublicVerificationRepository(db).findPublicCredentialById(credentialId,["credential-validity-dedicated-test-signing-key-more-than-32"])).authentication,"authenticated");
  const versionCount=async()=>Number((await db.query("SELECT count(*) AS n FROM living_record_versions")).rows[0].n);
  const count=await versionCount();
  await assert.rejects(service.reviewOutcome(appeal,{status:"accepted",reviewerId:"account_admin_reviewer_01",reason:"Stale retry must not append",outcomeAction:action}),/conflict/i);
  assert.equal(await versionCount(),count);
  assert.equal((await resolve()).projection.status,expected);
  if(action==="reassessment"){
    const {LivingRecordRepository}=loadTs("src/lib/living-record/living-record-repository.ts");
    const {appendLivingCompetencyVersion,currentLivingCompetencyVersion}=loadTs("src/lib/living-record/living-record-domain.ts");
    const living=new LivingRecordRepository(Promise.resolve(db));
    const [record]=await living.findByCredential(credentialId);
    const prior=currentLivingCompetencyVersion(record);
    await living.replaceCompetencyRecord(workerId,appendLivingCompetencyVersion(record,{...prior,status:"valid",effectiveAt:"2026-10-02T01:45:00Z",reassessment:{required:false,dueAt:null,reason:null}}));
    assert.equal((await resolve()).projection.status,"valid","Latest valid version clears historical reassessment");
  }
 } finally {await db.close();}
});

const oid=(prefix,c)=>prefix+"_"+c.repeat(24),NOW="2026-10-02T00:00:00Z",FUTURE="2099-01-01T00:00:00Z";
async function seedCompany(database,c){const x={accountId:`account_m203_company_${c}`,tenantId:oid("tenant",c),membershipId:oid("membership",c),sessionId:`session_m203_company_${c}`,email:`m203-${c.toLowerCase()}@example.com`};await database.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,$3,'active',$4,$5,$5,$5,$5)`,[x.accountId,x.email,`Company ${c}`,"scrypt$16384$8$1$salt$hash",NOW]);await database.query(`INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'company',$2)`,[x.accountId,NOW]);await database.query(`INSERT INTO platform_tenants(tenant_id,tenant_type,display_name,tenant_status,created_by_account_id,created_at,updated_at,activated_at) VALUES($1,'company',$2,'active',$3,$4,$4,$4)`,[x.tenantId,`Company ${c}`,x.accountId,NOW]);await database.query(`INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at) VALUES($1,$2,$3,'company','owner','active',$3,$4,$4,$4)`,[x.membershipId,x.tenantId,x.accountId,NOW]);await database.query(`INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,'company',$3,$4,$5,$5,$6)`,[x.sessionId,x.accountId,`token-${c}`,`csrf-${c}`,NOW,FUTURE]);await database.query(`INSERT INTO company_verification_cases(case_id,tenant_id,owner_account_id,case_status,lock_version,created_at,updated_at,verified_at) VALUES($1,$2,$3,'verified',0,$4,$4,$4)`,[oid("company_verification",c),x.tenantId,x.accountId,NOW]);return x;}
const settingsPrincipal=x=>Object.freeze({accountId:x.accountId,sessionId:x.sessionId,activeRole:"company",accountStatus:"active",email:x.email,displayName:"Company",createdAt:NOW,lastSeenAt:NOW,expiresAt:FUTURE,tenantMembership:{tenantId:x.tenantId,tenantStatus:"active",membershipId:x.membershipId,role:"owner",status:"active",overrides:[]},authorizedTenantPermission:"company.settings.manage"});

for(const [action,expected] of [["reassessment","reassessment_required"],["suspend","suspended"],["revoke","revoked"],["none","valid"]])
test("authorized Company receives "+action+" separately from original assurance decision",async()=>{
 const {db,credentialId,workerId}=await database();
 try {
  const company=await seedCompany(db,"a");
  await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES('worker_account_validity','worker-propagation@example.test','Synthetic Worker','active','test-only',$1,$1,$1,$1)",[NOW]);

  await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES('worker_account_validity','worker',$1)",[NOW]);
  const identityId=oid("worker_identity","p"),identityVersion=oid("identity_version","p");
  await db.query("INSERT INTO worker_identities(identity_id,worker_account_id,lifecycle_status,current_version_number,lock_version,created_at,updated_at) VALUES($1,'worker_account_validity','draft',1,1,$2,$2)",[identityId,NOW]);
  await db.query("INSERT INTO worker_identity_versions(identity_version_id,identity_id,version_number,version_kind,version_status,created_by_account_id,created_at,submitted_at) VALUES($1,$2,1,'initial','submitted','worker_account_validity',$3,$3)",[identityVersion,identityId,NOW]);
  for(const [status,lock] of [["submitted",2],["automated_checks",3],["manual_review",4],["verified",5]])await db.query("UPDATE worker_identities SET lifecycle_status=$2,lock_version=$3 WHERE identity_id=$1",[identityId,status,lock]);
  await db.query("INSERT INTO worker_identity_duplicate_checks(check_id,identity_id,identity_version_id,worker_account_id,check_sequence,check_status,created_at) VALUES($1,$2,$3,'worker_account_validity',1,'clear',$4)",[oid("identity_duplicate_check","p"),identityId,identityVersion,NOW]);
  await db.query("INSERT INTO worker_identity_worker_ids(permanent_worker_id,identity_id,identity_version_id,worker_account_id,issued_by_component,issued_at) VALUES($1,$2,$3,'worker_account_validity','identity-assurance',$4)",[workerId,identityId,identityVersion,NOW]);
  const linkId=oid("company_worker_link","z");
  await db.query(`INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,link_status,payment_responsibility,requested_by_membership_id,worker_accepted_at,activated_at,created_at,updated_at)
    VALUES($1,$2,'worker_account_validity',$3,'permanent_worker_id','active','company',$4,$5,$5,$5,$5)`,[linkId,company.tenantId,workerId,company.membershipId,NOW]);
  const principal={...settingsPrincipal(company),authorizedTenantPermission:"company.workforce.manage"};
  const {CompanyWorkforceDirectoryService}=loadTs("src/lib/company/company-workforce-directory-service.ts");
  const directory=new CompanyWorkforceDirectoryService(Promise.resolve(db));
  const original=await directory.find(principal,linkId);assert.ok(original);
  const {CredentialAppealsService}=loadTs("src/lib/credential/credential-appeals-service.ts");
  const appeals=new CredentialAppealsService(Promise.resolve(db));
  const appeal=await appeals.submit({credentialId,workerId,reason:"PRIVATE_GROUNDS_Company must not receive",createdAt:NOW},"company-consumer");
  await appeals.reviewOutcome(appeal,{status:"accepted",reviewerId:"account_admin_reviewer_01",reason:"PRIVATE_REVIEW_Company requires reassessment",outcomeAction:action,reviewedAt:"2026-10-02T01:30:00Z"});
  const current=await directory.find(principal,linkId);
  assert.equal(current.assuranceStatus,original.assuranceStatus,"Historical case decision is retained");
  assert.equal(current.currentCompetencyStatus,expected,"Company must receive current reliance state separately from historical approval");
  const listing=await directory.search(principal,{});
  assert.equal(listing.rows.find(row=>row.linkId===linkId).currentCompetencyStatus,expected);
  assert.doesNotMatch(JSON.stringify({current,listing}),/PRIVATE_GROUNDS|PRIVATE_REVIEW/);
  if(action==="none"){
    const {LivingRecordRepository}=loadTs("src/lib/living-record/living-record-repository.ts");
    const {createLivingCompetencyRecord}=loadTs("src/lib/living-record/living-record-domain.ts");
    const living=new LivingRecordRepository(Promise.resolve(db));
    for(const [id,status] of [["competency_aaaaaaaa","valid"],["competency_zzzzzzzz","suspended"]]){
      await living.replaceCompetencyRecord(workerId,createLivingCompetencyRecord({competencyId:id,title:"Additional scoped competency",sourceCredentialId:credentialId,initial:{status,effectiveAt:"2026-10-02T01:45:00Z",expiresAt:null,restrictions:[],conditions:[],reassessment:{required:false,dueAt:null,reason:null}}}));
    }
    assert.equal((await directory.find(principal,linkId)).currentCompetencyStatus,"suspended","Most restrictive current competency wins regardless of ID ordering");
    assert.equal((await directory.search(principal,{})).rows.find(row=>row.linkId===linkId).currentCompetencyStatus,"suspended");
  }
  const foreign=await seedCompany(db,"f");
  const foreignPrincipal={...settingsPrincipal(foreign),authorizedTenantPermission:"company.workforce.manage"};
  assert.equal(await directory.find(foreignPrincipal,linkId),null);
  assert.equal((await directory.search(foreignPrincipal,{})).total,0);
  await db.query("UPDATE company_worker_links SET link_status='revoked',revoked_at=clock_timestamp() WHERE link_id=$1",[linkId]);
  assert.equal((await directory.find(principal,linkId)).currentCompetencyStatus,null,"Ended relationship receives no current competency state");
 } finally {await db.close();}
});

test("public reassessment reliance status preserves lifecycle, expiry and replacement precedence",()=>{
 const {projectPublicCredentialVerification}=loadTs("src/lib/public-verification/public-verification-domain.ts");
 const base={credentialId:"credential_id_"+"a".repeat(24),qualification:"Synthetic competency",status:"valid",issuedAt:"2026-09-01T00:00:00Z",expiresAt:null,conditional:false,authentication:"authenticated",reassessmentRequired:true};
 for(const [changes,expected] of [[{},"reassessment_required"],[{status:"suspended"},"suspended"],[{status:"revoked"},"revoked"],[{expiresAt:"2026-09-30T00:00:00Z"},"expired"],[{replaced:true},"revoked"]]){
   const result=projectPublicCredentialVerification({...base,...changes},"2026-10-02T02:00:00Z");
   assert.equal(result.status,expected);
 }
});

for(const [action,expected] of [["reassessment","reassessment_required"],["suspend","suspended"],["revoke","revoked"]])
test(action+" failure before Living Record append rolls back all changes and permits legitimate retry",async()=>{
 const {db,credentialId,workerId}=await database();
 try{
  const {CredentialAppealsService}=loadTs("src/lib/credential/credential-appeals-service.ts");
  const service=new CredentialAppealsService(Promise.resolve(db));
  const appeal=await service.submit({credentialId,workerId,reason:"Transactional propagation check",createdAt:NOW},"rollback-consumer");
  const tables=["credential_appeals","credential_appeal_events","credential_issuances","credential_lifecycle_events","living_record_versions"];
  const snapshot=async()=>JSON.stringify(await Promise.all(tables.map(async table=>(await db.query("SELECT * FROM "+table+" ORDER BY 1,2")).rows)));
  const before=await snapshot();
  let injected=false;
  const wrap=base=>({
    query:async(sql,parameters)=>{
      if(/INSERT\s+INTO\s+living_record_versions/i.test(sql)){
        injected=true;throw new Error("Injected Living Record append failure");
      }
      return base.query(sql,parameters);
    },
    execute:(...args)=>base.execute(...args),
    transaction:operation=>base.transaction(nested=>operation(wrap(nested)))
  });
  const failing=new CredentialAppealsService(Promise.resolve(wrap(db)));
  const command={status:"accepted",reviewerId:"account_admin_reviewer_01",reason:"Independent decision needs "+action,outcomeAction:action,reviewedAt:"2026-10-02T01:30:00Z"};
  await assert.rejects(failing.reviewOutcome(appeal,command),/Injected Living Record append failure/);
  assert.equal(injected,true,"Fault must reach actual Living Record write");
  assert.equal(await snapshot(),before,"Appeal, issuance and history all roll back together");
  await service.reviewOutcome(appeal,command);
  const current=(await db.query("SELECT status FROM living_record_versions ORDER BY version DESC LIMIT 1")).rows[0];
  assert.equal(current.status,expected);
 }finally{await db.close();}
});

test("competing accepted appeal outcomes commit exactly one coherent result",async()=>{
 const {db,credentialId,workerId}=await database();
 try{
  const {CredentialAppealsService}=loadTs("src/lib/credential/credential-appeals-service.ts");
  const service=new CredentialAppealsService(Promise.resolve(db));
  const appeal=await service.submit({credentialId,workerId,reason:"Concurrent decisions must never diverge",createdAt:NOW},"competing-consumer");
  const results=await Promise.allSettled(["suspend","revoke"].map(outcomeAction=>service.reviewOutcome(appeal,{status:"accepted",reviewerId:"account_admin_reviewer_01",reason:"Independent "+outcomeAction+" decision",outcomeAction,reviewedAt:"2026-10-02T01:30:00Z"})));
  assert.equal(results.filter(result=>result.status==="fulfilled").length,1);
  assert.equal(results.filter(result=>result.status==="rejected").length,1);
  assert.match(results.find(result=>result.status==="rejected").reason.message,/conflict/i);
  const winner=results.find(result=>result.status==="fulfilled").value.appeal;
  const stored=(await db.query("SELECT outcome_action FROM credential_appeals WHERE appeal_id=$1",[appeal.appealId])).rows[0];
  assert.equal(stored.outcome_action,winner.outcomeAction);
  const issued=(await db.query("SELECT status FROM credential_issuances WHERE credential_id=$1",[credentialId])).rows[0];
  const living=(await db.query("SELECT status FROM living_record_versions ORDER BY version DESC LIMIT 1")).rows[0];
  assert.equal(living.status,issued.status);
  assert.equal(issued.status,winner.outcomeAction==="suspend"?"suspended":"revoked");
  assert.equal(Number((await db.query("SELECT count(*) AS n FROM credential_appeal_events WHERE appeal_id=$1",[appeal.appealId])).rows[0].n),2);
  assert.equal(Number((await db.query("SELECT count(*) AS n FROM living_record_versions")).rows[0].n),2);
 }finally{await db.close();}
});
