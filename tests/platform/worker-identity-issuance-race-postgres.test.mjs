import assert from "node:assert/strict";
import test from "node:test";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
import {prepareSubmittedWorker,advanceThroughAutomatedChecks,markVerified,seedPrincipal} from "../helpers/duplicate-identity-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";

const {DatabaseWorkerIdentityRepository}=loadWorkerRegistrationTs("src/lib/identity/worker-identity-repository.ts");
const {DatabaseWorkerIdentityCorrectionRepository}=loadWorkerRegistrationTs("src/lib/identity/worker-identity-correction-repository.ts");
const base=process.env.HSE_POSTGRES_TEST_DATABASE_URL;
if(!base)throw new Error("Isolated HSE_POSTGRES_TEST_DATABASE_URL is required for two-session duplicate Worker identity race.");
const databaseName="hse_identity_race_"+process.pid;
const env={appEnvironment:"test",databaseDriver:"postgres",databaseUrl:null,releaseSha:"identity-race-postgres-"+process.pid};

test("actual two-connection PostgreSQL: later duplicate identity submission must serialize before Worker ID issuance",{timeout:180000},async()=>{
  const url=new URL(base);
  const admin=await openScriptDatabase({...env,databaseUrl:url.href});
  let db,second,holdRelease,submit,issuance;
  try{
    await admin.execute('CREATE DATABASE "'+databaseName+'"');
    url.pathname="/"+databaseName;
    env.databaseUrl=url.href;
    db=await openScriptDatabase(env);
    await applyMigrationsThrough(db,env.releaseSha,"0120_review_recovery_notifications");
    const draft={legalFirstName:"Rashid",legalLastName:"Race",dateOfBirth:"1988-07-03"};
    const first=await prepareSubmittedWorker(db,"race-first",{
      draft,documentNumber:"RACE-IDENTITY-937"
    });
    await advanceThroughAutomatedChecks(first);
    await markVerified(db,first.submitted.identity.identityId);
    const clear=await first.eligibilityService.evaluate(first.submitted.identity.identityId);
    assert.equal(clear.checkStatus,"clear");
    const competing=await prepareSubmittedWorker(db,"race-second",{
      draft,documentNumber:"RACEIDENTITY937",deferSubmission:true
    });
    second=await openScriptDatabase(env);
    let announce;
    const submittedUncommitted=new Promise(resolve=>announce=resolve);
    const held=new Promise(resolve=>holdRelease=resolve);
    const blockingDatabase={
      ...second,
      async transaction(callback){
        return second.transaction(async tx=>{
          const value=await callback(tx);
          announce();
          await held;
          return value;
        });
      }
    };
    const secondRepository=new DatabaseWorkerIdentityRepository(Promise.resolve(blockingDatabase));
    submit=secondRepository.submitOwn(competing.worker,competing.initial.identity.lockVersion);
    await submittedUncommitted;
    // Candidate is already submitted inside its real production transaction, but not committed.
    // The first Worker's issuance must wait until the competing submission commits.
    const pending=first.eligibilityService.issuePermanentWorkerId(first.submitted.identity.identityId);
    issuance=pending.then(value=>({ok:true,value}),error=>({ok:false,name:error.name,message:error.message}));
    const early=await Promise.race([
      issuance.then(()=> "issued_before_competing_submission_committed"),
      new Promise(resolve=>setTimeout(()=>resolve("still_waiting_for_commit"),1200))
    ]);
    assert.equal(early,"still_waiting_for_commit",
      "Two independent PostgreSQL connections must not issue Worker ID while a newly matching identity submission remains uncommitted");
    holdRelease();
    await submit;
    const result=await issuance;
    assert.equal(result.ok,false,
      "After competing duplicate commits, previously clear Worker must require a fresh check.");
    assert.equal(result.name,"WorkerIdentityWorkerIdBlockedError");
    const ids=(await db.query("SELECT worker_account_id FROM worker_identity_worker_ids")).rows;
    assert.equal(ids.length,0,"Neither Worker may receive a permanent ID while collision is unresolved.");
    const identities=(await db.query("SELECT worker_account_id,lifecycle_status FROM worker_identities WHERE worker_account_id=ANY($1::text[])",[[first.worker.accountId,competing.worker.accountId]])).rows;
    assert.equal(identities.length,2);
    assert.equal(identities.find(x=>x.worker_account_id===competing.worker.accountId).lifecycle_status,"submitted");
    console.log("ACTUAL_POSTGRES_IDENTITY_RACE second Worker real submit transaction held before commit, competing verified Worker ID waits, then rejects stale duplicate check; no ID issued/no merge");
  }finally{
    holdRelease?.();
    await Promise.allSettled([submit,issuance]);
    await second?.close();
    await db?.close();
    try{await admin.execute('DROP DATABASE "'+databaseName+'"');}finally{await admin.close();}
  }
});


