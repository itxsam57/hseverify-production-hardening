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



test("Admin resolves authoritative applicability and calibration; failure revokes live review without losing task",{timeout:180000},async()=>{
 const root=process.cwd(),directory=await mkdtemp(join(tmpdir(),"hse-calibration-browser-"));
 const port=await freePort(),baseUrl=`http://127.0.0.1:${port}`,credentialsPath=join(directory,"credentials.json");
 const environment={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:directory,HSE_AUDIT_CREDENTIALS_PATH:credentialsPath,HSE_RELEASE_SHA:"calibration-browser",HSE_SESSION_SECRET:"calibration-browser-session-secret-2026-000000000",HSE_AUTH_PEPPER:"calibration-browser-auth-pepper-2026-000000000",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
 try{
  for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){const r=spawnSync(process.execPath,[script],{cwd:root,env:environment,encoding:"utf8"});assert.equal(r.status,0,r.stderr||r.stdout);}
  const credentials=JSON.parse(await readFile(credentialsPath,"utf8"));
  const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:`${baseUrl}/worker/login`,projectRoot:root,environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});const contexts=await Promise.all([browser.newContext(),browser.newContext(),browser.newContext()]);
   const [worker,verifier,admin]=await Promise.all(contexts.map(c=>c.newPage()));
   try{
    await login(worker,baseUrl,credentials.worker,"worker");
    await createEvidence(worker,baseUrl,"experience",{inputs:[["Company / organization","Calibration proof employer"],["Role / activity","Safety Officer"],["Country","Pakistan"],["Start date","2022-01-01"],["Duties / experience detail","Review safe systems and inspect attributable evidence."]],selects:[["Status","current"]]});
    await login(verifier,baseUrl,credentials.verifier,"verifier");await verifier.goto(`${baseUrl}/verifier/reviews`);
    await verifier.locator("tbody tr").filter({hasText:"experience"}).getByRole("link",{name:"Review",exact:true}).click();
    await verifier.getByText(/Live review is blocked: framework unresolved/).waitFor();assert.equal(await verifier.getByRole("button",{name:"Claim review",exact:true}).count(),0);
    const taskUrl=verifier.url();
    await login(admin,baseUrl,credentials.admin,"admin");await admin.goto(`${baseUrl}/admin/frameworks`);
    const creation=admin.locator("form").filter({has:admin.getByRole("button",{name:"Create framework",exact:true})});
    await creation.getByLabel("Reference",{exact:true}).fill("CAL-BROWSER");await creation.getByLabel("Title",{exact:true}).fill("Observed evidence review standard");await creation.getByRole("button",{name:"Create framework",exact:true}).click();await admin.getByText("Framework created.",{exact:true}).waitFor();
    await admin.goto(`${baseUrl}/admin/calibrations`);await admin.getByRole("link",{name:"Resolve evidence-review framework bindings"}).click();await admin.waitForURL("**/admin/review-frameworks");await admin.getByRole("heading",{name:"Review framework applicability",exact:true}).waitFor();
    const taskId=new URL(taskUrl).pathname.split("/").at(-1);
    const binding=admin.locator("form").filter({has:admin.locator('input[name="taskId"][value="'+taskId+'"]')});
    const options=await binding.locator('select[name="frameworkVersionId"] option').evaluateAll(items=>items.map(item=>({value:item.value,text:item.textContent})));
    assert.ok(options.some(item=>item.text.includes("CAL-BROWSER")),"Exact task applicability: "+JSON.stringify(options)+"; "+await admin.locator("main").innerText());
    const revision=options.find(item=>item.text.includes("CAL-BROWSER")).value;
    await binding.getByLabel("Review framework revision").selectOption(revision);await binding.getByLabel("Applicability reason").fill("Explicit standard for this submitted standalone experience.");await binding.getByRole("button",{name:"Bind review framework"}).click();await admin.getByText("Review framework binding recorded.",{exact:true}).waitFor();
    await verifier.reload();await verifier.getByText(/Live review is blocked: calibration missing/).waitFor();
    const started=new Date(Date.now()+60000);await new Promise(resolve=>setTimeout(resolve,1100)); // Framework creation precedes calibration start.
    async function record(status){
     await admin.goto(`${baseUrl}/admin/calibrations`);const form=admin.locator("form").filter({has:admin.getByRole("button",{name:"Record calibration",exact:true})});
     const staff=await form.locator('select[name="accountId"] option').filter({hasText:credentials.verifier.email}).getAttribute("value");
     await form.getByLabel("Staff member").selectOption(staff);await form.getByLabel("Framework reference").selectOption("CAL-BROWSER");await form.getByLabel("Framework revision").selectOption(revision);await form.getByLabel("Status").selectOption(status);

     await form.getByLabel("Valid from",{exact:true}).fill(started.toISOString().slice(0,16));await form.getByLabel("Valid until",{exact:true}).fill(new Date(Date.now()+86400000).toISOString().slice(0,16));await form.getByLabel("Calibration evidence / note").fill("Observed benchmark evidence and independent quality check.");await form.getByRole("button",{name:"Record calibration",exact:true}).click();await admin.getByText("Calibration recorded.",{exact:true}).waitFor();
    }
    await record("CURRENT");const effective=new Date(started.toISOString().slice(0,16)+":00Z").getTime();if(Date.now()<effective)await new Promise(resolve=>setTimeout(resolve,effective-Date.now()+50));
    await verifier.goto(taskUrl);await verifier.getByRole("button",{name:"Claim review",exact:true}).click();await verifier.getByText("ASSIGNED",{exact:true}).waitFor();await verifier.getByRole("button",{name:"Finalize review",exact:true}).waitFor();
    await record("FAILED");await verifier.reload();await verifier.getByText(/Live review is blocked: calibration not current/).waitFor();assert.equal(await verifier.getByRole("button",{name:"Finalize review",exact:true}).count(),0);assert.equal(await verifier.getByRole("link",{name:"Preview evidence",exact:true}).count(),0);
    await verifier.reload();await verifier.getByText("ASSIGNED",{exact:true}).waitFor();
   }finally{await browser.close();}
  }});assert.equal(result.responseStatus,200);assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
  const db=new PGlite(directory);try{assert.equal((await db.query("SELECT count(*)::integer n FROM evidence_review_decisions")).rows[0].n,0);assert.equal((await db.query("SELECT count(*)::integer n FROM evidence_review_framework_bindings")).rows[0].n,1);assert.equal((await db.query("SELECT count(*)::integer n FROM staff_calibrations WHERE framework_id IS NOT NULL")).rows[0].n,2);}finally{await db.close();}
 }finally{await rm(directory,{recursive:true,force:true});}
});
