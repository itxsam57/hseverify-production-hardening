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


test("Verifier scoring drafts retain exact reason text across cold hydration and reload",{timeout:180000},async()=>{
 const f=await integrityAssessmentFixture({written:true});
 try{
  await f.attempts.submitCurrentAnswer(f.worker,{attemptId:f.attemptId,position:1,answer:"Isolate and verify zero energy before work."},new Date(),null);
  await f.releaseDatabase();
  const port=await freePort(),baseUrl="http://127.0.0.1:"+port;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/verifier/login",projectRoot:process.cwd(),environment:f.environment,probe:async({output})=>{
   const browser=await chromium.launch({headless:true});
   try{
    const page=await browser.newPage();await login(page,baseUrl,f.credentials.verifier,"verifier");
    await page.goto(baseUrl+"/verifier/reviews/scoring",{waitUntil:"domcontentloaded"});
    const mark=page.getByRole("form",{name:"Rubric mark Q1:C0"});
    const markReason="Exact criterion reason retained independently of defaults.";
    await mark.getByLabel("Criterion mark").fill("80");await mark.getByLabel("Mark reason").fill(markReason);
    await mark.getByRole("button",{name:"Save mark",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('input[name="expectedRevision"]')?.value==="1");
    await page.reload({waitUntil:"domcontentloaded"});
    assert.equal(await mark.getByLabel("Criterion mark").inputValue(),"80");
    assert.equal(await mark.getByLabel("Mark reason").inputValue(),markReason);
    const select=page.locator('select[name="decision"]');const form=select.locator("xpath=ancestor::form");
    const reason="Exact replacement scoring reason without prior default text.";
    await select.selectOption("PASS");await form.locator('textarea[name="reason"]').fill(reason);
    await form.getByRole("button",{name:"Save scoring decision",exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('input[name="expectedRevision"]')?.value==="2");
    await page.reload({waitUntil:"domcontentloaded"});
    assert.equal(await select.inputValue(),"PASS");assert.equal(await form.locator('textarea[name="reason"]').inputValue(),reason);
    console.log("SCORING_DRAFT_EXACT_BROWSER mark and both reason strings survived cold document reloads without appended defaults");
   }catch(error){console.error(output());throw error;}finally{await browser.close();}
  }});
 }finally{await f.cleanup();}
});