test("actual PostgreSQL 16: verified identity remains a duplicate candidate throughout pending corrections",{timeout:180000},async()=>{
  const url=new URL(base);
  const admin=await openScriptDatabase({...env,databaseUrl:url.href});
  const correctionDatabaseName=databaseName+"_correction";
  let db;
  try{
    await admin.execute('CREATE DATABASE "'+correctionDatabaseName+'"');
    url.pathname="/"+correctionDatabaseName;
    db=await openScriptDatabase({...env,databaseUrl:url.href,releaseSha:"postgres-identity-correction"});
    await applyMigrationsThrough(db,"postgres-identity-correction","0125_worker_identity_duplicate_correction_candidates");
    const draft={legalFirstName:"Mina",legalLastName:"Hassan",dateOfBirth:"1992-09-14"};
    const established=await prepareSubmittedWorker(db,"pg-corr-one",{draft,documentNumber:"PG-CORR-8765"});
    await advanceThroughAutomatedChecks(established);
    await markVerified(db,established.submitted.identity.identityId);
    assert.equal((await established.eligibilityService.evaluate(established.submitted.identity.identityId)).checkStatus,"clear");
    await established.eligibilityService.issuePermanentWorkerId(established.submitted.identity.identityId);
    const correction=new DatabaseWorkerIdentityCorrectionRepository(Promise.resolve(db));
    const lock=(await db.query("SELECT lock_version FROM worker_identities WHERE identity_id=$1",[established.submitted.identity.identityId])).rows[0].lock_version;
    const pending=await correction.requestOwn(established.worker,{
      expectedLockVersion:Number(lock),reason:"Updated lawful passport details requested for verified identity."
    });
    const second=await prepareSubmittedWorker(db,"pg-corr-two",{draft,documentNumber:"PGCORR8765"});
    await advanceThroughAutomatedChecks(second);
    await markVerified(db,second.submitted.identity.identityId);
    const check=await second.eligibilityService.evaluate(second.submitted.identity.identityId);
    assert.equal(check.checkStatus,"review_required",
      "PostgreSQL cannot omit original verified identity while correction draft is current.");
    const rows=(await db.query("SELECT candidate_identity_version_id FROM worker_identity_duplicate_signals WHERE check_id=$1",[check.checkId])).rows;
    assert.ok(rows.length>0);
    assert.ok(rows.every(row=>row.candidate_identity_version_id===established.submitted.currentVersion.identityVersionId));
    const afterLock=(await db.query("SELECT lock_version FROM worker_identities WHERE identity_id=$1",[established.submitted.identity.identityId])).rows[0].lock_version;
    await correction.submitOwn(established.worker,Number(afterLock));
    const after=await second.eligibilityService.evaluate(second.submitted.identity.identityId);
    assert.equal(after.checkStatus,"review_required",
      "Even a submitted, unapproved correction must not overwrite its verified parent as candidate.");
    const candidateRows=(await db.query("SELECT candidate_identity_version_id FROM worker_identity_duplicate_signals WHERE check_id=$1",[after.checkId])).rows;
    assert.ok(candidateRows.length>0);
    assert.ok(candidateRows.every(row=>row.candidate_identity_version_id===established.submitted.currentVersion.identityVersionId));
    await assert.rejects(
      second.eligibilityService.issuePermanentWorkerId(second.submitted.identity.identityId),
      error=>error?.name==="WorkerIdentityWorkerIdBlockedError"
    );
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM worker_identity_worker_ids")).rows[0].n,1,
      "Only the original permanent Worker ID may exist before human duplicate disposition.");
    assert.notEqual(pending.correctionVersionId,established.submitted.currentVersion.identityVersionId);
    console.log("ACTUAL_POSTGRES_PENDING_CORRECTION duplicate-check parent retained in draft+submitted, approved identity stable, second ID denied");
  }finally{
    await db?.close();
    try{await admin.execute('DROP DATABASE "'+correctionDatabaseName+'"');}
    finally{await admin.close();}
  }
});


