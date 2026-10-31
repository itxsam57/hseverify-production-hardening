import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";

import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decode32(value) {
  let bits = 0, acc = 0;
  const bytes = [];
  for (const char of value.toUpperCase().replace(/=+$/g, "")) {
    const index = B32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32.");
    acc = (acc << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((acc >>> (bits - 8)) & 255);
      bits -= 8;
      acc &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}
function totp(secret) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", decode32(secret)).update(message).digest();
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
        else if (!address || typeof address === "string") reject(new Error("Could not allocate port."));
        else resolve(address.port);
      });
    });
  });
}
async function login(page, baseUrl, identity, role) {
  await page.goto(baseUrl + "/" + role + "/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  if (identity.totpSecret) {
    await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/" + role + "/dashboard", { timeout: 20_000 });
}




import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { assessorInterviewSearchFixture } from "../helpers/assessor-interview-search-fixture.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";
const { FilesystemPrivateObjectStorage }=loadTs("src/lib/secure-files/private-object-storage-core.ts");
const { createEmptyWorkerProfile }=loadTs("src/lib/worker/profile-domain.ts");
const stable=(prefix,seed)=>prefix+"_"+createHash("sha256").update(seed).digest("hex").slice(0,24);

test("Worker exact correction and policy recording erasure reach real consumers and retain protected history",{timeout:180000},async()=>{
 const fixture=await assessorInterviewSearchFixture(),db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const browser=await chromium.launch({headless:true}),root=join(fixture.directory,".data","private-objects");
 await mkdir(root,{recursive:true});
 const storage=new FilesystemPrivateObjectStorage({trustedBasePath:fixture.directory,rootPath:root});
 const workerId=fixture.credentials.worker.accountId,adminId=fixture.credentials.admin.accountId,now=new Date().toISOString(),request=fixture.requests.Alpha;
 const assets={},errors=[];
 let correctionId,deletionId,heldId;
 try{
  const ref=(await db.query("SELECT worker_reference FROM auth_accounts WHERE account_id=$1",[workerId])).rows[0].worker_reference;
  const profile={...createEmptyWorkerProfile({workerSub:workerId,workerId:ref,displayName:"Privacy Worker",email:"fixture@example.test",now}),version:1};
  profile.contact.city="Original browser city";
  await db.query("INSERT INTO worker_profiles(worker_sub,worker_id,schema_version,version,status,profile_document,created_at,updated_at) VALUES($1,$2,1,1,'draft',$3::jsonb,$4,$4) ON CONFLICT(worker_sub) DO UPDATE SET version=1,status='draft',profile_document=$3::jsonb",[workerId,ref,JSON.stringify(profile),now]);
  await db.query("UPDATE assurance_cases SET case_status='Closed',owner_kind=NULL,next_action=NULL,closed_at=$2 WHERE case_id=$1",[request.caseId,now]);
  for(const seed of ["held","allowed","retention"]){
   const asset=stable("recording_asset","privacy-browser-"+seed),bytes=Buffer.from("Real private browser recording "+seed),hash=createHash("sha256").update(bytes).digest("hex"),key="secure-files/"+createHash("sha256").update("privacy-browser-object-"+seed).digest("hex");
   await storage.put(key,bytes);
   await db.query("INSERT INTO recording_assets(recording_asset_id,purpose,interview_request_id,case_id,tenant_id,worker_account_id,captured_by_account_id,source,mime_type,object_key,ingest_key_hash,byte_size,content_sha256,status,started_at,ended_at,retention_until,legal_hold,created_at) VALUES($1,'INTERVIEW',$2,$3,$4,$5,$6,'AUDIO_ONLY','audio/webm',$7,$8,$9,$10,'AVAILABLE','2026-01-01','2026-01-01',$12,$11,'2026-01-01')",[asset,request.interviewRequestId,request.caseId,fixture.credentials.company.tenantId,workerId,adminId,key,createHash("sha256").update("privacy-browser-ingest-"+seed).digest("hex"),bytes.length,hash,seed==="held",seed==="retention"?"2026-01-15T00:00:00Z":"2026-02-01T00:00:00Z"]);
   assets[seed]={asset,key};
  }
  await db.query("INSERT INTO scoped_share_links(share_link_id,owner_worker_id,fields,purpose,created_at,token_nonce_hash) VALUES('privacy_browser_share',$1,'[]','Privacy browser share fixture',$2,$3)",[ref,now,"b".repeat(64)]);
  await db.close();
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment:{...fixture.environment,HSE_RUNTIME_PROJECT_ROOT:fixture.directory},probe:async()=>{
   const worker=await browser.newPage({viewport:{width:390,height:844}}),admin=await browser.newPage();
   worker.on("pageerror",error=>errors.push(error.message));admin.on("pageerror",error=>errors.push(error.message));
   await login(worker,baseUrl,fixture.credentials.worker,"worker");
   await worker.goto(baseUrl+"/worker/privacy",{waitUntil:"domcontentloaded"});
   await worker.getByLabel("Privacy request type").selectOption("correction");
   await worker.getByLabel("Correction scope",{exact:true}).selectOption("profile_contact_city");
   await worker.getByLabel("Requested profile city",{exact:true}).fill("Approved browser city");
   await worker.getByRole("button",{name:"Submit privacy request",exact:true}).click();
   await worker.getByText("correction: OPEN",{exact:true}).waitFor();
   await login(admin,baseUrl,fixture.credentials.admin,"admin");
   await admin.goto(baseUrl+"/admin/privacy",{waitUntil:"domcontentloaded"});
   let card=admin.locator("article").filter({hasText:"Request type: correction"});
   correctionId=await card.locator('input[name="requestId"]').inputValue();
   await card.getByLabel("Request decision").selectOption("COMPLETED");
   await card.getByLabel("Request review reason").fill("Approved this exact city correction and profile version.");
   // Missing exact approval has a recoverable, visible outcome and no completion.
   await card.getByRole("button",{name:"Save privacy request decision",exact:true}).click();
   await admin.getByRole("alert").waitFor();
   card=admin.locator("article").filter({hasText:"Request type: correction"});
   await card.getByText("Status: OPEN",{exact:true}).waitFor();
   await card.getByLabel("Request decision").selectOption("COMPLETED");
   await card.getByLabel("I approve the exact requested city and profile version").check();
   await card.getByLabel("Request review reason").fill("Approved this exact city correction and profile version.");
   await card.getByRole("button",{name:"Save privacy request decision",exact:true}).click();
   await card.getByText("Status: COMPLETED",{exact:true}).waitFor();
   await worker.goto(baseUrl+"/worker/profile?section=contact",{waitUntil:"domcontentloaded"});
   assert.equal(await worker.locator('input[name="city"]').inputValue(),"Approved browser city");
   await worker.reload();assert.equal(await worker.locator('input[name="city"]').inputValue(),"Approved browser city");
   await worker.goto(baseUrl+"/admin/privacy",{waitUntil:"domcontentloaded"});
   assert.equal(new URL(worker.url()).pathname,"/access-denied");
   await worker.goto(baseUrl+"/worker/privacy",{waitUntil:"domcontentloaded"});
   await worker.getByLabel("Privacy request type").selectOption("deletion");
   await worker.getByLabel("Deletion scope",{exact:true}).selectOption("expired_recording");
   await worker.getByLabel("Recording for an erasure request",{exact:true}).selectOption(assets.held.asset);
   await worker.getByRole("button",{name:"Submit privacy request",exact:true}).click();
   await worker.getByText("deletion: OPEN",{exact:true}).waitFor();
   await admin.goto(baseUrl+"/admin/privacy",{waitUntil:"domcontentloaded"});
   card=admin.locator("article").filter({hasText:assets.held.asset});
   heldId=await card.locator('input[name="requestId"]').inputValue();
   await card.getByLabel("Request decision").selectOption("COMPLETED");
   await card.getByLabel("I approve erasure of this exact recording under its current retention policy").check();
   await card.getByLabel("Request review reason").fill("Review this recording; the existing legal hold must block erasure.");
   await card.getByRole("button",{name:"Save privacy request decision",exact:true}).click();
   await admin.getByRole("alert").filter({hasText:"legal hold"}).waitFor();
   assert.ok(await storage.stat(assets.held.key));
   await worker.goto(baseUrl+"/worker/privacy",{waitUntil:"domcontentloaded"});
   await worker.getByLabel("Privacy request type").selectOption("deletion");
   await worker.getByLabel("Deletion scope",{exact:true}).selectOption("expired_recording");
   await worker.getByLabel("Recording for an erasure request",{exact:true}).selectOption(assets.allowed.asset);
   await worker.getByRole("button",{name:"Submit privacy request",exact:true}).click();
   await admin.goto(baseUrl+"/admin/privacy",{waitUntil:"domcontentloaded"});
   card=admin.locator("article").filter({hasText:assets.allowed.asset});
   deletionId=await card.locator('input[name="requestId"]').inputValue();
   await card.getByLabel("Request decision").selectOption("COMPLETED");
   await card.getByLabel("I approve erasure of this exact recording under its current retention policy").check();
   await card.getByLabel("Request review reason").fill("Approved exact expired recording erasure with protected metadata retained.");
   await card.getByRole("button",{name:"Save privacy request decision",exact:true}).click();
   await card.getByText("Status: COMPLETED",{exact:true}).waitFor();
   assert.equal(await storage.stat(assets.allowed.key),null);
   await worker.goto(baseUrl+"/worker/privacy",{waitUntil:"domcontentloaded"});
   assert.equal(new URL(worker.url()).pathname,"/worker/login");
   await admin.goto(baseUrl+"/admin/privacy",{waitUntil:"domcontentloaded"});
   await admin.locator('select[name="tenantId"]').selectOption(fixture.credentials.company.tenantId);
   await admin.getByLabel("Retention cutoff date").fill("2026-01-20");
   await admin.getByRole("button",{name:"Schedule recording retention",exact:true}).click();
   const retention=admin.locator("article").filter({hasText:"Retention category: expired interview recordings"});
   await retention.getByText("Status: PENDING",{exact:false}).waitFor();
   await retention.getByLabel("I approve the current policy eligible recording targets").check();
   await retention.getByLabel("Retention execution reason").fill("Approved the eligible expired interview recording targets under stored policy.");
   await retention.getByRole("button",{name:"Execute recording retention",exact:true}).click();
   await retention.getByText("Status: COMPLETED",{exact:false}).waitFor();
   await retention.getByText("Purged recordings: 1",{exact:true}).waitFor();
   assert.equal(await storage.stat(assets.retention.key),null);
   assert.ok(await storage.stat(assets.held.key));
   assert.equal(errors.length,0,errors.join("\n"));
  }});
  const check=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try {
   assert.equal((await check.query("SELECT profile_document->'contact'->>'city' AS city FROM worker_profiles WHERE worker_sub=$1",[workerId])).rows[0].city,"Approved browser city");
   assert.equal((await check.query("SELECT status FROM privacy_requests WHERE request_id=$1",[correctionId])).rows[0].status,"COMPLETED");
   assert.equal((await check.query("SELECT status FROM privacy_requests WHERE request_id=$1",[heldId])).rows[0].status,"OPEN");
   assert.equal((await check.query("SELECT status FROM privacy_requests WHERE request_id=$1",[deletionId])).rows[0].status,"COMPLETED");
   assert.equal((await check.query("SELECT status FROM recording_assets WHERE recording_asset_id=$1",[assets.allowed.asset])).rows[0].status,"PURGED");
   assert.equal((await check.query("SELECT count(*)::int AS n FROM privacy_execution_events WHERE request_id=$1",[deletionId])).rows[0].n,2);
   assert.equal((await check.query("SELECT count(*)::int AS n FROM auth_sessions WHERE account_id=$1 AND revoked_at IS NULL",[workerId])).rows[0].n,0);
   assert.ok((await check.query("SELECT revoked_at FROM scoped_share_links WHERE share_link_id='privacy_browser_share'")).rows[0].revoked_at);
   assert.equal((await check.query("SELECT execution_result FROM retention_jobs WHERE resource_type='expired_interview_recordings'")).rows[0].execution_result.purgedRecordings,1);
   assert.ok((await check.query("SELECT case_id FROM assurance_cases WHERE case_id=$1",[request.caseId])).rows[0]);
  }finally{await check.close();}
  console.log("ACTUAL_PRIVACY_EXECUTION_BROWSER Worker typed request -> exact Admin approval -> profile consumer; legal hold blocks; expired recording bytes absent; Worker session revoked; immutable metadata retained. General categories remain policy review.");
 }finally{await browser.close();if(!db.closed)await db.close();await fixture.cleanup();}
});
