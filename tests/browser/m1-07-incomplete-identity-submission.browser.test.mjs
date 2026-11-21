import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
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

const TOTP_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function staffTotp(secret) {
  const clean = secret.toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (const letter of clean) {
    const n = TOTP_ALPHABET.indexOf(letter);
    assert.ok(n >= 0, "Synthetic staff TOTP secret is invalid.");
    bits += n.toString(2).padStart(5, "0");
  }
  const decoded = Buffer.from(Array.from({length:Math.floor(bits.length/8)},
    (_,index)=>Number.parseInt(bits.slice(index*8,index*8+8),2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30_000)));
  const digest = createHmac("sha1",decoded).update(counter).digest();
  const offset = digest.at(-1)&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1_000_000).padStart(6,"0");
}

async function staffLogin(page,base,credential,role){
  await page.goto(base+"/"+role+"/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(credential.email);
  await page.getByLabel("Password").fill(credential.password);
  if(credential.totpSecret)await page.getByLabel("Authenticator code").fill(staffTotp(credential.totpSecret));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL("**/"+role+"/dashboard",{timeout:25000});
}

test("M1.07.01 incomplete Worker identity remains editable and cannot enter verification", {timeout:220000}, async()=>{
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
          // The existing M1.07.01 proof covered the identity draft. The
          // profile's independent incomplete-submit guard is checked through
          // its actual signed Worker UI, without repeating M1.07.02 save cases.
          await page.goto(base+"/worker/profile",{waitUntil:"domcontentloaded"});
          await page.getByRole("heading",{name:"My profile",exact:true}).waitFor();
          await page.getByText("Profile not ready",{exact:true}).waitFor();
          assert.equal(await page.getByRole("button",{name:"Submit profile",exact:true}).isDisabled(),true,
            "Incomplete Worker profile must not submit.");
          console.log("ACTUAL_M10701_PROFILE_INCOMPLETE_BROWSER", "real signed Worker cannot submit incomplete profile");
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

          // Previously green Worker-only draft tests did not prove that no
          // actual Verifier/Admin recipient is given a review action.
          // Each staff user signs in with its own isolated browser context.
          const verifier=await browser.newPage({viewport:{width:320,height:740}});
          const admin=await browser.newPage({viewport:{width:1280,height:850}});
          for(const staff of [verifier,admin]){
            staff.on("pageerror",error=>fatal.push(error.message));
            staff.on("response",response=>{
              if(response.status()>=500)fatal.push("HTTP "+response.status()+" "+new URL(response.url()).pathname);
            });
          }
          await staffLogin(verifier,base,fixture.credentials.verifier,"verifier");
          await verifier.goto(base+"/verifier/reviews?q="+encodeURIComponent(fixture.credentials.worker.accountId),
            {waitUntil:"domcontentloaded"});
          await verifier.getByRole("heading",{name:"Evidence review queue",exact:true}).waitFor();
          await verifier.getByText("No review tasks match your search.",{exact:true}).waitFor();
          assert.equal(await verifier.locator("tbody tr").count(),0);
          assert.equal(await verifier.locator('tbody a[href^="/verifier/reviews/"]').count(),0,
            "The incomplete identity must not have a Verifier review deep link.");
          await verifier.goto(base+"/verifier/notifications",{waitUntil:"domcontentloaded"});
          await verifier.getByRole("heading",{name:"Notifications",exact:true}).first().waitFor();
          assert.equal(await verifier.getByText(fixture.credentials.worker.accountId,{exact:false}).count(),0);
          console.log("ACTUAL_M10701_VERIFIER_EMPTY_QUEUE",
            "separately signed 320px Verifier shows no incomplete-identity review/deep link or premature notification");

          await staffLogin(admin,base,fixture.credentials.admin,"admin");
          await admin.goto(base+"/admin/review-frameworks",{waitUntil:"domcontentloaded"});
          await admin.getByRole("heading",{name:"Review framework applicability",exact:true}).waitFor();
          await admin.getByText("No live review tasks.",{exact:true}).waitFor();
          await admin.goto(base+"/admin/operations/duplicate-identities",{waitUntil:"domcontentloaded"});
          await admin.getByRole("heading",{name:"Duplicate identity review",exact:true}).waitFor();
          await admin.getByText("No verified identities awaiting duplicate review.",{exact:true}).waitFor();
          await admin.goto(base+"/admin/notifications",{waitUntil:"domcontentloaded"});
          await admin.getByRole("heading",{name:"Notifications",exact:true}).first().waitFor();
          assert.equal(await admin.getByText(fixture.credentials.worker.accountId,{exact:false}).count(),0);
          console.log("ACTUAL_M10701_ADMIN_EMPTY_FRAMEWORK",
            "signed Admin sees no premature review binding, duplicate review, or incomplete-identity notification");

          // Leaving the Worker page while independent staff sessions inspect
          // receiving state must not invalidate or erase the original draft.
          await page.reload({waitUntil:"domcontentloaded"});
          assert.equal(await page.getByLabel("Legal first name").inputValue(),"Partial");
          assert.equal(await page.getByLabel("Legal last name").inputValue(),"Draft");
          assert.equal(await page.getByLabel("Date of birth").inputValue(),"");
          console.log("ACTUAL_M10701_WORKER_DRAFT_CROSS_ROLE_PERSISTED",
            "same Worker typed identity remains exactly retained after independent Verifier/Admin reads");
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
      assert.equal((await db.query(
        "SELECT count(*)::int AS count FROM platform_notifications WHERE target_reference=$1",
        [identity[0].identity_id]
      )).rows[0].count,0,
      "Incomplete identity cannot project a notification targeted to its unsubmitted identity.");
      assert.equal((await db.query(
        "SELECT count(*)::int AS count FROM platform_outbox_jobs WHERE job_type='notification.assurance.event' AND payload::text LIKE '%' || $1 || '%'",
        [identity[0].identity_id]
      )).rows[0].count,0,
      "Rejected identity submissions cannot enqueue assurance notifications for this identity.");
      assert.equal((await db.query(
        "SELECT count(*)::int AS count FROM platform_audit_events WHERE target_reference=$1 AND action_key IN ('identity.submitted','evidence.submitted')",
        [identity[0].identity_id]
      )).rows[0].count,0,
      "Incomplete identity cannot have a successful identity submission audit.");
      console.log("ACTUAL_M10701_DB version remains draft with original incomplete details; no review task or permanent Worker ID issued");
      console.log("ACTUAL_M10701_CROSS_ROLE_NO_FALSE_NOTIFICATION_AUDIT_DB",
        "no identity-targeted notification, assurance outbox, or false successful submission audit");
    }finally{await db.close();}
  }finally{await fixture.cleanup();}
});
