import assert from "node:assert/strict";
import test from "node:test";
import {readFile,realpath} from "node:fs/promises";
import {resolve,join} from "node:path";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {seedCredentialDecisionFixture} from "../helpers/credential-decision-fixture.mjs";
import {loadTs} from "../../scripts/interview-test-ts-loader.mjs";
const raceKind=process.env.HSE_STAGE_RACE_KIND??"reviewers";
const raceOrder=process.env.HSE_STAGE_RACE_ORDER??"review-first";
test("PostgreSQL appeal race "+raceKind+" "+raceOrder+" commits one coherent result",{timeout:60000},async()=>{
 assert.ok(["review-first","withdraw-first"].includes(raceOrder));
 assert.ok(["reviewers","review-withdraw"].includes(raceKind));
 assert.ok(process.env.HSE_SOFTWARE_STAGE_CONFIG,"Explicit isolated staging config is required");
 const config=JSON.parse(await readFile(process.env.HSE_SOFTWARE_STAGE_CONFIG,"utf8"));
 assert.equal(config.syntheticOnly,true);
 assert.equal(new URL(config.url).protocol,"https:");
 const environment=config.applicationEnvironment;
 assert.equal(environment.HSE_APP_ENV,"production");
 assert.equal(environment.HSE_DATABASE_DRIVER,"postgres");
 assert.equal(environment.HSE_DEPLOYMENT_ID,"oracle-protected-staging");
 assert.equal(new URL(environment.DATABASE_URL).hostname,"127.0.0.1");
 assert.equal(await realpath(config.privateRoot),resolve(config.privateRoot));
 assert.ok(config.privateRoot.startsWith(resolve(config.projectRoot,"..")+"/hse-https-stage."));
 assert.equal(await realpath(environment.HSE_PRIVATE_OBJECT_STORAGE_ROOT),join(config.privateRoot,"private-objects"));
 const accounts=JSON.parse(await readFile(config.accountsPath,"utf8"));
 const db=await openScriptDatabase({databaseDriver:"postgres",databaseUrl:environment.DATABASE_URL});
 const offsets=Object.fromEntries(await Promise.all([config.appLog,config.postgresLog].map(async path=>[path,(await readFile(path)).length])));
 try{
  const workerId=(await db.query("SELECT worker_reference FROM auth_accounts WHERE account_id=$1",[accounts.worker.accountId])).rows[0].worker_reference;
  assert.ok(workerId);
  const fixture=await seedCredentialDecisionFixture(db,{qualification:"HSE Operational Assurance",policy:{credentialValidity:"no_expiry"},workerAccountId:accounts.worker.accountId,permanentWorkerId:workerId,signingSecret:environment.HSE_CREDENTIAL_SIGNING_SECRET,tenantId:accounts.company.tenantId});
  const issuedAt="2026-09-20T10:00:00.000Z",actor="account_original_appeal_stage_admin";
  await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,'original-stage-admin@example.test','Synthetic original decision admin','active','test-only',$2,$2,$2,$2)",[actor,issuedAt]);
  await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)",[actor,issuedAt]);
  await fixture.repo.saveDecisionAndProgressCase(fixture.decision,actor);
  const originalCase=(await db.query("SELECT * FROM assurance_cases WHERE case_id=$1",[fixture.caseId])).rows[0];
  const latest=(await db.query("SELECT case_id,credential_reference FROM assurance_cases WHERE tenant_id=$1 AND worker_account_id=$2 ORDER BY updated_at DESC,created_at DESC LIMIT 1",[accounts.company.tenantId,accounts.worker.accountId])).rows[0];
  assert.equal(latest.case_id,fixture.caseId,"Dedicated fixture must be the selected latest Company case");
  assert.equal(latest.credential_reference,originalCase.credential_reference);
  const credentialId=originalCase.credential_reference;
  assert.ok(credentialId);
  const signedBefore=(await db.query("SELECT signature,qr_payload FROM credential_issuances WHERE credential_id=$1",[credentialId])).rows[0];
  const invitationId="worker_invitation_"+"q".repeat(24),linkId="company_worker_link_"+"q".repeat(24);
  await db.query(`INSERT INTO company_worker_invitations(invitation_id,tenant_id,email_normalized,token_hash,invitation_status,payment_responsibility,invited_by_membership_id,accepted_by_worker_account_id,resend_available_at,expires_at,accepted_at,created_at,updated_at)
   VALUES($1,$2,$3,'synthetic-stage-link','accepted','company',$4,$5,$6,'2099-01-01',$6,$6,$6)`,[invitationId,accounts.company.tenantId,accounts.worker.email,accounts.company.membershipId,accounts.worker.accountId,issuedAt]);
  await db.query(`INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,link_source,invitation_id,link_status,payment_responsibility,requested_by_membership_id,worker_accepted_at,activated_at,created_at,updated_at)
   VALUES($1,$2,$3,'invitation',$4,'active','company',$5,$6,$6,$6,$6)`,[linkId,accounts.company.tenantId,accounts.worker.accountId,invitationId,accounts.company.membershipId,issuedAt]);

  const {CredentialAppealsService}=loadTs("src/lib/credential/credential-appeals-service.ts");
  const service=new CredentialAppealsService(Promise.resolve(db),environment.HSE_CREDENTIAL_SIGNING_SECRET);
  const appeal=await service.submit({credentialId,workerId,reason:"Concurrent independent decisions must remain coherent",createdAt:new Date().toISOString()},"postgres-race");
  const secondReviewer="account_appeal_stage_reviewer_two";
  await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,'second-stage-reviewer@example.test','Synthetic reviewer two','active','test-only',$2,$2,$2,$2)",[secondReviewer,issuedAt]);
  await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)",[secondReviewer,issuedAt]);
  const clients=[];
  try{for(let index=0;index<2;index++)clients.push(await openScriptDatabase({databaseDriver:"postgres",databaseUrl:environment.DATABASE_URL}));}
  catch(error){await Promise.all(clients.map(client=>client.close()));throw error;}
  const pids=[],readVersions=[],reached=new Set(),caseAcquisitions=[];
  const firstIndex=raceOrder==="withdraw-first"?1:0;
  let releasePrimary;
  const primary=new Promise(resolvePrimary=>{releasePrimary=resolvePrimary;});
  const orderTimer=setTimeout(releasePrimary,8000);
  let releaseBarrier;
  const barrier=new Promise(resolveBarrier=>{releaseBarrier=resolveBarrier;});
  const timer=setTimeout(releaseBarrier,1000);
  const wrapped=clients.map((client,index)=>({
    transaction:operation=>client.transaction(async tx=>{
      await tx.execute("SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='10s'");
      pids[index]=Number((await tx.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      const wrap=base=>({
        query:async(sql,parameters)=>{
          const orderedSource=raceKind==="review-withdraw"&&sql.includes("assurance_cases")&&/FOR\s+UPDATE/i.test(sql);
          if(orderedSource&&index!==firstIndex)await primary;
          if(/^\s*UPDATE\s+credential_appeals\b/i.test(sql)){
            reached.add(index);
            if(reached.size===2)releaseBarrier();
            await barrier;

          }
          const result=await base.query(sql,parameters);
          if(orderedSource){caseAcquisitions.push(index);if(index===firstIndex)releasePrimary();}
          if(/^\s*SELECT[\s\S]*FROM\s+credential_appeals\s+WHERE\s+appeal_id=/i.test(sql))readVersions[index]=Number(result.rows[0]?.version);
          return result;
        },
        execute:(...args)=>base.execute(...args),
        transaction:fn=>base.transaction(nested=>fn(wrap(nested)))
      });
      try{return await operation(wrap(tx));}catch(error){releasePrimary();releaseBarrier();throw error;}
    })
  }));
  try{
    const results=await Promise.allSettled(wrapped.map((database,index)=>{
      const commands=new CredentialAppealsService(Promise.resolve(database),environment.HSE_CREDENTIAL_SIGNING_SECRET);
      return raceKind==="review-withdraw"&&index===1
        ? commands.withdraw(appeal,workerId)
        : commands.reviewOutcome(appeal,{status:"accepted",reviewerId:index?secondReviewer:accounts.admin.accountId,reason:"Independent racing "+(index?"revoke":"suspend")+" decision",outcomeAction:index?"revoke":"suspend",reviewedAt:new Date().toISOString()});
    }));
    assert.ok(reached.size>0);
    if(raceKind==="reviewers")assert.equal(reached.size,2,"Both reviewers must eventually attempt the real version-guarded update");
    assert.equal(new Set(pids).size,2,"Distinct backend PIDs must be observed inside the actual transactions");
    if(raceKind==="reviewers")assert.deepEqual(readVersions,[1,1],"Both transactions must have read the same original version");
    assert.equal(results.filter(result=>result.status==="fulfilled").length,1);
    const rejected=results.filter(result=>result.status==="rejected");
    assert.equal(rejected.length,1);
    assert.match(rejected[0].reason.message,/conflict/i,"The losing reviewer must receive a version conflict, never a deadlock or timeout");
    const committed=results.find(result=>result.status==="fulfilled").value;
    const winner=committed.appeal??committed;
    const withdrawn=winner.status==="withdrawn";
    if(raceKind==="review-withdraw"){
      assert.equal(caseAcquisitions[0],firstIndex,"Requested case-lock acquisition order must be observed");
      assert.equal(withdrawn,raceOrder==="withdraw-first","Each forced winner must match its acquisition order");
    }
    const expected=withdrawn?"valid":winner.outcomeAction==="suspend"?"suspended":"revoked";
    const stored=(await db.query("SELECT outcome_action,version,status FROM credential_appeals WHERE appeal_id=$1",[appeal.appealId])).rows[0];
    assert.equal(stored.outcome_action,winner.outcomeAction);assert.equal(stored.status,winner.status);assert.equal(Number(stored.version),2);
    assert.equal((await db.query("SELECT status FROM credential_issuances WHERE credential_id=$1",[credentialId])).rows[0].status,expected);
    const living=(await db.query("SELECT versions.status FROM living_record_versions versions JOIN living_record_competencies competency USING(competency_id) WHERE competency.source_credential_id=$1 ORDER BY versions.version DESC",[credentialId])).rows;
    assert.deepEqual(living.map(row=>row.status),withdrawn?["valid"]:[expected,"valid"]);
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM credential_appeal_events WHERE appeal_id=$1",[appeal.appealId])).rows[0].n),2);
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM credential_lifecycle_events WHERE credential_id=$1",[credentialId])).rows[0].n),withdrawn?1:2);
    const {PublicVerificationRepository}=loadTs("src/lib/public-verification/public-verification-repository.ts");
    const {PublicVerificationService}=loadTs("src/lib/public-verification/public-verification-service.ts");
    const publicService=new PublicVerificationService(new PublicVerificationRepository(db),environment.HSE_SESSION_SECRET,[environment.HSE_CREDENTIAL_SIGNING_SECRET]);
    const fingerprint="a".repeat(64),lookup=await publicService.lookupPublicVerification({rawIdentifier:credentialId,requestFingerprint:fingerprint});
    assert.equal(lookup.kind,"redirect");
    const resolved=await publicService.resolvePublicVerificationCapability({publicToken:lookup.publicToken,requestFingerprint:fingerprint});
    assert.equal(resolved.projection.status,expected);
    assert.deepEqual((await db.query("SELECT signature,qr_payload FROM credential_issuances WHERE credential_id=$1",[credentialId])).rows[0],signedBefore);
    const at=new Date().toISOString(),expiresAt=new Date(Date.now()+3600000).toISOString(),sessionId="session_postgres_concurrent_company";
    await db.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,'company','synthetic-race-token','synthetic-race-csrf',$3,$3,$4)",[sessionId,accounts.company.accountId,at,expiresAt]);
    const principal={accountId:accounts.company.accountId,sessionId,activeRole:"company",accountStatus:"active",email:accounts.company.email,displayName:"Synthetic Company",createdAt:at,lastSeenAt:at,expiresAt,authorizedTenantPermission:"company.workforce.manage",tenantMembership:{tenantId:accounts.company.tenantId,tenantStatus:"active",membershipId:accounts.company.membershipId,role:"owner",status:"active",overrides:[]}};
    const {CompanyWorkforceDirectoryService}=loadTs("src/lib/company/company-workforce-directory-service.ts");
    const company=new CompanyWorkforceDirectoryService(Promise.resolve(db));
    assert.equal((await company.find(principal,linkId)).currentCompetencyStatus,expected);
    const backupOwner="account_company_backup_owner",backupMembership="membership_"+"k".repeat(24);
    await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,'backup-owner@example.test','Synthetic backup owner','active','test-only',$2,$2,$2,$2)",[backupOwner,at]);
    await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'company',$2)",[backupOwner,at]);
    await db.query("INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at) VALUES($1,$2,$3,'company','owner','active',$4,$5,$5,$5)",[backupMembership,accounts.company.tenantId,backupOwner,accounts.company.accountId,at]);
    const businessSnapshot=async()=>JSON.stringify(await Promise.all(["credential_appeals","credential_appeal_events","credential_issuances","credential_lifecycle_events","living_record_versions"].map(async table=>(await db.query("SELECT * FROM "+table+" ORDER BY 1,2")).rows)));
    const unchanged=await businessSnapshot();
    const denied=async()=>{
      await assert.rejects(company.find(principal,linkId),error=>error.name==="TenantScopeDeniedError");
      await assert.rejects(company.search(principal,{}),error=>error.name==="TenantScopeDeniedError");
      assert.equal(await businessSnapshot(),unchanged,"Denied reads must not change appeal or competency history");
    };
    const recovered=async(actor=principal)=>{
      assert.equal((await company.find(actor,linkId)).currentCompetencyStatus,expected);
      assert.equal((await company.search(actor,{})).rows.find(row=>row.linkId===linkId).currentCompetencyStatus,expected);
    };
    await db.query("INSERT INTO auth_tenant_permission_overrides(membership_id,membership_role,permission_key,effect,reason) VALUES($1,'owner','company.workforce.manage','deny','Synthetic live permission revocation')",[accounts.company.membershipId]);
    await denied();
    await db.query("DELETE FROM auth_tenant_permission_overrides WHERE membership_id=$1 AND permission_key='company.workforce.manage'",[accounts.company.membershipId]);
    await recovered();
    await db.query("UPDATE auth_tenant_memberships SET membership_status='suspended',suspended_at=clock_timestamp(),updated_at=clock_timestamp() WHERE membership_id=$1",[accounts.company.membershipId]);
    await denied();
    await db.query("UPDATE auth_tenant_memberships SET membership_status='active',suspended_at=NULL,updated_at=clock_timestamp() WHERE membership_id=$1",[accounts.company.membershipId]);
    await recovered();
    await db.query("UPDATE auth_sessions SET revoked_at=clock_timestamp(),revocation_reason='Synthetic stale-session probe' WHERE session_id=$1",[sessionId]);
    await denied();
    const replacementSession=sessionId+"_replacement";
    await db.query("INSERT INTO auth_sessions(session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at) VALUES($1,$2,'company','synthetic-replacement-token','synthetic-replacement-csrf',$3,$3,$4)",[replacementSession,accounts.company.accountId,at,expiresAt]);
    await recovered({...principal,sessionId:replacementSession});
    await denied();

    assert.deepEqual((await db.query("SELECT * FROM assurance_cases WHERE case_id=$1",[fixture.caseId])).rows[0],originalCase);
    for(const path of [config.appLog,config.postgresLog]){
      const output=(await readFile(path)).subarray(offsets[path]).toString("utf8");
      assert.doesNotMatch(output,/deadlock detected|\b(?:ERROR|FATAL|PANIC):/i);
    }
    console.log("POSTGRES_APPEAL_RACE_PASS",raceKind,"distinct transaction backends; one commit, one conflict; coherent histories and public state");
  }finally{
    clearTimeout(timer);clearTimeout(orderTimer);releasePrimary();releaseBarrier();
    await Promise.all(clients.map(client=>client.close()));
  }
 }finally{await db.close();}
});
