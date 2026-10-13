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




test("Actual resolution forms reach native CLI, role bells and guarded record links",{timeout:240000},async()=>{
 const root=process.cwd(),directory=await mkdtemp(join(tmpdir(),"review-resolution-notify-browser-")),port=await freePort(),baseUrl=`http://127.0.0.1:${port}`;
 const credentialPath=join(directory,"credentials.json");
 const environment={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:join(directory,"database"),HSE_AUDIT_CREDENTIALS_PATH:credentialPath,HSE_RELEASE_SHA:"review-resolution-notify-browser",HSE_SESSION_SECRET:"review-resolution-browser-session-secret-more-than-thirty-two",HSE_AUTH_PEPPER:"review-resolution-browser-auth-pepper-more-than-thirty-two",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
 let browser;
 try{
 for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs","scripts/build-outbox-worker.mjs"]){const r=spawnSync(process.execPath,[script],{cwd:root,env:environment,encoding:"utf8"});assert.equal(r.status,0,r.stderr||r.stdout);}
 const credentials=JSON.parse(await readFile(credentialPath,"utf8"));
 browser=await chromium.launch({headless:true});
 const wp=await(await browser.newContext({viewport:{width:390,height:844}})).newPage(),vp=await(await browser.newContext({viewport:{width:1440,height:1000}})).newPage(),ap=await(await browser.newContext({viewport:{width:1440,height:1000}})).newPage();
 const errors=[];for(const page of [wp,vp,ap]){page.on("pageerror",error=>errors.push(error.message));page.on("response",response=>{if(response.status()>=500)errors.push(response.status()+" "+new URL(response.url()).pathname);});}
 const server=probe=>runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:root,environment,probe});
 const drain=async types=>{
  for(let attempt=0;attempt<=24;attempt++){
   const db=await PGlite.create(environment.HSE_PGLITE_DATA_DIR);let pending;
   try{pending=(await db.query("SELECT payload->>'eventType' kind,status FROM platform_outbox_jobs WHERE job_type='notification.assurance.event' AND payload->>'eventType'=ANY($1::text[])",[types])).rows;assert.equal(pending.length,types.length);assert.ok(!pending.some(j=>j.status==="terminal_failed"));}
   finally{await db.close();}
   if(pending.every(j=>j.status==="succeeded"))return;
   assert.ok(attempt<24,"Native CLI must project all exact resolution jobs within bounded drain.");
   const r=spawnSync(process.execPath,["scripts/run-outbox-worker.mjs","--once"],{cwd:root,env:environment,encoding:"utf8"});
   const outcome=JSON.parse(r.stdout.trim());assert.equal(outcome.processed,1,JSON.stringify({worker:r.stdout,error:r.stderr,pending}));assert.ok(["succeeded","retry_wait"].includes(outcome.status),r.stderr||r.stdout);
   assert.equal(r.status,outcome.status==="succeeded"?0:1,JSON.stringify({worker:r.stdout,error:r.stderr,pending,exit:r.status}));
  }
 };
 let taskId;
 await server(async()=>{
  await login(wp,baseUrl,credentials.worker,"worker");
  await createEvidence(wp,baseUrl,"qualification",{inputs:[["Qualification title","Notification source review certificate"],["Category","Safety"],["Issuing organization","Example Issuer"],["Certificate / candidate number","REVIEW-NOTIFY-001"],["Level","Level 3"],["Issue date","2025-02-01"],["Country","Pakistan"]],checks:["I confirm these qualification details"]});
  await login(vp,baseUrl,credentials.verifier,"verifier");
  async function claim(kind){await vp.goto(baseUrl+"/verifier/reviews");const row=vp.locator("tbody tr").filter({has:vp.locator("td",{hasText:kind})}).filter({hasText:"QUEUED"}).first();await row.getByRole("link",{name:"Review"}).click();await vp.getByRole("button",{name:"Claim review",exact:true}).click();await vp.getByText("ASSIGNED",{exact:true}).waitFor();}
  await claim("qualification");
  await vp.getByLabel("Unable to verify reason",{exact:true}).fill("Private issuer detail belongs only in the authorized record.");
  await vp.getByLabel("Attempted verification methods",{exact:true}).fill("Contacted the issuer using the retained directory.");
  await vp.getByLabel("Verification limitations",{exact:true}).fill("The issuer did not respond to the retained inquiry.");
  await vp.getByRole("button",{name:"Record unable to verify",exact:true}).click();await vp.getByText("UNABLE_TO_VERIFY",{exact:true}).waitFor();
  await createEvidence(wp,baseUrl,"experience",{inputs:[["Company / organization","Example Employer"],["Role / activity","Safety Officer"],["Country","Pakistan"],["Start date","2022-01-01"],["Duties / experience detail","Permit reviews and operational site inspections."]],selects:[["Status","current"]]});
  await claim("experience");taskId=vp.url().split("/").at(-1);
  await vp.getByLabel("Escalation reason",{exact:true}).fill("Private employer discrepancy requires authorized Admin review.");await vp.getByLabel("Escalation destination",{exact:true}).selectOption("admin");
  await vp.getByRole("button",{name:"Escalate review",exact:true}).click();await vp.getByRole("heading",{name:"ESCALATED",exact:true}).waitFor();
 });
 await drain(["evidence.unable","evidence.escalated"]);
 await server(async()=>{
  await wp.goto(baseUrl+"/worker/notifications");const unable=wp.locator(".notification-center-item").filter({hasText:"Evidence could not be verified"});await unable.waitFor();
  assert.ok(!(await unable.innerText()).includes("Private"));await unable.getByRole("button",{name:"Open",exact:true}).click();await wp.waitForURL("**/worker/evidence#*");
  await wp.getByText(/Private issuer detail belongs only/).waitFor();
  await login(ap,baseUrl,credentials.admin,"admin");await ap.goto(baseUrl+"/admin/notifications");
  const escalated=ap.locator(".notification-center-item").filter({hasText:"Evidence review escalated"});await escalated.waitFor();assert.ok(!(await escalated.innerText()).includes("Private"));
  await escalated.getByRole("button",{name:"Open",exact:true}).click();await ap.waitForURL("**/admin/operations/review-escalations#"+taskId);
  const article=ap.locator("article").filter({hasText:"Private employer discrepancy"});await article.waitFor();
  await article.getByLabel("Review and return reason",{exact:true}).fill("Independent employer records are available; return to a Verifier.");await article.getByRole("button",{name:"Return to Verifier queue",exact:true}).click();await ap.getByText("Escalation reviewed and returned to the Verifier queue.",{exact:true}).waitFor();
  await ap.goto(baseUrl+"/admin/notifications");assert.equal(await ap.locator(".notification-center-item").filter({hasText:"Evidence review escalated"}).count(),0);
 });
 await drain(["evidence.returned"]);
 await server(async()=>{
  await vp.goto(baseUrl+"/verifier/notifications");const returned=vp.locator(".notification-center-item").filter({hasText:"Evidence returned to review"});await returned.waitFor();
  await returned.getByRole("button",{name:"Open",exact:true}).click();await vp.waitForURL("**/verifier/reviews/"+taskId);await vp.getByRole("button",{name:"Claim review",exact:true}).waitFor();
  await wp.goto(baseUrl+"/worker/notifications");const workerReturn=wp.locator(".notification-center-item").filter({hasText:"Evidence returned to review"});await workerReturn.waitFor();await workerReturn.getByRole("button",{name:"Open",exact:true}).click();await wp.waitForURL("**/worker/evidence#*");await wp.getByText(/Independent verification: queued/).waitFor();
  const denied=await wp.goto(baseUrl+"/admin/operations/review-escalations");assert.ok(denied.status()>=400 || !wp.url().endsWith("/admin/operations/review-escalations"));
 });
 assert.deepEqual(errors,[]);
 const db=await PGlite.create(environment.HSE_PGLITE_DATA_DIR);try{
 assert.equal((await db.query("SELECT count(*)::int n FROM platform_outbox_jobs WHERE job_type='notification.assurance.event' AND payload->>'eventType' IN ('evidence.unable','evidence.escalated','evidence.returned') AND status='succeeded'")).rows[0].n,3);
 assert.equal((await db.query("SELECT count(*)::int n FROM evidence_review_decisions")).rows[0].n,0);
 }finally{await db.close();}
 }finally{await browser?.close();await rm(directory,{recursive:true,force:true});}
});
