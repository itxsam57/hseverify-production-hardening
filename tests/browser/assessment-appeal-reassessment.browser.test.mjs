import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { assessmentAppealReassessmentFixture } from "../helpers/assessment-appeal-reassessment-fixture.mjs";
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





test("Owned accepted reassessment carries its explicit appeal through Worker self-payment to the exact original-scope fresh case", {timeout:180000},async()=>{
 const fixture=await assessmentAppealReassessmentFixture(),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
 page.on("pageerror",e=>errors.push(e.message));page.on("response",r=>{if(r.status()>=500)errors.push(r.status()+" "+new URL(r.url()).pathname);});
 try{
  const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/worker/login",projectRoot:process.cwd(),environment:fixture.environment,probe:async()=>{
   await login(page,baseUrl,fixture.credentials.worker,"worker");
   await page.goto(baseUrl+"/worker/appeals",{waitUntil:"domcontentloaded"});
   const article=page.locator("article.panel").filter({hasText:fixture.appeal.credentialId}).first();
   await article.getByRole("link",{name:"Continue reassessment",exact:true}).click({timeout:5000});
   await page.waitForURL(url=>url.pathname==="/worker/assessment-applications"&&url.searchParams.get("sourceAppealId")===fixture.appeal.appealId);
   const offering=page.locator("article.panel").filter({has:page.getByRole("heading",{name:"Funded safety assessment",exact:true})}).first();
   assert.equal(await offering.locator('input[name="sourceAppealId"]').inputValue(),fixture.appeal.appealId);
   await offering.locator('input[name="sourceAppealId"]').evaluate(input=>input.value="appeal_unknown");
   await offering.getByRole("button",{name:"Apply — worker pays",exact:true}).click();
   await page.waitForURL(url=>url.searchParams.has("error"));
   assert.match(await page.getByRole("alert").filter({hasText:"The selected reassessment appeal is unavailable."}).innerText(),/selected reassessment appeal is unavailable/i);
   await page.goto(baseUrl+"/worker/assessment-applications?sourceAppealId="+encodeURIComponent(fixture.appeal.appealId),{waitUntil:"domcontentloaded"});
   const restored=page.locator("article.panel").filter({has:page.getByRole("heading",{name:"Funded safety assessment",exact:true})}).first();
   await restored.getByRole("button",{name:"Apply — worker pays",exact:true}).click();
   await page.waitForURL(url=>url.searchParams.get("status")==="payment-required");
   const application=page.locator("article.panel").filter({hasText:fixture.appeal.appealId}).filter({has:page.getByRole("button",{name:"Confirm sandbox payment",exact:true})}).first();
   await application.getByRole("button",{name:"Confirm sandbox payment",exact:true}).click();
   await page.waitForURL(url=>url.searchParams.get("status")==="case-created");
   const createdArticle=page.locator("article.panel").filter({hasText:fixture.appeal.appealId}).filter({has:page.getByText("Status: CASE CREATED",{exact:true})}).first();
   const caseId=await createdArticle.locator("p").filter({hasText:"Assurance case:"}).locator("code").innerText();
   await page.goto(baseUrl+"/worker/available-assessments",{waitUntil:"domcontentloaded"});
   await page.locator('article[id="'+caseId+'"]').getByRole("button",{name:"Start assessment",exact:true}).click();
   await page.waitForURL(url=>url.pathname==="/worker/available-assessments/precheck"&&url.searchParams.get("caseId")===caseId);
   await page.screenshot({path:".autopilot/artifacts/20261010-appeal-reassessment-worker.png"});
   assert.deepEqual(errors,[]);
  }});assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
  const database=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   const rows=(await database.query("SELECT sources.*,applications.assurance_case_id,cases.tenant_id,cases.worker_account_id FROM worker_assessment_reassessment_sources sources JOIN worker_assessment_applications applications USING(application_id) JOIN assurance_cases cases ON cases.case_id=applications.assurance_case_id WHERE source_appeal_id=$1",[fixture.appeal.appealId])).rows;
   assert.equal(rows.length,1);assert.equal(rows[0].tenant_id,fixture.oldCase.tenant_id);assert.equal(rows[0].worker_account_id,fixture.worker.accountId);
   assert.notEqual(rows[0].assurance_case_id,fixture.oldCase.case_id);
   assert.equal(Number((await database.query("SELECT version FROM credential_appeals WHERE appeal_id=$1",[fixture.appeal.appealId])).rows[0].version),fixture.appeal.version);
  }finally{await database.close();}
 }finally{await browser.close();await fixture.cleanup();}
});
