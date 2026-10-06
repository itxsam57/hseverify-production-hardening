import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
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
test("Public contact/demo reaches private staff intake with preserved drafts on rejection",{timeout:240000},async()=>{
 const databaseDirectory=await mkdtemp(join(tmpdir(),"hse-inquiry-browser-"));
 const port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const environment={...process.env,HSE_APP_ENV:"test",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:databaseDirectory,HSE_RELEASE_SHA:"public-inquiry-browser",HSE_SESSION_SECRET:"public-inquiry-browser-session-secret-more-than-32",HSE_AUTH_PEPPER:"public-inquiry-browser-auth-pepper-more-than-32",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false",HSE_ENABLE_AUTH_SANDBOX:"false"};
 try{
  for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){
   const r=spawnSync(process.execPath,[script],{env:environment,encoding:"utf8"});assert.equal(r.status,0,r.stderr);
  }
  const credentials=JSON.parse(await readFile("/tmp/independent-audit-credentials.json","utf8"));
  const publicCredentialId="credential_id_"+"C".repeat(24);
  const seedDb=new PGlite(databaseDirectory);
  try{
   await seedDb.query("INSERT INTO credential_issuances(credential_id,worker_id,qualification,issued_at,status,version,public_status_url,qr_payload,signature,pdf_url) VALUES($1,$2,'Public concern regression fixture',CURRENT_TIMESTAMP,'valid',1,$3,$3,$4,$5)",
    [publicCredentialId,credentials.worker.accountId,"/verify/"+publicCredentialId,"s".repeat(64),"/api/credentials/"+publicCredentialId+"/pdf"]);
  }finally{await seedDb.close();}
  const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl,projectRoot:process.cwd(),environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try{
    const publicPage=await browser.newPage({viewport:{width:390,height:844}});
    let releaseScripts;
    const hydrationGate=new Promise(resolve=>{releaseScripts=resolve;});
    await publicPage.route("**/_next/**/*.js*",async route=>{await hydrationGate;await route.continue();});
    await publicPage.goto(baseUrl+"/contact",{waitUntil:"commit"});
    try{
     await publicPage.getByLabel("Your name",{exact:true}).waitFor();
     assert.equal(await publicPage.getByLabel("Your name",{exact:true}).isDisabled(),true,"SSR form must wait for hydration before accepting controlled drafts");
    }finally{releaseScripts();}
    await publicPage.waitForFunction(()=>!document.querySelector('input[name="name"]')?.disabled);
    await publicPage.unrouteAll({behavior:"wait"});
    await publicPage.getByLabel("Your name",{exact:true}).fill("Contact browser person");
    await publicPage.getByLabel("Email address",{exact:true}).fill("contact-browser@example.test");
    await publicPage.getByLabel("How can we help?",{exact:true}).fill("short");
    await publicPage.locator("form").evaluate(form=>{form.noValidate=true;});
    await publicPage.getByRole("button",{name:"Send message",exact:true}).click();
    await publicPage.getByText("Message must contain 10 to 4000 characters.",{exact:true}).waitFor();
    assert.equal(await publicPage.getByLabel("Your name",{exact:true}).inputValue(),"Contact browser person");
    assert.equal(await publicPage.getByLabel("How can we help?",{exact:true}).inputValue(),"short");
    await publicPage.getByLabel("How can we help?",{exact:true}).fill("Please explain the available assurance workflow.");
    await publicPage.getByRole("button",{name:"Send message",exact:true}).click();
    await publicPage.getByText("Your request was received for staff follow-up. Keep this reference.",{exact:true}).waitFor();
    await publicPage.getByText("Request reference:",{exact:true}).waitFor();
    await publicPage.goto(baseUrl);
    await publicPage.getByRole("link",{name:"Request a demo",exact:true}).click();
    await publicPage.getByLabel("Your name",{exact:true}).fill("Demo browser person");
    await publicPage.getByLabel("Email address",{exact:true}).fill("demo-browser@example.test");
    await publicPage.getByLabel("What would you like to see?",{exact:true}).fill("Please show the company and worker assurance portals.");
    await publicPage.getByRole("button",{name:"Request demo",exact:true}).click();
    await publicPage.getByText("Your request was received for staff follow-up. Keep this reference.",{exact:true}).waitFor();
    assert.ok(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
    await publicPage.goto(baseUrl+"/verify");
    await publicPage.getByLabel("Worker ID or Credential ID",{exact:true}).fill(publicCredentialId);
    await publicPage.getByRole("button",{name:"Verify",exact:true}).click();
    await publicPage.waitForURL("**/verify/result/**");
    await publicPage.getByRole("link",{name:"Report a credential concern",exact:true}).click();
    await publicPage.getByRole("heading",{name:"Report a credential concern",exact:true}).waitFor();
    await publicPage.getByLabel("Concern type",{exact:true}).selectOption("status_dispute");
    await publicPage.getByLabel("What is wrong?",{exact:true}).fill("The public credential status needs staff verification.");
    await publicPage.getByLabel("Email",{exact:true}).fill("concern-browser@example.test");
    await publicPage.getByRole("button",{name:"Submit concern",exact:true}).click();
    await publicPage.getByText("Your credential concern was received. Keep the reference below if you need to follow up.",{exact:true}).waitFor();
    for(const role of ["admin","root"]){
     const page=await browser.newPage();await login(page,baseUrl,credentials[role],role);
     await page.getByRole("link",{name:"Contact & demo requests",exact:true}).click();
     await page.getByRole("heading",{name:"Contact & demo requests",exact:true}).waitFor();
     await page.getByText("Name: Contact browser person",{exact:true}).waitFor();
     await page.getByText("Name: Demo browser person",{exact:true}).waitFor();
     await page.close();
    }
    const worker=await browser.newPage();await login(worker,baseUrl,credentials.worker,"worker");
    await worker.goto(baseUrl+"/admin/contact");
    await worker.waitForURL(baseUrl+"/access-denied");
    await worker.getByRole("heading",{level:1}).waitFor();
    assert.equal(await worker.getByRole("heading",{name:"Contact & demo requests",exact:true}).count(),0);
    await publicPage.goto(baseUrl+"/admin/contact");
    await publicPage.waitForURL("**/admin/login**");
    await publicPage.getByLabel("Email address",{exact:true}).waitFor();
    assert.equal(await publicPage.getByText("Name: Contact browser person",{exact:true}).count(),0);
   }finally{await browser.close();}
  }});assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
  const db=new PGlite(databaseDirectory);try{
   const rows=(await db.query("SELECT kind,email,message FROM public_inquiries ORDER BY kind")).rows;
   assert.equal((await db.query("SELECT count(*)::int n FROM public_verification_concerns WHERE contact_email=$1",["concern-browser@example.test"])).rows[0].n,1);
   assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.kind),["contact","demo"]);
   assert.equal((await db.query("SELECT count(*)::int n FROM platform_audit_events WHERE action_key='public_inquiry.received'")).rows[0].n,2);
  }finally{await db.close();}
 }finally{await rm(databaseDirectory,{recursive:true,force:true});}
});
