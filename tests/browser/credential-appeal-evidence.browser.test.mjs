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

import {writeFile} from "node:fs/promises";
import {appealInterviewFixture} from "../helpers/appeal-interview-fixture.mjs";
import {openScriptDatabase} from "../../scripts/lib/database.mjs";
const PNG_FILE = {
  name: "proof.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  )
};
async function createEvidence(page, baseUrl, kind, fields) {
  await page.goto(`${baseUrl}/worker/evidence`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Record type").selectOption(kind);
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/evidence")),
    page.getByRole("button", { name: "Create draft" }).click()
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });

  const title = `${kind[0].toUpperCase()}${kind.slice(1)} record`;
  const article = page.locator("article").filter({ hasText: title }).first();

  for (const [label, value] of fields.inputs ?? []) {
    const control = label === "Skill"
      ? article.getByRole("textbox", { name: "Skill", exact: true })
      : article.getByLabel(label, { exact: false }).first();
    await control.fill(String(value));
  }
  for (const [label, value] of fields.selects ?? []) {
    await article.getByLabel(label, { exact: false }).first().selectOption(String(value));
  }
  for (const label of fields.checks ?? []) {
    await article.getByLabel(label).check();
  }
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/evidence")),
    article.getByRole("button", { name: "Save metadata" }).click()
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });

  const updated = page.locator("article").filter({ hasText: title }).first();
  const fileLabel = kind === "qualification" ? "Primary certificate file" : "Evidence file";
  await updated.getByLabel(fileLabel, { exact: true }).setInputFiles({
    ...PNG_FILE,
    name: `${kind}-proof.png`
  });
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/evidence")),
    updated.getByRole("button", { name: "Upload file" }).click()
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });

  const ready = page.locator("article").filter({ hasText: title }).first();
  const attached=ready.getByText(`${kind}-proof.png · ${kind === "qualification" ? "primary certificate" : `${kind} evidence`} · active`,{exact:true});
  for(let attempt=0;attempt<20&&!(await attached.count());attempt++){
    await Promise.all([page.waitForResponse(response=>response.request().method()==="POST"&&response.url().includes("/worker/evidence")),ready.getByRole("button",{name:"Check scan status",exact:true}).click()]);
    await page.reload({waitUntil:"domcontentloaded"});
  }
  await attached.waitFor();
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/evidence")),
    ready.getByRole("button", { name: "Submit this version" }).click()
  ]);
  await page.goto(`${baseUrl}/worker/evidence`, { waitUntil: "domcontentloaded" });
  await page.locator("article").filter({ hasText: title }).first()
    .getByText("active · submitted", { exact: true }).waitFor({ timeout: 15_000 });
}



