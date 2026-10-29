import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { assessmentFundingFixture } from "../helpers/assessment-funding-fixture.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totp(secret) {
  let bits="";
  for(const letter of secret.toUpperCase().replace(/=+$/g,"")) bits+=ALPHABET.indexOf(letter).toString(2).padStart(5,"0");
  const bytes=Buffer.from(Array.from({length:Math.floor(bits.length/8)},(_,i)=>parseInt(bits.slice(i*8,i*8+8),2)));
  const counter=Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const hash=createHmac("sha1",bytes).update(counter).digest();
  const offset=hash.at(-1)&15;
  return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
async function port() {
  return new Promise((resolve,reject)=>{
    const server=createServer();
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      const value=server.address().port;
      server.close(error=>error?reject(error):resolve(value));
    });
  });
}
async function login(page,baseUrl,credentials,role) {
  await page.goto(baseUrl+"/"+role+"/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  if(credentials.totpSecret) await page.getByLabel("Authenticator code").fill(totp(credentials.totpSecret));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL("**/"+role+"/dashboard");
}

test("M2.06 revoked Company–Worker relationship cannot approve a pending funding request or create a case", {timeout:160000}, async()=>{
  const fixture=await assessmentFundingFixture();
  const baseUrl="http://127.0.0.1:"+(await port());
  try {
    const result=await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",new URL(baseUrl).port],
      probeUrl:baseUrl+"/worker/login",
      projectRoot:process.cwd(),
      environment:fixture.environment,
      probe:async({initialResponse,output})=>{
        assert.equal(initialResponse.status,200);
        const browser=await chromium.launch({headless:true});
        try {
          const worker=await browser.newPage({viewport:{width:390,height:844}});
          const company=await browser.newPage({viewport:{width:1440,height:1000}});
          const errors=[];
          for(const page of [worker,company]) {
            page.on("pageerror",e=>errors.push(e.message));
            page.on("response",response=>{if(response.status()>=500)errors.push("HTTP "+response.status()+": "+new URL(response.url()).pathname);});
          }
          await login(worker,baseUrl,fixture.credentials.worker,"worker");
          await worker.goto(baseUrl+"/worker/assessment-applications",{waitUntil:"domcontentloaded"});
          const offering=worker.locator("article.panel").filter({has:worker.getByRole("heading",{name:"Funded safety assessment",exact:true})}).first();
          await offering.locator('select[name="companyFunding"]').selectOption(fixture.fundingInput.tenantId+"|"+fixture.fundingInput.workerLinkId);
          await offering.getByRole("button",{name:"Request 1 assessment credit",exact:true}).click();
          await worker.waitForURL("**/worker/assessment-applications?status=funding-requested");
          await worker.getByText("Company funding request submitted.",{exact:true}).waitFor();
          await login(company,baseUrl,fixture.credentials.company,"company");
          await company.goto(baseUrl+"/company/billing",{waitUntil:"domcontentloaded"});
          const request=company.locator('tr[id^="funding_"]').filter({hasText:"Funded safety assessment"}).first();
          await request.getByRole("cell",{name:"REQUESTED",exact:true}).waitFor();
          const requestId=await request.getAttribute("id");
          assert.match(requestId,/^funding_[A-Za-z0-9_-]+$/);
          await company.goto(baseUrl+"/company/workers/"+fixture.fundingInput.workerLinkId,{waitUntil:"domcontentloaded"});
          const endForm=company.getByRole("region",{name:"End Company Worker relationship"});
          await endForm.getByLabel("Reason for ending relationship").fill("End relationship before funding authorization");
          await endForm.getByLabel("I confirm the Company relationship will end immediately.").check();
          await endForm.getByRole("button",{name:"End relationship",exact:true}).click();
          // A successful end-relationship Server Action can revalidate the
          // route and unmount its editor. Assert the persistent revoked view,
          // not a short-lived feedback node inside the removed editor.
          await company.getByText("This Company relationship has ended.",{exact:false}).waitFor({timeout:20000});
          await company.reload({waitUntil:"domcontentloaded"});
          await company.getByText("This Company relationship has ended.",{exact:false}).waitFor();
          console.log("ACTUAL_M206_REVOKE_BROWSER Company ended active Worker relationship before pending funding approval");
          await company.goto(baseUrl+"/company/billing",{waitUntil:"domcontentloaded"});
          const pending=company.locator('tr[id="'+requestId+'"]');
          await pending.getByRole("cell",{name:"REQUESTED",exact:true}).waitFor();
          await pending.getByRole("button",{name:"Approve",exact:true}).click();
          await company.waitForURL(url=>url.pathname==="/company/billing"&&url.searchParams.has("fundingError"));
          await company.getByRole("alert").getByText("The Worker is no longer linked to this Company.",{exact:true}).waitFor();
          await company.reload({waitUntil:"domcontentloaded"});
          await company.locator('tr[id="'+requestId+'"]').getByRole("cell",{name:"REQUESTED",exact:true}).waitFor();
          console.log("ACTUAL_M206_APPROVAL_DENIED_BROWSER pending request rejected server-side after revoked link, even while Company has credits");
          assert.deepEqual(errors,[],output());
        } finally {await browser.close();}
      }
    });
    assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
    const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try {
      const links=(await db.query("SELECT link_status FROM company_worker_links WHERE link_id=$1",[fixture.fundingInput.workerLinkId])).rows;
      assert.equal(links[0].link_status,"revoked");
      const requests=(await db.query("SELECT status,reserved_credit_units FROM funding_requests WHERE tenant_id=$1",[fixture.fundingInput.tenantId])).rows;
      assert.equal(requests.length,1);
      assert.equal(requests[0].status,"REQUESTED");
      assert.equal(Number(requests[0].reserved_credit_units),0);
      const applications=(await db.query("SELECT application_status,assurance_case_id FROM worker_assessment_applications WHERE company_tenant_id=$1",[fixture.fundingInput.tenantId])).rows;
      assert.equal(applications.length,1);
      assert.equal(applications[0].application_status,"FUNDING_REQUESTED");
      assert.equal(applications[0].assurance_case_id,null);
      assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM assurance_cases WHERE worker_account_id=$1",[fixture.worker.accountId])).rows[0].n,0);
      console.log("ACTUAL_M206_REVOKED_FUNDING_DB no reserved credits, no funding approval and no Worker case created");
    } finally {await db.close();}
  } finally {await fixture.cleanup();}
});


