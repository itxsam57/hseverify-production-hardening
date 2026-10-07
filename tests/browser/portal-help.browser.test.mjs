import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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


test("All six role account menus reach support at desktop and mobile widths without ending the session", {timeout:180000}, async()=>{
 const directory=await mkdtemp(join(tmpdir(),"hse-header-help-")), port=await freePort(), baseUrl="http://127.0.0.1:"+port;
 const environment={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:join(directory,"db"),HSE_RELEASE_SHA:"portal-help-contract",HSE_SESSION_SECRET:"header-browser-session-secret-more-than-thirty-two",HSE_AUTH_PEPPER:"header-browser-auth-pepper-more-than-thirty-two",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false",HSE_AUDIT_CREDENTIALS_PATH:join(directory,"credentials.json")};
 try {
  for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){const r=spawnSync(process.execPath,[script],{cwd:process.cwd(),env:environment,encoding:"utf8"});assert.equal(r.status,0,r.stderr||r.stdout);}
  const credentials=JSON.parse(await readFile(environment.HSE_AUDIT_CREDENTIALS_PATH,"utf8"));
  const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try {for(const role of ["worker","company","assessor","verifier","admin","root"]){
    const context=await browser.newContext();
    try {const page=await context.newPage();await login(page,baseUrl,credentials[role],role);
     for(const width of [1440,390]){
      await page.setViewportSize({width,height:1000});
      await page.goto(baseUrl+"/"+role+"/dashboard",{waitUntil:"domcontentloaded"});
      const header=page.locator("header.portal-header");await header.locator(".profile-menu > summary").click();
      const help=header.getByRole("link",{name:"Help and support",exact:true});
      assert.equal(await help.count(),1,role+" support entry missing");
      assert.equal(await help.getAttribute("href"),"/contact");
      const box=await help.boundingBox();assert.ok(box && box.x>=0 && box.x+box.width<=width && box.height>=40);
      await help.focus();await page.keyboard.press("Enter");
      await page.waitForURL("**/contact");
      await page.getByRole("heading",{name:"Contact HSE Verify",exact:true}).waitFor();
      await page.getByLabel("How can we help?",{exact:true}).waitFor();
      assert.equal(await page.getByRole("button",{name:"Send message",exact:true}).count(),1);
      await page.goto(baseUrl+"/"+role+"/dashboard",{waitUntil:"domcontentloaded"});
      assert.equal(new URL(page.url()).pathname,"/"+role+"/dashboard","support navigation must preserve portal session");
     }
    }finally{await context.close();}
   }}finally{await browser.close();}
  }});assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
 }finally{await rm(directory,{recursive:true,force:true});}
});
