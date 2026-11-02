import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { assessmentEligibilityTradeFixture } from "../helpers/assessment-eligibility-trade-fixture.mjs";
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




test("Configured explicit trade gates Worker and Company until original Verifier confirmation, then self-payment pins and starts the exact case", {timeout:180000},async()=>{
 const fixture=await assessmentEligibilityTradeFixture(),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const browser=await chromium.launch({headless:true}),workerContext=await browser.newContext({viewport:{width:390,height:844}}),
  companyContext=await browser.newContext({viewport:{width:1440,height:1000}}),verifierContext=await browser.newContext({viewport:{width:1440,height:1000}});
 const workerPage=await workerContext.newPage(),companyPage=await companyContext.newPage(),verifierPage=await verifierContext.newPage(),errors=[];
 for(const page of [workerPage,companyPage,verifierPage]){
  page.on("pageerror",error=>errors.push(error.message));
  page.on("response",response=>{if(response.status()>=500)errors.push(response.status()+" "+new URL(response.url()).pathname);});
 }
 let caseId;
 try{
  const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",
   projectRoot:process.cwd(),environment:fixture.environment,probe:async()=>{
    await login(workerPage,baseUrl,fixture.credentials.worker,"worker");
    await workerPage.goto(baseUrl+"/worker/assessment-applications",{waitUntil:"domcontentloaded"});
    const offering=()=>workerPage.locator("article.panel").filter({has:workerPage.getByRole("heading",{name:"Verified electrical trade assessment",exact:true})}).first();
    assert.match(await offering().innerText(),/verified trade/i);
    assert.equal(await offering().getByRole("button",{name:"Apply — worker pays",exact:true}).isDisabled(),true);
    await offering().getByRole("button",{name:"Apply — worker pays",exact:true}).evaluate(button=>button.disabled=false);
    await offering().getByRole("button",{name:"Apply — worker pays",exact:true}).click();
    await workerPage.waitForURL(url=>url.searchParams.has("error"));
    assert.match(await workerPage.getByRole("alert").filter({hasText:"verified trade"}).innerText(),/trade/i);
    await workerPage.screenshot({path:".autopilot/artifacts/20261010-eligibility-trade-worker.png"});
    await login(companyPage,baseUrl,fixture.credentials.company,"company");
    await companyPage.goto(baseUrl+"/company/assurance-orders/"+fixture.draft.orderId,{waitUntil:"domcontentloaded"});
    await companyPage.getByRole("button",{name:"Submit Order",exact:true}).click();
    await companyPage.getByRole("alert").filter({hasText:"verified trade"}).waitFor();
    await login(verifierPage,baseUrl,fixture.credentials.verifier,"verifier");
    await verifierPage.goto(baseUrl+"/verifier/reviews/"+fixture.tradeTaskId,{waitUntil:"domcontentloaded"});
    await verifierPage.getByRole("button",{name:"Claim review",exact:true}).click();
    await verifierPage.getByRole("combobox",{name:/Decision/}).waitFor();
    const metadata=verifierPage.getByRole("region",{name:"Submitted skill metadata"});
    assert.match(await metadata.innerText(),/Isolation safety/);
    assert.match(await metadata.innerText(),/Electrical/);
    assert.match(await metadata.innerText(),/self_declared/);
    await verifierPage.getByLabel("I verified this submitted trade mapping against the attached evidence.",{exact:true}).check();
    await verifierPage.getByRole("combobox",{name:/Decision/}).selectOption("APPROVED");
    await verifierPage.getByLabel("Reason",{exact:true}).fill("Exact Electrical trade mapping was verified against the attached skill evidence.");
    await verifierPage.getByRole("button",{name:"Finalize review",exact:true}).click();
    await verifierPage.getByRole("button",{name:"Finalize review",exact:true}).waitFor({state:"detached"});
    await workerPage.goto(baseUrl+"/worker/assessment-applications",{waitUntil:"domcontentloaded"});
    assert.equal(await offering().getByRole("button",{name:"Apply — worker pays",exact:true}).isDisabled(),false);
    await offering().getByRole("button",{name:"Apply — worker pays",exact:true}).click();
    await workerPage.waitForURL(url=>url.searchParams.get("status")==="payment-required");
    await workerPage.getByRole("button",{name:"Confirm sandbox payment",exact:true}).click();
    await workerPage.waitForURL(url=>url.searchParams.get("status")==="case-created");
    const application=workerPage.locator("article.panel").filter({has:workerPage.getByRole("heading",{name:"Verified electrical trade assessment",exact:true})}).filter({hasText:"Assurance case:"}).first();
    caseId=(await application.innerText()).match(/assurance_case_[A-Za-z0-9_-]{24}/)?.[0];
    assert.ok(caseId);
    await workerPage.goto(baseUrl+"/worker/available-assessments",{waitUntil:"domcontentloaded"});
    const available=workerPage.locator("article[id="+caseId+"]").filter({has:workerPage.getByRole("heading",{name:"Verified electrical trade assessment",exact:true})}).first();
    await available.getByRole("button",{name:"Start assessment",exact:true}).click();
    await workerPage.waitForURL(url=>url.pathname==="/worker/available-assessments/precheck"&&url.searchParams.get("caseId")===caseId);
    assert.deepEqual(errors,[]);
    console.log("ACTUAL_ELIGIBILITY_TRADE_BROWSER configured explicit trade->forged Worker submit and Company submit denied->original assigned Verifier metadata/explicit confirmation->Worker apply/confirm->exact case pinned precheck.");
   }});
  assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
  const database=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   assert.equal((await database.query("SELECT order_status FROM assurance_orders WHERE order_id=$1",[fixture.draft.orderId])).rows[0].order_status,"READY");
   const snapshot=(await database.query("SELECT effective_value_json FROM assurance_case_policy_snapshots WHERE case_id=$1",[caseId])).rows[0];
   assert.deepEqual(snapshot.effective_value_json.assessmentEligibility,{verifiedTrades:["Electrical"]});
   assert.equal((await database.query("SELECT task_status FROM evidence_review_tasks WHERE task_id=$1",[fixture.tradeTaskId])).rows[0].task_status,"APPROVED");
  }finally{await database.close();}
 }finally{await browser.close();await fixture.cleanup();}
});
