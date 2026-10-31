import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { workerAssessmentSearchFixture } from "../helpers/worker-assessment-search-fixture.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

async function freePort() {
  return new Promise((resolve,reject)=>{
    const socket=createServer();
    socket.once("error",reject);
    socket.listen(0,"127.0.0.1",()=>{
      const port=socket.address().port;
      socket.close(error=>error?reject(error):resolve(port));
    });
  });
}

test("M1.07.01 incomplete Worker identity remains editable and cannot enter verification", {timeout:170000}, async()=>{
  const fixture=await workerAssessmentSearchFixture();
  const base="http://127.0.0.1:"+(await freePort());
  try {
    const run=await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",new URL(base).port],
      probeUrl:base+"/worker/login",
      environment:fixture.environment,
      projectRoot:process.cwd(),
      probe:async({output})=>{
        const browser=await chromium.launch({headless:true});
        try{
          const page=await browser.newPage({viewport:{width:390,height:844}});
          const fatal=[];
          page.on("pageerror",error=>fatal.push(error.message));
          page.on("response",response=>{
            if(response.status()>=500)fatal.push("HTTP "+response.status()+" "+new URL(response.url()).pathname);
          });
          await page.goto(base+"/worker/login",{waitUntil:"domcontentloaded"});
          await page.getByLabel("Email address").fill(fixture.credentials.worker.email);
          await page.getByLabel("Password").fill(fixture.credentials.worker.password);
          await page.getByRole("button",{name:"Sign in",exact:true}).click();
          await page.waitForURL("**/worker/dashboard");
          await page.goto(base+"/worker/identity",{waitUntil:"domcontentloaded"});
          await page.getByRole("heading",{name:"Identity",exact:true}).waitFor();
          await page.getByRole("button",{name:"Submit identity",exact:true}).click();
          await page.waitForFunction(() => [...document.querySelectorAll('[role="alert"]')].some(node => (node.textContent ?? "").trim().length>0),{timeout:15000});
          const initialError=(await page.getByRole("alert").first().innerText()).trim();
          assert.match(initialError,/identity|details|evidence|complete|required|unavailable|safely/i);
          console.log("ACTUAL_M10701_EMPTY_BROWSER incomplete identity submission refused:",initialError.slice(0,170));
          const details=page.locator("section").filter({has:page.getByRole("heading",{name:"Identity details",exact:true})}).first();
          await details.getByLabel("Legal first name").fill("Partial");
          await details.getByLabel("Legal last name").fill("Draft");
          await details.getByRole("button",{name:"Save identity details",exact:true}).click();
          await details.getByText("Identity details saved.",{exact:true}).waitFor({timeout:20000});
          await page.reload({waitUntil:"domcontentloaded"});
          assert.equal(await page.getByLabel("Legal first name").inputValue(),"Partial");
          assert.equal(await page.getByLabel("Legal last name").inputValue(),"Draft");
          assert.equal(await page.getByLabel("Date of birth").inputValue(),"");
          await page.getByRole("button",{name:"Submit identity",exact:true}).click();
          await page.waitForFunction(() => [...document.querySelectorAll('[role="alert"]')].some(node => (node.textContent ?? "").trim().length>0),{timeout:20000});
          const partialError=(await page.getByRole("alert").first().innerText()).trim();
          assert.match(partialError,/identity|details|evidence|complete|required|unavailable|safely/i);
          await page.reload({waitUntil:"domcontentloaded"});
          assert.equal(await page.getByRole("heading",{name:"Draft",exact:true}).count(),1);
          assert.equal(await page.getByLabel("Legal first name").inputValue(),"Partial");
          console.log("ACTUAL_M10701_DRAFT_BROWSER accepted partial draft and retained exact fields after rejected submit and cold reload at 390px");
          assert.deepEqual(fatal,[],output());
        }finally{await browser.close();}
      }
    });
    assert.equal(run.requestedSignal,"SMOKE_COMPLETE");
    const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try{
      const worker=fixture.credentials.worker.accountId;
      const identity=(await db.query(
        "SELECT identity_id,lifecycle_status,current_version_number FROM worker_identities WHERE worker_account_id=$1",[worker]
      )).rows;
      assert.equal(identity.length,1);
      assert.equal(identity[0].lifecycle_status,"draft");
      const versions=(await db.query(
        "SELECT identity_version_id,version_status,submitted_at FROM worker_identity_versions WHERE identity_id=$1",[identity[0].identity_id]
      )).rows;
      assert.equal(versions.length,1);
      assert.equal(versions[0].version_status,"draft");
      assert.equal(versions[0].submitted_at,null);
      const draft=(await db.query(
        "SELECT legal_first_name,legal_last_name,date_of_birth,nationality FROM worker_identity_version_drafts WHERE identity_version_id=$1",[versions[0].identity_version_id]
      )).rows[0];
      assert.equal(draft.legal_first_name,"Partial");
      assert.equal(draft.legal_last_name,"Draft");
      assert.equal(draft.date_of_birth,null);
      assert.equal(draft.nationality,null);
      assert.equal((await db.query(
        "SELECT count(*)::int AS count FROM evidence_review_tasks WHERE worker_account_id=$1 AND evidence_kind='identity'",[worker]
      )).rows[0].count,0);
      assert.equal((await db.query(
        "SELECT count(*)::int AS count FROM worker_identity_worker_ids WHERE worker_account_id=$1",[worker]
      )).rows[0].count,0);
      console.log("ACTUAL_M10701_DB version remains draft with original incomplete details; no review task or permanent Worker ID issued");
    }finally{await db.close();}
  }finally{await fixture.cleanup();}
});
