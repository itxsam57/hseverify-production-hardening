import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { workerAssessmentSearchFixture } from "../helpers/worker-assessment-search-fixture.mjs";
import { seedPermanentWorkerId } from "../helpers/permanent-worker-id-fixture.mjs";
import { seedCredentialDecisionFixture } from "../helpers/credential-decision-fixture.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const PRIVATE_GROUNDS = "R31-PRIVATE-WORKER-APPEAL-GROUNDS-CANNOT-APPEAR-IN-BELL: verify the retained assessment";
const SIGNING = "r31-real-admin-notice-browser-fixture-signing-more-than-32";
function totp(secret) {
  let bits="",bytes=[];
  for(const char of secret.toUpperCase().replace(/=+$/g,"")){
    const value="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char);
    assert.ok(value>=0);bits+=value.toString(2).padStart(5,"0");
  }
  for(let i=0;i+8<=bits.length;i+=8)bytes.push(Number.parseInt(bits.slice(i,i+8),2));
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();
  const offset=digest.at(-1)&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
function port() {return new Promise((resolve,reject)=>{
  const server=createServer();server.once("error",reject);
  server.listen(0,"127.0.0.1",()=>{
    const address=server.address();
    server.close(error=>error?reject(error):resolve(address.port));
  });
});}
async function login(page,base,identity,role){
  await page.goto(base+"/"+role+"/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  if(identity.totpSecret)await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL("**/"+role+"/dashboard",{timeout:22000});
}

test("R31 real independent Admin bell opens exact submitted Worker appeal after cold server restart, rejects Worker Admin URL",{
  timeout:260000
},async()=>{
  const fixture=await workerAssessmentSearchFixture();
  const base="http://127.0.0.1:"+(await port());
  let browser,workerState,adminState,appealId,credentialId;
  try{
    const db=await openScriptDatabase({
      databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR
    });
    try{
      const issuer="account_r31_original_decision_issuer";
      const now=new Date().toISOString();
      await db.query(
        "INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,'r31-original-issuer@example.test','Original decision issuer','active','test-only',$2,$2,$2,$2)",
        [issuer,now]
      );
      await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)",[issuer,now]);
      const mappedWorkerId=await seedPermanentWorkerId(db,fixture.credentials.worker,"r");
      assert.ok(mappedWorkerId,"Original credential must bind to a real verified Worker identity for source event delivery");
      const actual=await seedCredentialDecisionFixture(db,{
        qualification:"R31 Admin Appeal Notification Safety",
        policy:{credentialValidity:"no_expiry"},
        workerAccountId:fixture.credentials.worker.accountId,
        permanentWorkerId:mappedWorkerId,signingSecret:SIGNING
      });
      await actual.repo.saveDecisionAndProgressCase(actual.decision,issuer);
      credentialId=(await db.query(
        "SELECT credential_reference FROM assurance_cases WHERE case_id=$1",[actual.caseId]
      )).rows[0].credential_reference;
      assert.ok(credentialId);
      assert.notEqual(issuer,fixture.credentials.admin.accountId);
    }finally{await db.close();}

    browser=await chromium.launch({headless:true});
    await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",new URL(base).port],
      probeUrl:base+"/worker/login",projectRoot:process.cwd(),
      environment:{...fixture.environment,HSE_CREDENTIAL_SIGNING_SECRET:SIGNING},
      probe:async({output})=>{
        const workerContext=await browser.newContext({viewport:{width:390,height:844}});
        const adminContext=await browser.newContext({viewport:{width:390,height:844}});
        const worker=await workerContext.newPage(),admin=await adminContext.newPage();
        try{
          await login(worker,base,fixture.credentials.worker,"worker");
          await worker.goto(base+"/worker/appeals",{waitUntil:"domcontentloaded"});
          await worker.getByRole("heading",{name:"Credential appeals",exact:true}).waitFor();
          await worker.getByLabel("Credential").selectOption(credentialId);
          await worker.getByLabel("Appeal grounds").fill(PRIVATE_GROUNDS);
          await worker.getByRole("button",{name:"Submit credential appeal"}).click();
          await worker.getByText("Appeal submitted for independent review.",{exact:true}).waitFor();
          await worker.getByText(/Status: submitted/i).first().waitFor();
          await login(admin,base,fixture.credentials.admin,"admin");
          await admin.goto(base+"/admin/appeals",{waitUntil:"domcontentloaded"});
          const item=admin.locator("article").filter({hasText:credentialId}).first();
          await item.getByText(/Status: submitted/i).waitFor();
          adminState=await adminContext.storageState();
          workerState=await workerContext.storageState();
          console.log("R31_ACTUAL_WORKER_BROWSER_SUBMITTED_AND_DIFFERENT_ADMIN_AUTHENTICATED");
        }catch(error){
          console.error("R31_ORIGINAL_BROWSER_DIAGNOSTIC",error.message,worker.url(),admin.url(),output().slice(-1100));
          throw error;
        }finally{await workerContext.close();await adminContext.close();}
      }
    });

    const projectionDb=await openScriptDatabase({
      databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR
    });
    try{
      const appeal=(await projectionDb.query(
        "SELECT appeal_id,status,reason FROM credential_appeals WHERE credential_id=$1",[credentialId]
      )).rows[0];
      assert.equal(appeal.status,"submitted");
      assert.equal(appeal.reason,PRIVATE_GROUNDS);
      appealId=appeal.appeal_id;
      const jobs=(await projectionDb.query(
        "SELECT job_id FROM platform_outbox_jobs WHERE job_type='notification.assurance.event' AND payload->>'eventType'='appeal.submitted' AND payload->>'eventRef'=$1",
        ["appeal:"+appealId+":1"]
      )).rows;
      if(jobs.length!==1){
        const all=(await projectionDb.query(
          "SELECT job_type,payload::text AS payload FROM platform_outbox_jobs WHERE job_type LIKE '%assurance%' ORDER BY job_sequence DESC LIMIT 20"
        )).rows;
        const events=(await projectionDb.query(
          "SELECT appeal_id,version,status FROM credential_appeal_events WHERE appeal_id=$1 ORDER BY version",[appealId]
        )).rows;
        console.log("R31_MISSING_NOTIFICATION_JOB_DIAGNOSTIC",JSON.stringify({appealId,jobs,all,events}));
      }
      assert.equal(jobs.length,1);
      const projected=(await projectionDb.query(
        "SELECT created,suppressed FROM platform_project_assurance_event_notification($1)",[jobs[0].job_id]
      )).rows[0];
      assert.equal(projected.suppressed,false);assert.ok(Number(projected.created)>=1);
      const notices=(await projectionDb.query(
        "SELECT recipient_account_id,recipient_role,notification_type,title,body,target_key,target_reference,read_at FROM platform_notifications WHERE source_job_id=$1",
        [jobs[0].job_id]
      )).rows;
      const admin=notices.find(n=>n.recipient_account_id===fixture.credentials.admin.accountId&&n.recipient_role==="admin");
      assert.ok(admin,"Actual signed-in independent Admin must be a recipient");
      assert.equal(admin.title,"Appeal submitted");
      assert.equal(admin.target_key,"appeal.record");
      assert.equal(admin.target_reference,appealId);
      assert.equal(admin.read_at,null);
      assert.ok(notices.some(n=>n.recipient_role==="worker"&&n.recipient_account_id===fixture.credentials.worker.accountId));
      assert.ok(notices.every(n=>n.recipient_role!=="company"));
      assert.ok(notices.every(n=>!n.body.includes(PRIVATE_GROUNDS)));
      console.log("R31_PERSISTED_ORIGINAL_APPEAL_SQL_PROJECTOR_ADMIN_AND_WORKER_NO_COMPANY_NO_PRIVATE_GROUNDS");
    }finally{await projectionDb.close();}

    assert.ok(adminState?.cookies?.length&&workerState?.cookies?.length);
    await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",new URL(base).port],
      probeUrl:base+"/admin/login",projectRoot:process.cwd(),
      environment:{...fixture.environment,HSE_CREDENTIAL_SIGNING_SECRET:SIGNING},
      probe:async({output})=>{
        const adminContext=await browser.newContext({viewport:{width:390,height:844},storageState:adminState});
        const workerContext=await browser.newContext({viewport:{width:320,height:844},storageState:workerState});
        const admin=await adminContext.newPage(),worker=await workerContext.newPage();
        try{
          await admin.goto(base+"/admin/dashboard",{waitUntil:"domcontentloaded"});
          const bell=admin.locator("details.notification-menu");
          const summary=bell.locator("summary");
          await summary.waitFor();
          assert.equal(await summary.getAttribute("aria-label"),"1 unread notifications");
          await summary.click();
          const notice=bell.getByRole("button",{name:/Unread: Appeal submitted/});
          await notice.waitFor();
          assert.ok(!(await notice.innerText()).includes(PRIVATE_GROUNDS));
          await notice.click();
          await admin.waitForURL(new RegExp("/admin/appeals#"+appealId+"$"),{timeout:20000});
          await admin.locator('[id="'+appealId+'"]').waitFor();
          await admin.locator('[id="'+appealId+'"]').getByText(/Status: submitted/i).waitFor();
          assert.equal(await admin.locator('details.notification-menu > summary').getAttribute("aria-label"),"0 unread notifications");
          await admin.reload({waitUntil:"domcontentloaded"});
          assert.equal(await admin.locator('details.notification-menu > summary').getAttribute("aria-label"),"0 unread notifications");
          const denied=await workerContext.request.get(base+"/admin/appeals",{maxRedirects:0});
          assert.notEqual(denied.status(),200,"Worker cannot inspect Admin appeal queue");
          assert.ok(!(await denied.text()).includes(PRIVATE_GROUNDS));
          const dims=await admin.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
          assert.ok(dims.scroll<=dims.width+2,"Admin appeal page overflow at 390px "+JSON.stringify(dims));
          console.log("R31_REAL_ADMIN_APPEAL_BELL_OPEN_EXACT_CASE_READ_PERSIST_COLD_RESTART_WORKER_ADMIN_DENIED");
        }catch(error){
          console.error("R31_BELL_DIAGNOSTIC",error.message,admin.url(),worker.url(),output().slice(-1100));
          throw error;
        }finally{await adminContext.close();await workerContext.close();}
      }
    });
    const finalDb=await openScriptDatabase({
      databaseDriver:"pglite",databaseUrl:null,pgliteDataDir:fixture.environment.HSE_PGLITE_DATA_DIR
    });
    try{
      const result=(await finalDb.query(
        "SELECT read_at FROM platform_notifications WHERE notification_type='appeal.submitted' AND recipient_role='admin' AND recipient_account_id=$1 AND target_reference=$2",
        [fixture.credentials.admin.accountId,appealId]
      )).rows[0];
      assert.ok(result.read_at);
      const unchanged=(await finalDb.query(
        "SELECT status,reason FROM credential_appeals WHERE appeal_id=$1",[appealId]
      )).rows[0];
      assert.deepEqual(unchanged,{status:"submitted",reason:PRIVATE_GROUNDS});
    }finally{await finalDb.close();}
  }finally{
    if(browser)await browser.close();
    await fixture.cleanup();
  }
});
