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

import {appealInterviewFixture} from "../helpers/appeal-interview-fixture.mjs";
for (const historyFallback of [false,true]) test("Unsaved evidence metadata is protected through navigation; history fallback="+historyFallback,{timeout:120000},async()=>{
 const f=await appealInterviewFixture();let browser;
 try{
  await f.releaseDatabase();const port=await freePort(),baseUrl="http://127.0.0.1:"+port;
  browser=await chromium.launch({headless:true});const context=await browser.newContext();
  if(historyFallback)await context.addInitScript(()=>Object.defineProperty(window,"navigation",{value:undefined,configurable:true}));
  const page=await context.newPage();
  let dialogs=0,acceptLeave=false;page.on("dialog",async dialog=>{dialogs++;if(acceptLeave)await dialog.accept();else await dialog.dismiss();});
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",environment:{...f.environment,HSE_CREDENTIAL_SIGNING_SECRET:f.key},projectRoot:process.cwd(),probe:async()=>{
   await login(page,baseUrl,f.credentials.worker,"worker");await page.goto(baseUrl+"/worker/evidence");
   await page.getByLabel("Record type").selectOption("qualification");
   await Promise.all([page.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/worker/evidence")).then(r=>r.finished()),page.getByRole("button",{name:"Create draft",exact:true}).click()]);
   await page.reload({waitUntil:"domcontentloaded"});const article=page.locator("article").filter({hasText:"Qualification record"}).first();
   const title=article.getByLabel("Qualification title",{exact:true});await title.fill("Unsaved protected qualification");
   await page.getByRole("link",{name:"Dashboard",exact:true}).first().click();
   await page.waitForTimeout(350);
   if(new URL(page.url()).pathname!=="/worker/evidence")await page.goto(baseUrl+"/worker/evidence");
   const retained=await page.locator("article").filter({hasText:"Qualification record"}).first().getByLabel("Qualification title",{exact:true}).inputValue();
   assert.ok(dialogs>0||retained==="Unsaved protected qualification","Visible navigation discarded unsaved metadata without warning or recovery");
   assert.equal(retained,"Unsaved protected qualification");
   assert.equal(dialogs,1,"Cancel must prompt once and keep the current values");
   await page.goBack({waitUntil:"domcontentloaded",timeout:5000}).catch(()=>null);
   assert.equal(new URL(page.url()).pathname,"/worker/evidence","Canceled browser Back preserves route");
   assert.equal(await title.inputValue(),"Unsaved protected qualification");
   assert.equal(dialogs,2,"Browser history traversal also prompts once");
   await title.fill("");
   await page.getByRole("link",{name:"Dashboard",exact:true}).first().click();
   await page.waitForURL("**/worker/dashboard");assert.equal(dialogs,2,"Reverted form is clean");
   await page.goto(baseUrl+"/worker/evidence");
   const savedTitle=page.locator("article").filter({hasText:"Qualification record"}).first().getByLabel("Qualification title",{exact:true});
   await savedTitle.fill("Saved qualification title");
   await Promise.all([page.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/worker/evidence")).then(r=>r.finished()),page.locator("article").filter({hasText:"Qualification record"}).first().getByRole("button",{name:"Save metadata",exact:true}).click()]);
   await page.getByRole("link",{name:"Dashboard",exact:true}).first().click();
   await page.waitForURL("**/worker/dashboard");assert.equal(dialogs,2,"Accepted save clears dirty state");
   await page.goto(baseUrl+"/worker/evidence");
   assert.equal(await page.locator("article").filter({hasText:"Qualification record"}).first().getByLabel("Qualification title",{exact:true}).inputValue(),"Saved qualification title");
   const invalid=page.locator("article").filter({hasText:"Qualification record"}).first();
   await invalid.getByLabel("Qualification title",{exact:true}).fill("Retain invalid draft");
   await invalid.getByLabel("Verification URL",{exact:false}).fill("not-a-valid-url");
   await Promise.all([page.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/worker/evidence")).then(r=>r.finished()),invalid.getByRole("button",{name:"Save metadata",exact:true}).click()]);
   assert.equal(await invalid.getByLabel("Qualification title",{exact:true}).inputValue(),"Retain invalid draft","Rejected metadata must retain user input");
   await page.getByRole("link",{name:"Dashboard",exact:true}).first().click();
   assert.equal(new URL(page.url()).pathname,"/worker/evidence");assert.equal(dialogs,3,"Rejected save remains dirty and protected");
   await invalid.getByLabel("Verification URL",{exact:false}).fill("");
   await Promise.all([page.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/worker/evidence")).then(r=>r.finished()),invalid.getByRole("button",{name:"Save metadata",exact:true}).click()]);
   let releaseResponse,serverAccepted;
   const hold=new Promise(resolve=>releaseResponse=resolve),accepted=new Promise(resolve=>serverAccepted=resolve);
   const delayAction=async route=>{if(route.request().method()!=="POST")return route.continue();const response=await route.fetch();serverAccepted();await hold;await route.fulfill({response});};
   await page.route("**/worker/evidence",delayAction);
   await invalid.getByLabel("Qualification title",{exact:true}).fill("Saved request snapshot");
   await invalid.getByRole("button",{name:"Save metadata",exact:true}).click();await accepted;
   const finished=page.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/worker/evidence")).then(r=>r.finished());
   try{await invalid.getByLabel("Qualification title",{exact:true}).fill("Edited while save pending");}finally{releaseResponse();}
   await finished;await page.unroute("**/worker/evidence",delayAction);
   assert.equal(await invalid.getByLabel("Qualification title",{exact:true}).inputValue(),"Edited while save pending");
   await page.getByRole("link",{name:"Dashboard",exact:true}).first().click();
   assert.equal(new URL(page.url()).pathname,"/worker/evidence");assert.equal(dialogs,4,"Later edits remain unsaved after older save completes");
   await page.locator("article").filter({hasText:"Qualification record"}).first().getByLabel("Qualification title",{exact:true}).fill("Intentional discard");
   acceptLeave=true;
   await page.getByRole("link",{name:"Dashboard",exact:true}).first().click();
   await page.waitForURL("**/worker/dashboard");assert.equal(dialogs,5,"Accepted leave prompts once");


  }});
 }finally{await browser?.close();await f.cleanup();}
});