test("M2.06 Company zero credits rejects funding, then genuine sandbox checkout allows owned Worker case", {timeout:180000}, async()=>{
  const fixture=await assessmentFundingFixture({startingCreditUnits:0});
  const baseUrl="http://127.0.0.1:"+(await port());
  try {
    const result=await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",new URL(baseUrl).port],
      probeUrl:baseUrl+"/company/login",
      projectRoot:process.cwd(),
      environment:fixture.environment,
      probe:async({initialResponse,output})=>{
        assert.equal(initialResponse.status,200);
        const browser=await chromium.launch({headless:true});
        try {
          const worker=await browser.newPage({viewport:{width:390,height:844}});
          const company=await browser.newPage({viewport:{width:1440,height:1000}});
          const errors=[];
          for(const page of [worker,company]){
            page.on("pageerror",error=>errors.push(error.message));
            page.on("response",response=>{if(response.status()>=500)errors.push("HTTP "+response.status()+": "+new URL(response.url()).pathname);});
          }
          await login(worker,baseUrl,fixture.credentials.worker,"worker");
          await worker.goto(baseUrl+"/worker/assessment-applications",{waitUntil:"domcontentloaded"});
          const offering=worker.locator("article.panel").filter({has:worker.getByRole("heading",{name:"Funded safety assessment",exact:true})}).first();
          await offering.locator('select[name="companyFunding"]').selectOption(fixture.fundingInput.tenantId+"|"+fixture.fundingInput.workerLinkId);
          await offering.getByRole("button",{name:"Request 1 assessment credit",exact:true}).click();
          await worker.waitForURL("**/worker/assessment-applications?status=funding-requested");
          await worker.getByText("Company funding request submitted.",{exact:true}).waitFor();
          await login(company,baseUrl,fixture.credentials.company,"company");
          await company.goto(baseUrl+"/company/billing",{waitUntil:"domcontentloaded"});
          const funding=company.locator('tr[id^="funding_"]').filter({hasText:"Funded safety assessment"}).first();
          await funding.getByRole("cell",{name:"REQUESTED",exact:true}).waitFor();
          const fundingId=await funding.getAttribute("id");
          assert.match(fundingId,/^funding_[A-Za-z0-9_-]+$/);
          await funding.getByRole("button",{name:"Approve",exact:true}).click();
          await company.waitForURL(url=>url.pathname==="/company/billing"&&url.searchParams.has("fundingError"));
          await company.getByRole("alert").getByText("The Company does not have enough unreserved assessment credits.",{exact:true}).waitFor();
          await company.locator('tr[id="'+fundingId+'"]').getByRole("cell",{name:"REQUESTED",exact:true}).waitFor();
          console.log("ACTUAL_M206_ZERO_CREDIT_BROWSER valid Company request denied with no credit reservation or case");

          const buy=company.locator(".card").filter({hasText:"Buy sandbox credits"}).first();
          await buy.getByLabel("Credits",{exact:true}).fill("1");
          await buy.getByLabel("Amount (minor units)",{exact:true}).fill("100");
          await buy.getByRole("button",{name:"Create sandbox checkout",exact:true}).click();
          await company.waitForURL(url=>url.pathname==="/company/billing");
          const checkout=company.locator("tr").filter({hasText:"REQUIRES_PROVIDER"}).filter({has:company.getByRole("button",{name:"Complete sandbox checkout",exact:true})}).first();
          await checkout.getByRole("button",{name:"Complete sandbox checkout",exact:true}).click();
          await company.waitForURL(url=>url.pathname==="/company/billing");
          await company.getByText("PAID",{exact:true}).first().waitFor();
          const ready=company.locator('tr[id="'+fundingId+'"]');
          await ready.getByRole("cell",{name:"REQUESTED",exact:true}).waitFor();
          await ready.getByRole("button",{name:"Approve",exact:true}).click();
          await company.waitForURL(url=>url.pathname==="/company/billing");
          await company.locator('tr[id="'+fundingId+'"]').getByRole("cell",{name:"APPROVED",exact:true}).waitFor();
          await worker.goto(baseUrl+"/worker/available-assessments",{waitUntil:"domcontentloaded"});
          const start=worker.getByRole("button",{name:"Start assessment",exact:true}).first();
          await start.waitFor();
          await start.click();
          await worker.waitForURL(url=>url.pathname==="/worker/available-assessments/precheck"&&url.searchParams.has("caseId"));
          console.log("ACTUAL_M206_CREDIT_PURCHASE_BROWSER unpaid request remained pending; real Company sandbox checkout captured 1 credit and approved matching Worker assessment to precheck");
          assert.deepEqual(errors,[],output());
        } finally {await browser.close();}
      }
    });
    assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
    const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try {
      const balance=(await db.query("SELECT COALESCE(SUM(credit_delta),0)::int AS balance FROM billing_credit_ledger WHERE tenant_id=$1",[fixture.fundingInput.tenantId])).rows[0].balance;
      assert.equal(Number(balance),1);
      const requests=(await db.query("SELECT status,reserved_credit_units FROM funding_requests WHERE tenant_id=$1",[fixture.fundingInput.tenantId])).rows;
      assert.equal(requests.length,1);
      assert.equal(requests[0].status,"APPROVED");
      assert.equal(Number(requests[0].reserved_credit_units),1);
      const apps=(await db.query("SELECT application_status,assurance_case_id FROM worker_assessment_applications WHERE company_tenant_id=$1",[fixture.fundingInput.tenantId])).rows;
      assert.equal(apps.length,1);
      assert.equal(apps[0].application_status,"CASE_CREATED");
      assert.match(apps[0].assurance_case_id,/^assurance_case_/);
      assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM assurance_cases WHERE worker_account_id=$1",[fixture.worker.accountId])).rows[0].n,1);
      console.log("ACTUAL_M206_CREDIT_DB exactly one paid sandbox credit, one reservation, one funded Worker case, no double funding");
    } finally {await db.close();}
  } finally {await fixture.cleanup();}
});
