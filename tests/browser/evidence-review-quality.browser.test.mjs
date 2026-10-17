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

import {spawnSync} from "node:child_process";
import {writeFile} from "node:fs/promises";
import {reportCompanyFixture} from "../helpers/report-company-fixture.mjs";
import {reviewQualityFixture} from "../helpers/review-quality-fixture.mjs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";

test("Admin quality selection and capacity -> blind first review -> native notification -> independent final review",{timeout:300000},async()=>{
 const base=await reportCompanyFixture();let browser;
 try{
  await base.database.close();
  const db=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:base.environment.HSE_PGLITE_DATA_DIR});
  const f=await reviewQualityFixture({database:db});const x=await f.queue(),y=await f.queue("QUALITY-SECOND-SOURCE");
  const identities=[f.admin,...f.verifiers];const credentials=[];
  for(const [index,actor] of identities.entries()){
   const template=index===0?base.credentials.admin:base.credentials.verifier;
   await db.query("UPDATE auth_accounts SET password_hash=source.password_hash,password_set_at=source.password_set_at FROM auth_accounts source WHERE auth_accounts.account_id=$1 AND source.account_id=$2",[actor.accountId,template.accountId]);
   await db.query("INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,created_at,activated_at) SELECT $1,$2,'totp',encrypted_secret,'active',clock_timestamp(),clock_timestamp() FROM auth_mfa_factors WHERE account_id=$3 AND factor_status='active'",["quality-browser-factor-"+index,actor.accountId,template.accountId]);
   const email=(await db.query("SELECT email_normalized FROM auth_accounts WHERE account_id=$1",[actor.accountId])).rows[0].email_normalized;
   credentials.push({...template,accountId:actor.accountId,email});
  }
  await db.close();
  const port=await freePort(),baseUrl="http://127.0.0.1:"+port;
  browser=await chromium.launch({headless:true});const admin=await(await browser.newContext()).newPage(),first=await(await browser.newContext()).newPage(),second=await(await browser.newContext()).newPage();
  const errors=[];for(const page of [admin,first,second]){page.on("pageerror",e=>errors.push(e.message));page.on("response",r=>{if(r.status()>=500)errors.push(String(r.status())+" "+new URL(r.url()).pathname);});}
  const server=probe=>runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/admin/login",projectRoot:process.cwd(),environment:base.environment,probe:async context=>{try{await probe();}finally{await writeFile(".autopilot/artifacts/20261015-review-quality-browser-server.log",context.output());}}});
  await server(async()=>{
   await login(admin,baseUrl,credentials[0],"admin");await admin.goto(baseUrl+"/admin/operations/review-quality");
   const selection=admin.locator('article[id="'+x.taskId+'"]');await selection.getByLabel("Second-review selection reason").fill("Selected high-risk source requires a separate independent verification.");await selection.getByRole("button",{name:"Require independent second review",exact:true}).click();await selection.getByText("Independent second review required.",{exact:true}).waitFor();
   const capacity=admin.locator('article[id="'+f.verifiers[0].accountId+'"]');await capacity.getByLabel("Maximum open reviews").fill("1");await capacity.getByLabel("Workload change reason").fill("One open review is the current controlled staffing limit.");await capacity.getByRole("button",{name:"Save workload limit",exact:true}).click();await capacity.getByText("Reviewer workload limit saved.",{exact:true}).waitFor();
   await login(first,baseUrl,credentials[1],"verifier");await first.goto(baseUrl+"/verifier/reviews/"+x.taskId);await first.getByRole("button",{name:"Claim review",exact:true}).click();await first.getByText("ASSIGNED",{exact:true}).waitFor();
   const other=await first.context().newPage();await other.goto(baseUrl+"/verifier/reviews/"+y.taskId);await other.getByText(/Live review is blocked: reviewer capacity reached/).waitFor();assert.equal(await other.getByRole("button",{name:"Claim review",exact:true}).count(),0);await other.close();
   await first.locator('select[name="outcome"]').selectOption("APPROVED");await first.getByLabel("Reason",{exact:true}).fill("Private primary finding: the signed source meets the pinned competency.");await first.getByRole("button",{name:"Record first review",exact:true}).click();await first.getByText("QUEUED",{exact:true}).waitFor();assert.equal(await first.getByRole("button",{name:"Claim review",exact:true}).count(),0);
  });
  const build=spawnSync(process.execPath,["scripts/build-outbox-worker.mjs"],{env:base.environment,encoding:"utf8"});assert.equal(build.status,0,build.stderr||build.stdout);
  let projected=false;
  for(let i=0;i<30;i++){
   const proof=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:base.environment.HSE_PGLITE_DATA_DIR});try{projected=(await proof.query("SELECT status FROM platform_outbox_jobs WHERE job_type='notification.assurance.event' AND payload->>'eventType'='evidence.second_review.requested'")).rows.some(j=>j.status==='succeeded');}finally{await proof.close();}
   if(projected)break;
   const result=spawnSync(process.execPath,["scripts/run-outbox-worker.mjs","--once"],{env:base.environment,encoding:"utf8"});assert.ok([0,1].includes(result.status),result.stderr||result.stdout);
  }
  assert.equal(projected,true,"Native worker must project the exact quality handoff");
  await server(async()=>{
   await login(second,baseUrl,credentials[2],"verifier");await second.goto(baseUrl+"/verifier/notifications");const notice=second.locator(".notification-center-item").filter({hasText:"Independent evidence review required"});await notice.waitFor();assert.ok(!(await notice.innerText()).includes("Private primary"));await notice.getByRole("button",{name:"Open",exact:true}).click();await second.waitForURL("**/verifier/reviews/"+x.taskId);
   await second.getByRole("button",{name:"Claim review",exact:true}).click();await second.getByText("ASSIGNED",{exact:true}).waitFor();assert.ok(!(await second.locator("main").innerText()).includes("Private primary finding"));await second.locator('select[name="outcome"]').selectOption("APPROVED");await second.getByLabel("Reason",{exact:true}).fill("Separate independent finding confirms the signed competency evidence.");await second.getByRole("button",{name:"Finalize independent review",exact:true}).click();await second.getByText("APPROVED",{exact:true}).waitFor();
  });
  const proof=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:base.environment.HSE_PGLITE_DATA_DIR});try{assert.equal((await proof.query("SELECT COUNT(*)::integer n FROM evidence_review_quality_rounds WHERE task_id=$1",[x.taskId])).rows[0].n,2);assert.equal((await proof.query("SELECT COUNT(*)::integer n FROM evidence_review_decisions WHERE task_id=$1",[x.taskId])).rows[0].n,1);}finally{await proof.close();}
  assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await base.cleanup();}
});
