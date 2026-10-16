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





import { interviewAccommodationFixture } from "../helpers/interview-accommodation-fixture.mjs";
test("both browser roles deliver human captions and interpretation with escaped text and scoped API denies",{timeout:180000},async()=>{
 const c=await interviewAccommodationFixture({seed:"browserhuman"}),port=await freePort(),baseUrl="http://127.0.0.1:"+port,browser=await chromium.launch({headless:true}),id=c.request.interviewRequestId,endpoint="/api/interviews/"+id+"/accommodation-support",errors=[];
 let closed=false;
 try{
  await c.database.close();closed=true;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment:{...c.fixture.environment,HSE_RUNTIME_PROJECT_ROOT:c.fixture.directory},probe:async()=>{
   const wc=await browser.newContext({viewport:{width:390,height:844}}),ac=await browser.newContext(),worker=await wc.newPage(),assessor=await ac.newPage();
   worker.on("pageerror",error=>errors.push(error.message));assessor.on("pageerror",error=>errors.push(error.message));
   await login(worker,baseUrl,c.fixture.credentials.worker,"worker");await login(assessor,baseUrl,c.fixture.credentials.assessor,"assessor");
   await worker.goto(baseUrl+"/worker/interviews/"+id,{waitUntil:"domcontentloaded"});
   await assessor.goto(baseUrl+"/assessor/interviews/"+id,{waitUntil:"domcontentloaded"});
   const ap=assessor.getByRole("region",{name:"Approved human interview support"}),wp=worker.getByRole("region",{name:"Approved human interview support"});
   await ap.getByLabel("Spoken text (English)",{exact:true}).waitFor();
   assert.equal(await wp.getByRole("button",{name:"Publish human support",exact:true}).count(),0);
   const caption='<img src=x onerror="window.__supportXss=1"> Isolate the supply.';
   await worker.evaluate(()=>{window.__supportXss=0;});
   await ap.getByLabel("Spoken text (English)",{exact:true}).fill(caption);
   const published=assessor.waitForResponse(response=>response.url()===baseUrl+endpoint&&response.request().method()==="POST");
   await ap.getByRole("button",{name:"Publish human support",exact:true}).click();
   const publication=await published;assert.equal(publication.status(),201,await publication.text());
   await wp.getByText(caption,{exact:true}).waitFor();
   assert.equal(await wp.locator("img").count(),0);assert.equal(await worker.evaluate(()=>window.__supportXss),0);
   await ap.getByLabel("Support type",{exact:true}).selectOption("INTERPRETATION");
   await ap.getByLabel("Spoken text (English)",{exact:true}).fill("Verify isolation.");
   await ap.getByLabel("Interpretation (Spanish)",{exact:true}).fill("Compruebe el aislamiento.");
   await ap.getByRole("button",{name:"Publish human support",exact:true}).click();
   await wp.getByText("Compruebe el aislamiento.",{exact:true}).waitFor();
   await worker.reload({waitUntil:"domcontentloaded"});
   await worker.getByRole("region",{name:"Approved human interview support"}).getByText("Compruebe el aislamiento.",{exact:true}).waitFor();
   const denied=await worker.evaluate(async({url,input})=>{const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});return {status:response.status,body:await response.json()};},{url:endpoint,input:{kind:"CAPTION",sourceText:"Worker cannot impersonate the assigned human.",mutationKey:"browser_worker_forgery_0001"}});
   assert.equal(denied.status,403);
   const foreign=await ac.request.get(baseUrl+"/api/interviews/"+c.fixture.requests.ForeignAlpha.interviewRequestId+"/accommodation-support");assert.equal(foreign.status(),403);
   const csrf=await ac.request.post(baseUrl+endpoint,{headers:{origin:"https://foreign.invalid"},data:{kind:"CAPTION",sourceText:"Cross origin blocked.",mutationKey:"browser_cross_origin_0001"}});assert.equal(csrf.status(),403);
   const missingOrigin=await ac.request.post(baseUrl+endpoint,{data:{kind:"CAPTION",sourceText:"Missing origin blocked.",mutationKey:"browser_missing_origin_0001"}});assert.equal(missingOrigin.status(),403);
   const wrongHost=await ac.request.post(baseUrl+endpoint,{headers:{origin:baseUrl,host:"foreign.invalid"},data:{kind:"CAPTION",sourceText:"Mismatched Host blocked.",mutationKey:"browser_wrong_host_0001"}});assert.equal(wrongHost.status(),403);
   const forgedProxy=await ac.request.post(baseUrl+endpoint,{headers:{origin:"https://foreign.invalid","x-forwarded-host":"foreign.invalid","x-forwarded-proto":"https"},data:{kind:"CAPTION",sourceText:"Forged forwarded host blocked.",mutationKey:"browser_forged_proxy_0001"}});assert.equal(forgedProxy.status(),403);
   const oversized=await ac.request.post(baseUrl+endpoint,{headers:{origin:baseUrl},data:{kind:"CAPTION",sourceText:"x".repeat(17000),mutationKey:"browser_oversized_text_0001"}});assert.equal(oversized.status(),413);
   const extra=await ac.request.post(baseUrl+endpoint,{headers:{origin:baseUrl},data:{kind:"CAPTION",sourceText:"Typed scope blocks this.",mutationKey:"browser_extra_field_0001",workerId:"foreign"}});assert.equal(extra.status(),400);
   const anon=await browser.newContext(),unauth=await anon.request.get(baseUrl+endpoint);assert.equal(unauth.status(),401);assert.match(unauth.headers()["cache-control"],/no-store/);await anon.close();
   await worker.getByRole("region",{name:"Approved human interview support"}).screenshot({path:".autopilot/artifacts/human-support-worker-browser.png"});
   await ap.screenshot({path:".autopilot/artifacts/human-support-assessor-browser.png"});
   assert.equal(errors.length,0,errors.join("\n"));
   await wc.close();await ac.close();
  }});
  const db=await PGlite.create(c.fixture.environment.HSE_PGLITE_DATA_DIR);
  try{assert.equal((await db.query("SELECT count(*)::int AS n FROM interview_accommodation_support_messages WHERE interview_session_id=$1",[c.session.interviewSessionId])).rows[0].n,2);}finally{await db.close();}
  console.log("ACTUAL_HUMAN_SUPPORT_BROWSER assigned Assessor typed caption/Spanish interpretation -> same Worker -> reload; plaintext escaped; Worker/unassigned/cross-origin/oversized/extra-field/anonymous denied; no automatic provider claim.");
 }finally{await browser.close();if(!closed)await c.database.close();await c.fixture.cleanup();}
});
test("approved support without exact active human language capability is honestly unavailable in the Worker browser",{timeout:120000},async()=>{
 const c=await interviewAccommodationFixture({seed:"browserunavailable",languages:["*"]}),port=await freePort(),baseUrl="http://127.0.0.1:"+port,browser=await chromium.launch({headless:true});
 let closed=false;
 try{
  await c.database.close();closed=true;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment:{...c.fixture.environment,HSE_RUNTIME_PROJECT_ROOT:c.fixture.directory},probe:async()=>{
   const page=await browser.newPage();await login(page,baseUrl,c.fixture.credentials.worker,"worker");
   await page.goto(baseUrl+"/worker/interviews/"+c.request.interviewRequestId,{waitUntil:"domcontentloaded"});
   const panel=page.getByRole("region",{name:"Approved human interview support"});
   await panel.getByText("The assigned Assessor has no active exact language capability for this approved support.",{exact:true}).waitFor();
   assert.equal(await panel.getByRole("button",{name:"Publish human support",exact:true}).count(),0);
   assert.equal(await panel.getByRole("listitem").count(),0);
  }});
 }finally{await browser.close();if(!closed)await c.database.close();await c.fixture.cleanup();}
});


