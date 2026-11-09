import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value) {
  const clean = value.toUpperCase().replace(/=+$/g, "");
  let bits = "";
  for (const char of clean) bits += B32.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const counter = Math.floor(Date.now() / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (!address || typeof address === "string") reject(new Error("No free port."));
        else resolve(address.port);
      });
    });
  });
}

async function login(page, baseUrl, credential, role) {
  await page.goto(`${baseUrl}/${role}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(credential.email);
  await page.getByLabel("Password").fill(credential.password);
  if (credential.totpSecret) {
    await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`**/${role}/dashboard`, { timeout: 20_000 });
}


import {integrityAssessmentFixture} from "../helpers/integrity-assessment-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
const {AssessmentIntegrityService}=loadWorkerRegistrationTs("src/lib/integrity/assessment-integrity-service.ts");
const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const {processNextOutboxJob}=loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");

test("Submitted assessment staffing outage -> Admin assignment -> Verifier review and notification; stale form retains input",{timeout:180000},async()=>{
 const f=await integrityAssessmentFixture();
 try{
  const reviewer=f.credentials.verifier.accountId;
  await f.database.query("DELETE FROM auth_account_roles WHERE account_id=$1 AND role='verifier'",[reviewer]);
  await new AssessmentIntegrityService(Promise.resolve(f.database)).record(f.worker,f.attemptId,null,{type:"COPY_PASTE_DETECTED"});
  await f.attempts.submitCurrentAnswer(f.worker,{attemptId:f.attemptId,position:1,answer:"Stop and assess"},new Date(),null);
  await f.database.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'verifier')",[reviewer]);
  await f.releaseDatabase();
  const port=await freePort(),baseUrl="http://127.0.0.1:"+port;
  const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/admin/login",projectRoot:process.cwd(),environment:f.environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});try{
    const adminContext=await browser.newContext(),admin=await adminContext.newPage();
    await login(admin,baseUrl,f.credentials.admin,"admin");
    await admin.goto(baseUrl+"/admin/operations");await admin.getByRole("link",{name:"Assessment review assignments",exact:true}).click();await admin.waitForURL("**/admin/operations/scoring-assignments");
    const stale=await adminContext.newPage();await stale.goto(admin.url());
    const article=page=>page.locator("article").filter({hasText:f.sourceCase.case_id});
    for(const page of [admin,stale]){await article(page).getByLabel("Calibrated independent Verifier").selectOption(reviewer);await article(page).getByLabel("Assignment reason").fill("Restore the retained assessment to its independently calibrated reviewer.");}
    await article(admin).getByRole("button",{name:"Assign assessment review",exact:true}).click();await admin.getByText("Assessment review assigned.",{exact:true}).waitFor();
    await article(stale).getByRole("button",{name:"Assign assessment review",exact:true}).click();await stale.getByRole("alert").filter({hasText:"Review changed"}).waitFor();
    assert.equal(await article(stale).getByLabel("Assignment reason").inputValue(),"Restore the retained assessment to its independently calibrated reviewer.");
    const verifier=await(await browser.newContext()).newPage();await login(verifier,baseUrl,f.credentials.verifier,"verifier");await verifier.goto(baseUrl+"/verifier/reviews/scoring");
    await verifier.getByText(f.sourceCase.case_id,{exact:false}).waitFor();await verifier.getByText("private-question-prompt-marker",{exact:true}).waitFor();await verifier.getByText("Stop and assess",{exact:true}).first().waitFor();
   }finally{await browser.close();}
  }});assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
  const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:f.environment.HSE_PGLITE_DATA_DIR});try{
   const repository=new DatabaseOutboxRepository(Promise.resolve(db));
   for(let i=0;i<30;i++){
    const notices=(await db.query("SELECT notification_id,target_key FROM platform_notifications WHERE notification_type='assessment.review.assigned' AND recipient_account_id=$1",[reviewer])).rows;
    if(notices.length){assert.equal(notices[0].target_key,"verifier.integrity.review");break;}
    const job=await processNextOutboxJob({repository,database:db});assert.ok(job,"Committed assignment must reach the real notification worker");
   }
   assert.equal((await db.query("SELECT COUNT(*)::integer n FROM platform_notifications WHERE notification_type='assessment.review.assigned' AND recipient_account_id=$1",[reviewer])).rows[0].n,1);
   assert.equal((await db.query("SELECT COUNT(*)::integer n FROM written_score_reviews WHERE attempt_id=$1 AND reviewer_account_id=$2",[f.attemptId,reviewer])).rows[0].n,1);
  }finally{await db.close();}
 }finally{await f.cleanup();}
});