test("M1.07.07 two genuine Admins racing duplicate dispositions serialize and stale loser cannot issue Worker ID", {timeout:180000}, async () => {
 const url=new URL(base);
 const supervisor=await openScriptDatabase({...env,databaseUrl:url.href});
 const isolatedName="hse_m10707_admin_race_"+process.pid;
 let first,second,created=false,releaseFirst,pendingFirst,pendingSecond;
 try {
  await supervisor.execute('CREATE DATABASE "'+isolatedName+'"');
  created=true;
  url.pathname="/"+isolatedName;
  const config={...env,databaseUrl:url.href,releaseSha:"m10707-admin-race-"+process.pid};
  first=await openScriptDatabase(config);
  await applyMigrationsThrough(first,config.releaseSha,"0130_verified_identity_correction_notices");
  second=await openScriptDatabase(config);
  const target=await prepareSubmittedWorker(first,"admin-race-target",{documentNumber:"CONCURRENT-ADMIN-DOC-931"});
  const matching=await prepareSubmittedWorker(first,"admin-race-match",{documentNumber:"CONCURRENTADMINDOC931"});
  await advanceThroughAutomatedChecks(target);
  await advanceThroughAutomatedChecks(matching);
  await markVerified(first,target.submitted.identity.identityId);
  const check=await target.eligibilityService.evaluate(target.submitted.identity.identityId);
  assert.equal(check.checkStatus,"review_required");
  const firstAdmin=await seedPrincipal(first,"admin-race-first","admin");
  const secondAdmin=await seedPrincipal(first,"admin-race-second","admin");
  const {AuthAccessRepository}=loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
  const auth=new AuthAccessRepository(first);
  const now=new Date().toISOString();
  for(const [i,actor] of [firstAdmin,secondAdmin].entries()){
    const mfaId="duplicate-race-mfa-"+i;
    await auth.authentication.insertSecurityEvent({
      eventId:mfaId,accountId:actor.accountId,eventType:"mfa_succeeded",activeRole:"admin",occurredAt:now
    });
    await auth.authentication.insertSecurityEvent({
      eventId:"duplicate-race-login-"+i,accountId:actor.accountId,eventType:"login_succeeded",
      activeRole:"admin",metadata:{sessionId:actor.sessionId,mfaEventId:mfaId},occurredAt:now
    });
  }
  const {DuplicateIdentityReviewService}=loadWorkerRegistrationTs("src/lib/identity/duplicate-identity-review-service.ts");
  const input={identityId:check.identityId,identityVersionId:check.identityVersionId,checkId:check.checkId,expectedRevision:0};
  let signal;
  const heldAfterWrites=new Promise(resolve=>signal=resolve);
  const blocked=new Promise(resolve=>releaseFirst=resolve);
  const heldTransaction={
    ...first,
    async transaction(callback){
      return first.transaction(async tx=>{
        const result=await callback(tx);
        signal();
        await blocked;
        return result;
      });
    }
  };
  const primary=new DuplicateIdentityReviewService(heldTransaction);
  const competing=new DuplicateIdentityReviewService(second);
  pendingFirst=primary.decide(firstAdmin,{...input,disposition:"duplicate_review",
    reason:"Independent matching documents require a second human comparison before any Worker ID may be issued."});
  await heldAfterWrites;
  pendingSecond=competing.decide(secondAdmin,{...input,disposition:"continue",
    reason:"An independent contrary decision must not bypass a locked earlier review."})
    .then(()=>({accepted:true}),error=>({accepted:false,name:error.name,message:error.message}));
  const early=await Promise.race([
    pendingSecond.then(()=> "returned_before_first_commit"),
    new Promise(resolve=>setTimeout(()=>resolve("blocked_on_first_commit"),1100))
  ]);
  assert.equal(early,"blocked_on_first_commit",
    "A second genuine independent Admin connection must wait while the first duplicate disposition is uncommitted.");
  releaseFirst();
  await pendingFirst;
  const stale=await pendingSecond;
  assert.equal(stale.accepted,false,"Both competing Admins cannot finalize the same revision.");
  assert.match(stale.message,/changed|reload|stale|issued/i);
  const recorded=(await first.query(
    "SELECT disposition,disposition_sequence FROM worker_identity_duplicate_dispositions WHERE check_id=$1",
    [check.checkId]
  )).rows;
  assert.deepEqual(recorded,[{disposition:"duplicate_review",disposition_sequence:1}]);
  assert.equal((await first.query(
    "SELECT count(*)::int n FROM worker_identity_worker_ids WHERE worker_account_id=$1",
    [target.worker.accountId]
  )).rows[0].n,0,
  "Stale competing continue request cannot issue an independent Worker ID.");
  assert.equal((await first.query(
    "SELECT count(*)::int n FROM platform_audit_events WHERE metadata->>'duplicateReviewCheckId'=$1",
    [check.checkId]
  )).rows[0].n,1);
  console.log("M10707_REAL_POSTGRES_CONCURRENT_ADMIN_DECISION_WINNER",
    "two authenticated MFA Admins and independent PG16 sessions; second decision waits for first commit then stale loser denied, exact one disposition/audit and zero Worker IDs");

  await competing.decide(secondAdmin,{
    ...input,expectedRevision:1,disposition:"continue",
    reason:"Independent signed documentary review confirms separate people despite coincident matching signals."
  });
  const issued=(await first.query(
    "SELECT permanent_worker_id,worker_account_id FROM worker_identity_worker_ids WHERE worker_account_id=$1",
    [target.worker.accountId]
  )).rows;
  assert.equal(issued.length,1);
  assert.equal(issued[0].worker_account_id,target.worker.accountId);
  assert.match(issued[0].permanent_worker_id,/^worker_id_[A-Za-z0-9_-]{24}$/);
  assert.equal((await first.query(
    "SELECT count(*)::int n FROM worker_identity_worker_ids WHERE worker_account_id=$1",
    [matching.worker.accountId]
  )).rows[0].n,0,"Matched separate account must not inherit the cleared Worker ID.");
  assert.deepEqual((await first.query(
    "SELECT disposition,disposition_sequence FROM worker_identity_duplicate_dispositions WHERE check_id=$1 ORDER BY disposition_sequence",
    [check.checkId]
  )).rows,[{disposition:"duplicate_review",disposition_sequence:1},{disposition:"continue",disposition_sequence:2}]);
  assert.equal((await first.query(
    "SELECT count(*)::int n FROM platform_audit_events WHERE metadata->>'duplicateReviewCheckId'=$1",
    [check.checkId]
  )).rows[0].n,2);
  console.log("M10707_REAL_POSTGRES_STALE_RETRY_ONLY_FRESH_REVISION",
    "independent second Admin after refresh from revision1 records one reasoned continue and issues only target unique Worker ID; matched second account still blocked");
 }finally{
  releaseFirst?.();
  await Promise.allSettled([pendingFirst,pendingSecond]);
  await second?.close();
  await first?.close();
  try{if(created)await supervisor.execute('DROP DATABASE "'+isolatedName+'"');}
  finally{await supervisor.close();}
 }
});