test("ended runtime unmounts human support in both existing role pages without stale polling",{timeout:180000},async()=>{
 const c=await interviewAccommodationFixture({seed:"ended-tab"}),port=await freePort(),baseUrl="http://127.0.0.1:"+port,browser=await chromium.launch({headless:true});
 let closed=false;
 try{
  await c.save(c.scores());
  await c.runtime.end(c.assessor,c.request.interviewRequestId,new Date(c.now.getTime()+600000));
  await c.database.close();closed=true;
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment:{...c.fixture.environment,HSE_RUNTIME_PROJECT_ROOT:c.fixture.directory},probe:async()=>{
   for(const role of ["assessor","worker"]){
    const context=await browser.newContext(),page=await context.newPage(),errors=[],supportRequests=[];
    page.on("pageerror",error=>errors.push(error.message));
    page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
    page.on("request",request=>{if(request.url().includes("/accommodation-support"))supportRequests.push(request.url());});
    await login(page,baseUrl,c.fixture.credentials[role],role);
    const response=await page.goto(baseUrl+"/"+role+"/interviews/"+c.request.interviewRequestId,{waitUntil:"networkidle"});
    assert.equal(response.status(),200);
    assert.equal(await page.getByRole("region",{name:"Approved human interview support"}).count(),0,"ended role page must unmount active human support");
    await page.waitForTimeout(4500);
    assert.deepEqual(supportRequests,[],"ended role page must make no stale support polls");
    assert.deepEqual(errors,[],"terminal lifecycle must preserve strict clean browser console");
    await context.close();
   }
  }});
  console.log("ACTUAL_ENDED_SUPPORT_BROWSER existing terminal media prop -> panel unmounted -> both roles zero support GETs and strict clean console.");
 }finally{await browser.close();if(!closed)await c.database.close();await c.fixture.cleanup();}
});
