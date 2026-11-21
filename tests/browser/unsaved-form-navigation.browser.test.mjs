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
   await page.getByRole("button",{name:"Create draft",exact:true}).click();
   await page.getByText("Qualification draft created.",{exact:true}).waitFor({timeout:20000});
   await page.reload({waitUntil:"domcontentloaded"});const article=page.locator("article").filter({hasText:"Qualification record"}).first();
   const title=article.getByLabel("Qualification title",{exact:true});await title.fill("Unsaved protected qualification");
   await page.setViewportSize({width:320,height:740});
   await title.focus();
   assert(await title.evaluate(node=>document.activeElement===node),"The labeled draft input must accept keyboard focus at 320px");
   await page.keyboard.press("Tab");
   const focus=await page.evaluate(()=>{
     const node=document.activeElement,style=getComputedStyle(node);
     return {tag:node?.tagName,outline:style.outlineStyle,shadow:style.boxShadow};
   });
   assert(["INPUT","TEXTAREA","SELECT","BUTTON","A"].includes(focus.tag),
     "Keyboard Tab must move to an interactive control: "+JSON.stringify(focus));
   assert(focus.outline!=="none"||focus.shadow!=="none",
     "Keyboard Tab target must have visible focus: "+JSON.stringify(focus));
   const mobileNav=page.locator("details.mobile-nav-menu");
   await mobileNav.locator("summary").first().click();
   await mobileNav.locator(".mobile-nav-panel").getByRole("link",{name:"Dashboard",exact:true}).first().click();
   await page.waitForTimeout(350);
   if(new URL(page.url()).pathname!=="/worker/evidence")await page.goto(baseUrl+"/worker/evidence");
   const retained=await page.locator("article").filter({hasText:"Qualification record"}).first().getByLabel("Qualification title",{exact:true}).inputValue();
   assert.ok(dialogs>0||retained==="Unsaved protected qualification","Visible navigation discarded unsaved metadata without warning or recovery");
   assert.equal(retained,"Unsaved protected qualification");
   assert.equal(dialogs,1,"Cancel must prompt once and keep the current values");
   await page.setViewportSize({width:390,height:844});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,
     "Rejected navigation must preserve a usable 390px evidence form");
   await page.goBack({waitUntil:"domcontentloaded",timeout:5000}).catch(()=>null);
   assert.equal(new URL(page.url()).pathname,"/worker/evidence","Canceled browser Back preserves route");
   assert.equal(await title.inputValue(),"Unsaved protected qualification");
   assert.equal(dialogs,2,"Browser history traversal also prompts once");
   await page.setViewportSize({width:1365,height:900});
   await title.fill("");
   await page.getByRole("link",{name:"Dashboard",exact:true}).first().click();
   await page.waitForURL("**/worker/dashboard");assert.equal(dialogs,2,"Reverted form is clean");
   await page.goto(baseUrl+"/worker/evidence");
   const savedTitle=page.locator("article").filter({hasText:"Qualification record"}).first().getByLabel("Qualification title",{exact:true});
   await savedTitle.fill("Saved qualification title");
   await page.locator("article").filter({hasText:"Qualification record"}).first().getByRole("button",{name:"Save metadata",exact:true}).click();
   await page.getByText("Draft metadata saved with its current version.",{exact:true}).waitFor({timeout:20000});
   await page.getByRole("link",{name:"Dashboard",exact:true}).first().click();
   await page.waitForURL("**/worker/dashboard");assert.equal(dialogs,2,"Accepted save clears dirty state");
   await page.goto(baseUrl+"/worker/evidence");
   assert.equal(await page.locator("article").filter({hasText:"Qualification record"}).first().getByLabel("Qualification title",{exact:true}).inputValue(),"Saved qualification title");
   const invalid=page.locator("article").filter({hasText:"Qualification record"}).first();
   await invalid.getByLabel("Qualification title",{exact:true}).fill("Retain invalid draft");
   const invalidUrl=invalid.getByLabel("Verification URL",{exact:false});
   await invalidUrl.fill("not-a-valid-url");
   assert.equal(await invalidUrl.evaluate(input=>input.validity.valid),false,"Malformed verification URL must remain visibly invalid even though server validation is authoritative");
   const [invalidResponse]=await Promise.all([
    page.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/worker/evidence")),
    invalid.getByRole("button",{name:"Save metadata",exact:true}).click()
   ]);
   assert.ok(invalidResponse.status()<500,"Invalid metadata must return a handled Server Action response");
   await invalid.getByText("Verification URL must use HTTP or HTTPS.",{exact:true}).waitFor({timeout:10_000});
   assert.equal(await invalid.getByLabel("Qualification title",{exact:true}).inputValue(),"Retain invalid draft","Rejected metadata must retain user input");
   await page.getByRole("link",{name:"Dashboard",exact:true}).first().click();
   assert.equal(new URL(page.url()).pathname,"/worker/evidence");assert.equal(dialogs,3,"Rejected save remains dirty and protected");
   await invalid.getByLabel("Verification URL",{exact:false}).fill("");
   await invalid.getByRole("button",{name:"Save metadata",exact:true}).click();
   await invalid.getByText("Draft metadata saved with its current version.",{exact:true}).waitFor({timeout:20000});
   // Delay only delivery to React after the real server has accepted the POST.
   // Playwright route.fetch() of a Next Server Action can hang or abort a live
   // action request; patching client fetch leaves the network transport intact.
   await page.evaluate(() => {
     const nativeFetch = window.fetch.bind(window);
     let release;
     const gate = new Promise(resolve => { release = resolve; });
     window.__hseEvidenceHold = { accepted: false, release: () => release() };
     window.fetch = async (...args) => {
       const request = args[0];
       const method = (args[1]?.method ?? (request instanceof Request ? request.method : "GET")).toUpperCase();
       const url = new URL(typeof request === "string" ? request : request.url, location.href);
       if (method !== "POST" || url.pathname !== "/worker/evidence") return nativeFetch(...args);
       const response = await nativeFetch(...args);
       window.__hseEvidenceHold.accepted = true;
       await gate;
       return response;
     };
   });
   await invalid.getByLabel("Qualification title",{exact:true}).fill("Saved request snapshot");
   await invalid.getByRole("button",{name:"Save metadata",exact:true}).click();
   try {
     await page.waitForFunction(() => window.__hseEvidenceHold?.accepted === true,null,{timeout:20000});
     await invalid.getByLabel("Qualification title",{exact:true}).fill("Edited while save pending");
   } finally {
     await page.evaluate(() => window.__hseEvidenceHold?.release());
   }
   await invalid.getByText("Draft metadata saved with its current version.",{exact:true}).waitFor({timeout:20000});
   assert.equal(await invalid.getByLabel("Qualification title",{exact:true}).inputValue(),"Edited while save pending");
   await page.getByRole("link",{name:"Dashboard",exact:true}).first().click();
   assert.equal(new URL(page.url()).pathname,"/worker/evidence");assert.equal(dialogs,4,"Later edits remain unsaved after older save completes");
   await page.locator("article").filter({hasText:"Qualification record"}).first().getByLabel("Qualification title",{exact:true}).fill("Intentional discard");
   acceptLeave=true;
   await page.getByRole("link",{name:"Dashboard",exact:true}).first().click();
   await page.waitForURL("**/worker/dashboard");assert.equal(dialogs,5,"Accepted leave prompts once");
   await page.goto(baseUrl+"/worker/evidence");
   assert.equal(
     await page.locator("article").filter({hasText:"Qualification record"}).first().getByLabel("Qualification title",{exact:true}).inputValue(),
     "Saved request snapshot",
     "The delayed save must persist its submitted snapshot, not the later edit or discarded value"
   );

   // M10205_NONWORKER_UNSAVED_DRAFT: the established Worker/browser-history
   // cases above already passed. Reuse their live authenticated Next fixture
   // only once (normal navigation mode) to verify distinct Company and Admin
   // forms; no extra server/database, test ID, or historical green count.
   if (!historyFallback) {
     const nonWorkerForms = [
       { role: "company", route: "/company/organization", selector: "#unit-name" },
       { role: "admin", route: "/admin/frameworks", selector: 'form input[name="reference"]' }
     ];
     for (const { role, route, selector } of nonWorkerForms) {
       const roleContext = await browser.newContext({ viewport: { width: 320, height: 844 } });
       const rolePage = await roleContext.newPage();
       let prompted = 0;
       let discard = false;
       rolePage.on("dialog", async dialog => {
         prompted++;
         if (discard) await dialog.accept();
         else await dialog.dismiss();
       });
       try {
         await login(rolePage, baseUrl, f.credentials[role], role);
         await rolePage.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
         const field = rolePage.locator(selector).first();
         await field.waitFor({ state: "visible", timeout: 15_000 });
         assert.equal(await field.isEditable(), true, `${role} expected editable labeled form`);
         const initialValue = await field.inputValue();
         const draft = `Uncommitted ${role} draft for M1.02.05`;
         await field.fill(draft);
         await field.focus();
         assert.equal(await field.evaluate(node => document.activeElement === node), true,
           `${role} editable input must be keyboard-focusable at 320px`);
         await rolePage.keyboard.press("Tab");
         const focus = await rolePage.evaluate(() => {
           const element = document.activeElement;
           const style = element && getComputedStyle(element);
           return { tag: element?.tagName, outline: style?.outlineStyle, shadow: style?.boxShadow };
         });
         assert(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(focus.tag),
           `${role} keyboard Tab must reach an interactive control: ${JSON.stringify(focus)}`);
         assert(focus.outline !== "none" || (focus.shadow && focus.shadow !== "none"),
           `${role} focused control must show keyboard focus: ${JSON.stringify(focus)}`);
         const nav = rolePage.locator("details.mobile-nav-menu");
         await nav.locator("summary").click();
         const dashboard = nav.locator(".mobile-nav-panel").getByRole("link", { name: "Dashboard", exact: true }).first();
         await dashboard.click();
         await rolePage.waitForTimeout(200);
         assert.equal(new URL(rolePage.url()).pathname, route,
           `${role} rejected navigation must not discard unsaved form`);
         assert.equal(await field.inputValue(), draft, `${role} canceled leave must preserve exact draft`);
         assert.equal(prompted, 1, `${role} canceled navigation should prompt exactly once`);
         discard = true;
         await dashboard.click();
         await rolePage.waitForURL(`**/${role}/dashboard`, { timeout: 15_000 });
         assert.equal(prompted, 2, `${role} intentional discard must prompt exactly once`);
         await rolePage.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
         const reopened = rolePage.locator(selector).first();
         await reopened.waitFor({ state: "visible", timeout: 15_000 });
         assert.equal(await reopened.inputValue(), initialValue,
           `${role} discarded draft must never persist in the database or reopened form`);
         assert.equal(await rolePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true,
           `${role} focused/navigated form must not overflow 320px`);
       } finally {
         await roleContext.close();
       }
     }
   }

  }});
 }finally{await browser?.close();await f.cleanup();}
});