test("Actual appeal scanned evidence response opens exact bytes for independent Admin review",{timeout:180000},async()=>{
 const f=await appealInterviewFixture();let browser;
 try{
  const db=f.database,original=(await db.query("SELECT * FROM assurance_cases WHERE case_id=$1",[f.row.case_id])).rows[0];
  await db.query("UPDATE auth_accounts SET password_hash=source.password_hash,password_set_at=source.password_set_at FROM auth_accounts source WHERE auth_accounts.account_id=$1 AND source.account_id=$2",[f.admin.accountId,f.credentials.admin.accountId]);
  await db.query("INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,created_at,activated_at) SELECT 'appeal-evidence-browser-admin',$1,'totp',encrypted_secret,'active',clock_timestamp(),clock_timestamp() FROM auth_mfa_factors WHERE account_id=$2 AND factor_status='active'",[f.admin.accountId,f.credentials.admin.accountId]);
  const adminCredentials={...f.credentials.admin,accountId:f.admin.accountId,email:f.admin.email};await f.releaseDatabase();
  const environment={...f.environment,HSE_CREDENTIAL_SIGNING_SECRET:f.key},port=await freePort(),baseUrl="http://127.0.0.1:"+port;browser=await chromium.launch({headless:true});const admin=await(await browser.newContext()).newPage(),worker=await(await browser.newContext()).newPage(),errors=[];
  for(const page of [admin,worker]){page.on("pageerror",e=>errors.push(e.message));page.on("response",r=>{if(r.status()>=500)errors.push(r.status()+" "+new URL(r.url()).pathname);});}
  let binding;await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/admin/login",environment,projectRoot:process.cwd(),probe:async({output})=>{try{
   await login(admin,baseUrl,adminCredentials,"admin");await admin.goto(baseUrl+"/admin/appeals");const appeal=admin.locator('article[id="'+f.appeal.appealId+'"]'),followup=appeal.getByRole("form",{name:"Request followup "+f.appeal.appealId});await followup.getByLabel("Required followup").selectOption("evidence");await followup.getByLabel("Reason for followup").fill("Supply the scanned certificate supporting these appeal grounds.");await followup.getByRole("button",{name:"Request appeal followup",exact:true}).click();await appeal.getByText("Response required",{exact:true}).waitFor();
   await login(worker,baseUrl,f.credentials.worker,"worker");await createEvidence(worker,baseUrl,"qualification",{inputs:[["Qualification title","Independent appeal certificate"],["Category","Safety"],["Issuing organization","Example Issuer"],["Certificate / candidate number","APPEAL-SCAN-001"],["Level","Level 3"],["Issue date","2025-02-01"],["Country","Pakistan"]],checks:["I confirm these qualification details"]});
   await worker.goto(baseUrl+"/worker/appeals");const response=worker.locator('article[id="'+f.appeal.appealId+'"] ').getByRole("form",{name:/Respond to /}),selected=response.locator('input[name="evidenceVersionReferences"]').first();binding=JSON.parse(await selected.inputValue());await selected.check();await response.getByLabel("Response explanation").fill("This scanned certificate supports my independent appeal grounds.");await response.getByRole("button",{name:"Submit further appeal evidence",exact:true}).click();await worker.getByText("Further evidence submitted for independent appeal review.",{exact:true}).waitFor();
   await admin.goto(baseUrl+"/admin/notifications");await admin.getByRole("button",{name:"Create persisted test notification",exact:true}).click();await admin.waitForURL("**/admin/notifications?notice=fixture-ready");const notice=admin.locator("li.notification-center-item").filter({has:admin.getByRole("heading",{name:"Appeal evidence submitted",exact:true})});for(let attempt=0;attempt<20&&!(await notice.count());attempt++)await admin.reload();await notice.getByRole("button",{name:"Open",exact:true}).click();await admin.waitForURL("**/admin/appeals#"+f.appeal.appealId);await appeal.getByText("Response received",{exact:true}).waitFor();const scan=appeal.getByRole("link",{name:/Open submitted evidence/});assert.equal(await scan.count(),1);const href=await scan.getAttribute("href");assert.ok(href);
   const bytes=await admin.request.get(baseUrl+href);assert.equal(bytes.status(),200);assert.deepEqual(await bytes.body(),PNG_FILE.buffer);// A binary image must open in its own browser document: moving the
   // existing Admin review tab into the file route aborts the next review
   // navigation and discards in-progress form context.
   const [previewTab]=await Promise.all([admin.waitForEvent("popup"),scan.click()]);
   try{
     await previewTab.waitForLoadState("load");
     assert.equal(new URL(previewTab.url()).pathname,href);
     await previewTab.locator("img").first().waitFor({state:"visible"});
     assert.equal(await previewTab.locator("img").first().evaluate(img=>img.complete&&img.naturalWidth>0),true);
   }finally{await previewTab.close();}
   assert.equal(new URL(admin.url()).pathname,"/admin/appeals");
   await admin.reload({waitUntil:"domcontentloaded"});const review=appeal.getByRole("form",{name:"Review "+f.appeal.appealId,exact:true});await review.getByLabel("Review status").selectOption("rejected");await review.getByLabel("Reasoned review outcome").fill("Independent review of the retained scanned certificate confirms the original reasoned outcome.");await review.getByRole("button",{name:"Record appeal review",exact:true}).click();await admin.waitForURL("**/admin/appeals?status=updated");await worker.goto(baseUrl+"/worker/appeals");await worker.locator('article[id="'+f.appeal.appealId+'"] ').getByText(/Status: rejected/).waitFor();
  }finally{await writeFile(".autopilot/artifacts/20261015-appeal-evidence-worker-state.txt",worker.url()+"\n"+await worker.locator("body").innerText());await writeFile(".autopilot/artifacts/20261015-appeal-evidence-browser-server.log",output());}}});
  const proof=await openScriptDatabase({databaseDriver:"pglite",pgliteDataDir:environment.HSE_PGLITE_DATA_DIR});try{assert.deepEqual((await proof.query("SELECT * FROM assurance_cases WHERE case_id=$1",[f.row.case_id])).rows[0],original);const response=(await proof.query("SELECT evidence FROM credential_appeal_followup_events WHERE appeal_id=$1 AND event_type='evidence_submitted'",[f.appeal.appealId])).rows;assert.equal(response.length,1);assert.equal(response[0].evidence[0].recordId,binding.recordId);assert.equal(response[0].evidence[0].versionId,binding.versionId);}finally{await proof.close();}assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();await f.cleanup();}
});
