import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { assessmentFundingFixture } from "../helpers/assessment-funding-fixture.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

function freePort() {
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const value=server.address().port;
      server.close(error=>error?reject(error):resolve(value));
    });
  });
}

async function runWorkerBrowser(fixture,baseUrl,work) {
  const result=await runDevelopmentServer({
    args:["--hostname","127.0.0.1","--port",new URL(baseUrl).port],
    probeUrl:baseUrl+"/worker/login",
    projectRoot:process.cwd(),
    environment:fixture.environment,
    probe:async({initialResponse,output})=>{
      assert.equal(initialResponse.status,200);
      const browser=await chromium.launch({headless:true});
      try{
        const worker=await browser.newPage({viewport:{width:390,height:844}});
        const errors=[];
        worker.on("pageerror",error=>errors.push(error.message));
        worker.on("response",response=>{
          if(response.status()>=500) errors.push("HTTP "+response.status()+" "+new URL(response.url()).pathname);
        });
        await worker.goto(baseUrl+"/worker/login",{waitUntil:"domcontentloaded"});
        await worker.getByLabel("Email address").fill(fixture.credentials.worker.email);
        await worker.getByLabel("Password").fill(fixture.credentials.worker.password);
        await worker.getByRole("button",{name:"Sign in",exact:true}).click();
        await worker.waitForURL("**/worker/dashboard");
        await work(worker,baseUrl);
        assert.deepEqual(errors,[],output());
      } finally {await browser.close();}
    }
  });
  assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
}

async function selfFundWorker(worker,baseUrl){
  await worker.goto(baseUrl+"/worker/assessment-applications",{waitUntil:"domcontentloaded"});
  const offering=worker.locator("article.panel").filter({
    has:worker.getByRole("heading",{name:"Funded safety assessment",exact:true})
  }).first();
  await offering.getByRole("button",{name:"Apply — worker pays",exact:true}).waitFor();
  await offering.getByRole("button",{name:"Apply — worker pays",exact:true}).click();
  await worker.waitForURL(url=>url.searchParams.get("status")==="payment-required"||url.searchParams.has("error"));
  assert.equal(new URL(worker.url()).searchParams.has("error"),false,"Worker must remain eligible to reapply: "+worker.url());
  await worker.getByRole("button",{name:"Confirm sandbox payment",exact:true}).click();
  await worker.waitForURL(url=>url.searchParams.get("status")==="case-created"||url.searchParams.has("error"));
  assert.equal(new URL(worker.url()).searchParams.has("error"),false,"Payment must create independent case: "+worker.url());
  await worker.getByText("Funding confirmed. The assessment case is ready.",{exact:true}).waitFor();
}

test("M2.06 terminal Worker case permits new application while retaining complete original history", {timeout:180000},async()=>{
  const fixture=await assessmentFundingFixture();
  const baseUrl="http://127.0.0.1:"+(await freePort());
  let originalCaseId,originalApplicationId,secondCaseId;
  try {
    // Phase 1: complete the first self-funding journey through real Worker UI.
    await runWorkerBrowser(fixture,baseUrl,async worker=>{
      await selfFundWorker(worker,baseUrl);
      console.log("ACTUAL_M206_FIRST_WORKER_APPLICATION_BROWSER sandbox self-funded original assessment case");
    });
    // Stop the app before externally advancing the case fixture: two open
    // PGlite processes against the same directory do not share live writes.
    // A clean restart is required to test persisted terminal-case behavior.
    const terminalDb=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try {
      const applications=(await terminalDb.query(
        "SELECT application_id,assurance_case_id,application_status FROM worker_assessment_applications WHERE worker_account_id=$1 AND catalogue_version_id=$2",
        [fixture.worker.accountId,fixture.fundingInput.catalogueVersionId]
      )).rows;
      assert.equal(applications.length,1);
      assert.equal(applications[0].application_status,"CASE_CREATED");
      originalCaseId=applications[0].assurance_case_id;
      originalApplicationId=applications[0].application_id;
      assert.match(originalCaseId,/^assurance_case_/);
      const updated=await terminalDb.query(
        "UPDATE assurance_cases SET case_status='Closed',owner_kind=NULL,next_action=NULL,closed_at=now(),updated_at=now() WHERE case_id=$1 AND worker_account_id=$2",
        [originalCaseId,fixture.worker.accountId]
      );
      assert.equal(updated.affectedRows,1);
      console.log("TEST_SETUP_M206_TERMINAL_CASE original assessment marked Closed in persisted DB between app runs; independent Verifier terminal action not tested");
    } finally {await terminalDb.close();}
    // Phase 2: fresh web-server process reloads the actual terminal case from
    // disk; Worker has to reapply via its real role-specific portal actions.
    await runWorkerBrowser(fixture,baseUrl,async worker=>{
      await selfFundWorker(worker,baseUrl);
      console.log("ACTUAL_M206_REAPPLICATION_BROWSER fresh Worker application and sandbox-funded case after terminal original, via actual portal");
    });
    const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try{
      const apps=(await db.query(
        "SELECT application_id,application_status,assurance_case_id,completed_at FROM worker_assessment_applications WHERE worker_account_id=$1 AND catalogue_version_id=$2 ORDER BY created_at,application_id",
        [fixture.worker.accountId,fixture.fundingInput.catalogueVersionId]
      )).rows;
      assert.equal(apps.length,2);
      const previous=apps.find(app=>app.application_id===originalApplicationId);
      assert.ok(previous);
      assert.equal(previous.application_status,"COMPLETED");
      assert.equal(previous.assurance_case_id,originalCaseId);
      assert.ok(previous.completed_at);
      const newer=apps.find(app=>app.application_id!==originalApplicationId);
      assert.ok(newer);
      assert.equal(newer.application_status,"CASE_CREATED");
      secondCaseId=newer.assurance_case_id;
      assert.notEqual(secondCaseId,originalCaseId);
      const cases=(await db.query(
        "SELECT case_id,case_status FROM assurance_cases WHERE worker_account_id=$1 AND case_id=ANY($2::text[])",
        [fixture.worker.accountId,[originalCaseId,secondCaseId]]
      )).rows;
      assert.equal(cases.length,2);
      assert.equal(cases.find(row=>row.case_id===originalCaseId).case_status,"Closed");
      assert.equal(cases.find(row=>row.case_id===secondCaseId).case_status,"Assessment pending");
      const events=(await db.query(
        "SELECT application_id,from_status,to_status FROM worker_assessment_application_events WHERE application_id=ANY($1::text[]) ORDER BY occurred_at,event_id",
        [[originalApplicationId,newer.application_id]]
      )).rows;
      assert.equal(events.filter(event=>event.application_id===originalApplicationId&&event.to_status==="COMPLETED").length,1);
      assert.equal(events.filter(event=>event.application_id===newer.application_id&&event.to_status==="CASE_CREATED").length,1);
      assert.equal((await db.query(
        "SELECT COUNT(*)::int AS n FROM assurance_case_policy_snapshots WHERE case_id=ANY($1::text[])",
        [[originalCaseId,secondCaseId]]
      )).rows[0].n,2);
      console.log("ACTUAL_M206_REAPPLY_DB original terminal case and application/audit preserved, distinct new funded case and policy pin");
    } finally {await db.close();}
  } finally {await fixture.cleanup();}
});
