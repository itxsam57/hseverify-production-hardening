import assert from "node:assert/strict";
import test from "node:test";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {applyMigrationsThrough} from "../helpers/migration-ceiling.mjs";
import {prepareSubmittedWorker,advanceThroughAutomatedChecks,markVerified} from "../helpers/duplicate-identity-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";

const {DatabaseWorkerIdentityRepository}=loadWorkerRegistrationTs("src/lib/identity/worker-identity-repository.ts");
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
