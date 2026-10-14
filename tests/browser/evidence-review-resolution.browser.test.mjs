import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { prepareReviewCalibrationFixture } from "../helpers/evidence-review-calibration-fixture.mjs";

const PNG_FILE = {
  name: "proof.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  )
};
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
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/worker/evidence")),
    ready.getByRole("button", { name: "Submit this version" }).click()
  ]);
  await page.goto(`${baseUrl}/worker/evidence`, { waitUntil: "domcontentloaded" });
  await page.locator("article").filter({ hasText: title }).first()
    .getByText("active · submitted", { exact: true }).waitFor({ timeout: 15_000 });
}



test("Worker evidence resolves without approval and escalation returns through the actual Admin form",{timeout:180000},async()=>{
 const root=process.cwd(),directory=await mkdtemp(join(tmpdir(),"review-resolution-browser-")),port=await freePort(),baseUrl=`http://127.0.0.1:${port}`;
 const credentialPath=join(directory,"credentials.json");
 const environment={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:join(directory,"database"),HSE_AUDIT_CREDENTIALS_PATH:credentialPath,HSE_RELEASE_SHA:"review-resolution-browser",HSE_SESSION_SECRET:"review-resolution-browser-session-secret-more-than-thirty-two",HSE_AUTH_PEPPER:"review-resolution-browser-auth-pepper-more-than-thirty-two",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
 try{
 for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){const r=spawnSync(process.execPath,[script],{cwd:root,env:environment,encoding:"utf8"});assert.equal(r.status,0,r.stderr||r.stdout);}
 const credentials=JSON.parse(await readFile(credentialPath,"utf8"));
 const authorityDb=await PGlite.create(environment.HSE_PGLITE_DATA_DIR);
 try{await prepareReviewCalibrationFixture(authorityDb,{verifiers:[{accountId:credentials.verifier.accountId}],reference:"REVIEW-RESOLUTION",at:new Date()});}
 finally{await authorityDb.close();}
 await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:root,environment,probe:async()=>{
 const browser=await chromium.launch({headless:true});try{
 const wp=await(await browser.newContext()).newPage(),vp=await(await browser.newContext()).newPage(),ap=await(await browser.newContext()).newPage();
 await login(wp,baseUrl,credentials.worker,"worker");
 await login(ap,baseUrl,credentials.admin,"admin");
 await createEvidence(wp,baseUrl,"qualification",{inputs:[["Qualification title","Independent source review certificate"],["Category","Safety"],["Issuing organization","Example Issuer"],["Certificate / candidate number","REVIEW-NEUTRAL-001"],["Level","Level 3"],["Issue date","2025-02-01"],["Country","Pakistan"]],checks:["I confirm these qualification details"]});
 await login(vp,baseUrl,credentials.verifier,"verifier");
 async function claim(kind){
  await vp.goto(baseUrl+"/verifier/reviews");
  const row=vp.locator("tbody tr").filter({has:vp.locator("td",{hasText:kind})}).filter({hasText:"QUEUED"}).first();
  const href=await row.getByRole("link",{name:"Review"}).getAttribute("href");assert.ok(href);
  const taskId=href.split("/").filter(Boolean).at(-1);assert.ok(taskId);
  await ap.goto(baseUrl+"/admin/review-frameworks",{waitUntil:"domcontentloaded"});
  const card=ap.locator(`section[aria-label="Framework for ${taskId}"]`);await card.waitFor();
  if(await card.getByText("Framework unresolved",{exact:true}).count()){
   const select=card.locator('select[name="frameworkVersionId"]');
   const options=await select.locator("option").evaluateAll(items=>items.map(x=>({value:x.value,text:x.textContent??""})).filter(x=>x.value&&x.text.includes("REVIEW-RESOLUTION")));
   assert.equal(options.length,1);await select.selectOption(options[0].value);
   await card.locator('textarea[name="reason"]').fill("Resolution browser journey uses the explicit authoritative review standard.");
   await card.getByRole("button",{name:"Bind review framework",exact:true}).click();
   await ap.getByText("Review framework binding recorded.",{exact:true}).waitFor();
  }
  await vp.goto(baseUrl+href,{waitUntil:"domcontentloaded"});
  await vp.getByRole("button",{name:"Claim review",exact:true}).click();
  await vp.getByText("ASSIGNED",{exact:true}).waitFor();
 }
 await claim("qualification");
 await vp.getByLabel("Unable to verify reason",{exact:true}).fill("The issuer could not independently confirm this certificate.");
 await vp.getByLabel("Attempted verification methods",{exact:true}).fill("Contacted the issuer and searched their public registration directory.");
 await vp.getByLabel("Verification limitations",{exact:true}).fill("No issuer response; the directory does not contain this certificate year.");
 await vp.getByRole("button",{name:"Record unable to verify",exact:true}).click();await vp.getByText("UNABLE_TO_VERIFY",{exact:true}).waitFor();assert.equal(await vp.getByRole("link",{name:"Preview evidence",exact:true}).count(),0,"Neutral review must not expose a predictably denied preview link");
 await vp.reload();await vp.getByText(/Attempted methods: Contacted the issuer/).waitFor();
 await wp.goto(baseUrl+"/worker/evidence");await wp.getByText(/Independent verification: unable to verify/).waitFor();await wp.getByText("The issuer could not independently confirm this certificate.",{exact:false}).waitFor();
 await createEvidence(wp,baseUrl,"experience",{inputs:[["Company / organization","Example Employer"],["Role / activity","Safety Officer"],["Country","Pakistan"],["Start date","2022-01-01"],["Duties / experience detail","Permit reviews and operational site inspections."]],selects:[["Status","current"]]});
 await claim("experience");const taskId=vp.url().split("/").at(-1);
 const stale=await vp.context().newPage();await stale.goto(vp.url());assert.equal(await stale.locator('input[name="decisionRevision"]').inputValue(),"0");await stale.getByLabel("Reason",{exact:true}).fill("Stale original review before the Admin escalation return.");
 await vp.getByLabel("Escalation reason",{exact:true}).fill("Issuer information is inconsistent; an Admin review is required.");await vp.getByLabel("Escalation destination",{exact:true}).selectOption("admin");
 await vp.getByRole("button",{name:"Escalate review",exact:true}).click();await vp.getByRole("heading",{name:"ESCALATED",exact:true}).waitFor();assert.equal(await vp.getByRole("link",{name:"Preview evidence",exact:true}).count(),0,"Escalated review must not expose a predictably denied preview link");
 await wp.goto(baseUrl+"/worker/evidence");await wp.getByText(/Independent verification: escalated/).waitFor();
 await ap.goto(baseUrl+"/admin/operations");await ap.getByRole("link",{name:"Evidence review escalations",exact:true}).click();
 await ap.getByRole("heading",{name:"Evidence review escalations",exact:true}).waitFor();
 const article=ap.locator("article").filter({hasText:"Issuer information is inconsistent"});await article.waitFor();assert.equal(await article.count(),1);
 await article.getByLabel("Review and return reason",{exact:true}).fill("Independent records are available; return this evidence to a Verifier.");await article.getByRole("button",{name:"Return to Verifier queue",exact:true}).click();await ap.getByText("Escalation reviewed and returned to the Verifier queue.",{exact:true}).waitFor();
 await ap.reload();await ap.getByText("No evidence review escalations.",{exact:true}).waitFor();
 await vp.goto(baseUrl+"/verifier/reviews/"+taskId);await vp.getByRole("button",{name:"Claim review",exact:true}).waitFor();
 await wp.goto(baseUrl+"/worker/evidence");await wp.getByText(/Independent verification: queued/).waitFor();
 await vp.getByRole("button",{name:"Claim review",exact:true}).click();await vp.getByText("ASSIGNED",{exact:true}).waitFor();
 assert.equal(await vp.locator('input[name="decisionRevision"]').inputValue(),"2");
 await stale.getByRole("button",{name:"Finalize review",exact:true}).click();await stale.getByRole("alert").getByText("Review history changed. Reload the task before finalizing.",{exact:true}).waitFor();
 await vp.reload();await vp.getByText("ASSIGNED",{exact:true}).waitFor();
 await vp.getByLabel("Reason",{exact:true}).fill("Fresh issuer records were independently reviewed after the Admin return.");await vp.getByRole("button",{name:"Finalize review",exact:true}).click();await vp.getByText("APPROVED",{exact:true}).waitFor();
 await wp.goto(baseUrl+"/worker/evidence");await wp.getByText(/Independent verification: approved/).waitFor();

 const denied=await wp.goto(baseUrl+"/admin/operations/review-escalations");assert.ok(denied.status()>=400 || !wp.url().endsWith("/admin/operations/review-escalations"));
 }finally{await browser.close();}
 }});
 const db=await PGlite.create(environment.HSE_PGLITE_DATA_DIR);try{
 const events=(await db.query("SELECT outcome FROM evidence_review_resolution_events ORDER BY occurred_at,revision")).rows;assert.deepEqual(events.map(x=>x.outcome),["UNABLE_TO_VERIFY","ESCALATED","RETURNED_TO_QUEUE"]);
 assert.equal((await db.query("SELECT count(*)::int total FROM evidence_review_decisions")).rows[0].total,1);
 }finally{await db.close();}
 }finally{await rm(directory,{recursive:true,force:true});}
});
