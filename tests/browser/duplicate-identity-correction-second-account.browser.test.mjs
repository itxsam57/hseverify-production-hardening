import assert from "node:assert/strict";
import {createServer} from "node:net";
import {createHmac} from "node:crypto";
import {writeFile} from "node:fs/promises";
import test from "node:test";
import {chromium} from "playwright";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
import {reportCompanyFixture} from "../helpers/report-company-fixture.mjs";
import {prepareSubmittedWorker,advanceThroughAutomatedChecks,markVerified} from "../helpers/duplicate-identity-fixture.mjs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";

function openFixtureDatabase(base) {
  return openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:base.environment.HSE_PGLITE_DATA_DIR});
}
async function freePort() {
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const address=server.address();
      server.close(error=>error?reject(error):typeof address==="string"||!address?reject(new Error("No test port")):resolve(address.port));
    });
  });
}
function totp(secret) {
 const chars="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",clean=secret.toUpperCase().replace(/=+$/g,"");
 let bits="";for(const char of clean)bits+=chars.indexOf(char).toString(2).padStart(5,"0");
 const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(Number.parseInt(bits.slice(i,i+8),2));
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();
 const offset=digest.at(-1)&15;
 return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
async function login(page,baseUrl,email,password) {
  await page.goto(baseUrl+"/worker/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL("**/worker/dashboard",{timeout:20000});
}
test("actual two authenticated Workers: correction preserves original ID; matching second account requires Admin duplicate review", {timeout:240000},async()=>{
  const base=await reportCompanyFixture();
  let browser,original,competing;
  const errors=[];
  try {
    await base.database.close();
    let db=await openFixtureDatabase(base);
    let previousId, originalIdentityVersionId;
    try {
      original=await prepareSubmittedWorker(db,"browser-corr-parent",{
        storage:base.storage,
        draft:{legalFirstName:"Samira",legalLastName:"Yusuf",dateOfBirth:"1985-12-06"},
        documentNumber:"CORR-PARENT-BROWSER-468"
      });
      await advanceThroughAutomatedChecks(original);
      await markVerified(db,original.submitted.identity.identityId);
      const clearance=await original.eligibilityService.evaluate(original.submitted.identity.identityId);
      assert.equal(clearance.checkStatus,"clear");
      previousId=(await original.eligibilityService.issuePermanentWorkerId(original.submitted.identity.identityId)).permanentWorkerId;
      originalIdentityVersionId=original.submitted.currentVersion.identityVersionId;
      await db.query("UPDATE auth_accounts SET password_hash=source.password_hash,password_set_at=source.password_set_at,worker_reference='HSE-REG-CORRECTION-PARENT' FROM auth_accounts source WHERE auth_accounts.account_id=$1 AND source.account_id=$2",
        [original.worker.accountId,base.credentials.worker.accountId]);
    }finally{await db.close();}
    const port=await freePort(),baseUrl="http://127.0.0.1:"+port;
    browser=await chromium.launch({headless:true});
    const parent=await(await browser.newContext()).newPage();
    const child=await(await browser.newContext()).newPage();
    const admin=await(await browser.newContext()).newPage();
    for(const page of [parent,child,admin]){
      page.on("pageerror",error=>errors.push(error.message));
      page.on("response",response=>{if(response.status()>=500)errors.push(response.status()+" "+new URL(response.url()).pathname);});
    }
    // Phase 1: the FIRST Worker uses the production correction form in a real browser.
    await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",String(port)],
      probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment:base.environment,
      probe:async({output})=>{
        try{
          await login(parent,baseUrl,original.worker.email,base.credentials.worker.password);
          await parent.goto(baseUrl+"/worker/identity");
          await parent.getByRole("heading",{name:"Request a verified identity correction"}).waitFor();
          await parent.getByText(previousId,{exact:true}).waitFor();
          await parent.getByLabel("Reason for correction").fill("The verified document has been replaced and the original identity must remain protected during correction.");
          await parent.getByRole("button",{name:"Start correction version",exact:true}).click();
          await parent.getByText("Latest correction: draft",{exact:true}).waitFor();
          await parent.getByText(previousId,{exact:true}).waitFor();
          assert.equal(await parent.getByRole("button",{name:"Start correction version",exact:true}).count(),0);
        }finally{await writeFile(".autopilot/artifacts/20261031-A28-correction-two-worker-phase1-server.log",output());}
      }
    });
    // Stop app before manipulating isolated PGlite fixture; browser cookies survive server restart.
    db=await openFixtureDatabase(base);
    let checkId, correctionVersionId;
    try{
      const status=(await db.query("SELECT lifecycle_status,current_version_number FROM worker_identities WHERE identity_id=$1",[original.submitted.identity.identityId])).rows[0];
      assert.equal(status.lifecycle_status,"correction_pending");
      const current=(await db.query("SELECT identity_version_id,parent_version_id FROM worker_identity_versions WHERE identity_id=$1 AND version_number=$2",[original.submitted.identity.identityId,status.current_version_number])).rows[0];
      correctionVersionId=current.identity_version_id;
      assert.equal(current.parent_version_id,originalIdentityVersionId);
      competing=await prepareSubmittedWorker(db,"browser-corr-other",{
        storage:base.storage,
        draft:{legalFirstName:"Samira",legalLastName:"Yusuf",dateOfBirth:"1985-12-06"},
        documentNumber:"CORRPARENTBROWSER468"
      });
      await advanceThroughAutomatedChecks(competing);
      await markVerified(db,competing.submitted.identity.identityId);
      const duplicate=await competing.eligibilityService.evaluate(competing.submitted.identity.identityId);
      checkId=duplicate.checkId;
      assert.equal(duplicate.checkStatus,"review_required","A new account must match the already verified correction parent.");
      // Browser buttons are not a security boundary. Check the actual service
      // independently of a catalogue selection, so direct action forgery also fails.
      const {WorkerAssessmentApplicationService}=loadWorkerRegistrationTs(
        "src/lib/assessment-catalogue/worker-assessment-application-service.ts"
      );
      const applicationService=new WorkerAssessmentApplicationService(db);
      assert.deepEqual(await applicationService.listOfferings(competing.worker),[]);
      await assert.rejects(
        applicationService.applyWorkerPay(competing.worker,"catalogue_version_"+"A".repeat(24)),
        error=>error?.name==="WorkerAssessmentApplicationConflictError" &&
          /verified identity and permanent Worker ID/.test(error.message),
        "A different account with unresolved duplicates must be denied by the actual assessment service, regardless of forged offering ID."
      );
      const matched=(await db.query("SELECT candidate_identity_version_id FROM worker_identity_duplicate_signals WHERE check_id=$1",[checkId])).rows;
      assert.ok(matched.length>0);
      assert.ok(matched.every(row=>row.candidate_identity_version_id===originalIdentityVersionId));
      assert.equal(matched.some(row=>row.candidate_identity_version_id===correctionVersionId),false);
      await db.query("UPDATE auth_accounts SET password_hash=source.password_hash,password_set_at=source.password_set_at,worker_reference='HSE-REG-CORRECTION-SECOND' FROM auth_accounts source WHERE auth_accounts.account_id=$1 AND source.account_id=$2",
        [competing.worker.accountId,base.credentials.worker.accountId]);
    }finally{await db.close();}
    // Phase 2: two genuinely independent signed-in Workers + authenticated Admin.
    await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",String(port)],
      probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment:base.environment,
      probe:async({output})=>{
        try{
          await login(child,baseUrl,competing.worker.email,base.credentials.worker.password);
          await child.goto(baseUrl+"/worker/identity");
          await child.getByText("Duplicate/recovery eligibility requires authorized review.",{exact:true}).waitFor();
          await child.getByText("Not issued",{exact:true}).waitFor();
          assert.equal((await child.content()).includes(previousId),false,"Second Worker must not see original permanent Worker ID.");
          assert.equal((await child.content()).includes(originalIdentityVersionId),false,"Second Worker must not see the original private identity version.");
          await child.goto(baseUrl+"/worker/assessment-applications");
          await child.getByRole("heading",{name:"Apply and fund an assessment"}).waitFor();
          assert.equal(await child.getByRole("button",{name:"Apply — worker pays",exact:true}).count(),0,"Second Worker must not have an available payable application without an ID.");
          await parent.goto(baseUrl+"/worker/identity");
          await parent.getByText("Latest correction: draft",{exact:true}).waitFor();
          await parent.getByText(previousId,{exact:true}).waitFor();
          await admin.goto(baseUrl+"/admin/login");
          await admin.getByLabel("Email address").fill(base.credentials.admin.email);
          await admin.getByLabel("Password").fill(base.credentials.admin.password);
          await admin.getByLabel("Authenticator code").fill(totp(base.credentials.admin.totpSecret));
          await admin.getByRole("button",{name:"Sign in",exact:true}).click();
          await admin.waitForURL("**/admin/dashboard",{timeout:20000});
          await admin.goto(baseUrl+"/admin/operations/duplicate-identities");
          const article=admin.locator('article[id="'+competing.submitted.identity.identityId+'"]');
          await article.getByText(original.submitted.identity.identityId,{exact:true}).first().waitFor();
          await article.getByRole("region",{name:"Retained identity comparison"}).getByText("Date of birth: 1985-12-06",{exact:false}).first().waitFor();
          const preview=await article.getByRole("link",{name:"Preview matching identity document"}).getAttribute("href");
          assert.ok(preview,"Admin must retain private comparison of immutable verified parent despite ongoing correction.");
          const allowed=await admin.context().request.get(baseUrl+preview);
          assert.equal(allowed.status(),200);
          assert.match(allowed.headers()["content-type"],/application\/pdf/);
          const denied=await child.context().request.get(baseUrl+preview);
          const deniedContentType=denied.headers()["content-type"]??"";
          const deniedBytes=await denied.body();
          console.log("FOREIGN_DOC_DIAGNOSTIC",JSON.stringify({status:denied.status(),url:denied.url(),contentType:deniedContentType,bytes:deniedBytes.byteLength,hasPdfHeader:deniedBytes.subarray(0,5).toString()==="%PDF-"}));
          assert.ok(denied.status()!==200 || !deniedContentType.includes("application/pdf") || deniedBytes.subarray(0,5).toString()!=="%PDF-",
            "Second Worker must never obtain actual PDF bytes of first Worker's private verified document.");
          const form=article.getByRole("form",{name:"Resolve duplicate identity"});
          await form.getByLabel("Identity eligibility outcome").selectOption("duplicate_review");
          await form.getByLabel("Duplicate review reason").fill("Prior verified parent remains authoritative until independently validated correction is accepted.");
          await form.getByRole("button",{name:"Record duplicate identity outcome",exact:true}).click();
          await article.getByText("Duplicate identity outcome recorded.",{exact:true}).waitFor();
          await child.goto(baseUrl+"/worker/identity");
          await child.getByText("Further independent duplicate review is required. Your submitted identity remains retained.",{exact:true}).waitFor();
          await child.getByText("Not issued",{exact:true}).waitFor();
        }finally{await writeFile(".autopilot/artifacts/20261031-A28-correction-two-worker-phase2-server.log",output());}
      }
    });
    db=await openFixtureDatabase(base);
    try{
      const ids=(await db.query("SELECT identity_id,worker_account_id FROM worker_identity_worker_ids WHERE worker_account_id=ANY($1::text[])",[[original.worker.accountId,competing.worker.accountId]])).rows;
      assert.deepEqual(ids,[{identity_id:original.submitted.identity.identityId,worker_account_id:original.worker.accountId}]);
      const prior=(await db.query("SELECT identity_version_id,version_status FROM worker_identity_versions WHERE identity_version_id=$1",[originalIdentityVersionId])).rows[0];
      assert.equal(prior.version_status,"submitted");
      assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM worker_identity_correction_requests WHERE worker_account_id=$1",[original.worker.accountId])).rows[0].n,1);
      assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM worker_assessment_applications WHERE worker_account_id=$1",[competing.worker.accountId])).rows[0].n,0);
      assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM assessment_attempts WHERE worker_account_id=$1",[competing.worker.accountId])).rows[0].n,0);
      assert.equal((await db.query("SELECT disposition FROM worker_identity_duplicate_dispositions WHERE check_id=$1 ORDER BY disposition_sequence DESC LIMIT 1",[checkId])).rows[0].disposition,"duplicate_review");
    }finally{await db.close();}
    assert.deepEqual(errors,[]);
    console.log("TWO_ACCOUNT_CORRECTION_CHROMIUM first Worker real correction form then separate matching second Worker login, negative assessment path, Admin verified-parent private review and reasoned disposition, no second ID, original Worker ID preserved");
  }finally{await browser?.close();await base.cleanup();}
});
