import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { assessmentFundingFixture } from "../helpers/assessment-funding-fixture.mjs";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const SECOND={
  accountId:"audit_billing_second_company_account_20261030",
  email:"billing.second-company@example.test",
  tenantId:"tenant_"+"Z".repeat(24),
  membershipId:"membership_"+"Z".repeat(24),
  factorId:"audit_billing_second_company_totp_20261030"
};

function totp(secret){
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits="";
  for(const c of secret.toUpperCase().replace(/=+$/g,""))bits+=alphabet.indexOf(c).toString(2).padStart(5,"0");
  const bytes=Buffer.from(Array.from({length:Math.floor(bits.length/8)},(_,i)=>parseInt(bits.slice(i*8,i*8+8),2)));
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac("sha1",bytes).update(counter).digest(),offset=digest.at(-1)&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,"0");
}
function port(){
  return new Promise((resolve,reject)=>{
    const server=createServer();server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{const n=server.address().port;server.close(error=>error?reject(error):resolve(n));});
  });
}
async function login(page,baseUrl,creds){
  await page.goto(baseUrl+"/company/login",{waitUntil:"domcontentloaded"});
  await page.getByLabel("Email address").fill(creds.email);
  await page.getByLabel("Password").fill(creds.password);
  await page.getByLabel("Authenticator code").fill(totp(creds.totpSecret));
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.waitForURL("**/company/dashboard");
}
async function seedSecondCompany(fixture){
  const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
    const now=new Date().toISOString(),first=fixture.credentials.company;
    await db.query(`INSERT INTO auth_accounts
      (account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
      SELECT $1,$2,'Independent Billing Tenant','active',password_hash,$3,$3,$3,$3 FROM auth_accounts WHERE account_id=$4`,
      [SECOND.accountId,SECOND.email,now,first.accountId]);
    await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'company',$2)",[SECOND.accountId,now]);
    await db.query(`INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,last_accepted_counter,created_at,activated_at)
      SELECT $1,$2,'totp',encrypted_secret,'active',NULL,$3,$3 FROM auth_mfa_factors WHERE account_id=$4 AND factor_type='totp'`,
      [SECOND.factorId,SECOND.accountId,now,first.accountId]);
    await db.query(`INSERT INTO platform_tenants(tenant_id,tenant_type,display_name,tenant_status,created_by_account_id,created_at,updated_at,activated_at)
      VALUES($1,'company','Independent Billing Tenant','active',$2,$3,$3,$3)`,[SECOND.tenantId,SECOND.accountId,now]);
    await db.query(`INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at)
      VALUES($1,$2,$3,'company','owner','active',$3,$4,$4,$4)`,[SECOND.membershipId,SECOND.tenantId,SECOND.accountId,now]);
  }finally{await db.close();}
}
test("M3.05 two independent Company browser sessions isolate paid invoices and deny cross-tenant refund", {timeout:150000},async()=>{
  const fixture=await assessmentFundingFixture();
  const base="http://127.0.0.1:"+(await port());
  try{
    await seedSecondCompany(fixture);
    const original=fixture.credentials.company;
    const second={email:SECOND.email,password:original.password,totpSecret:original.totpSecret};
    const result=await runDevelopmentServer({
      args:["--hostname","127.0.0.1","--port",new URL(base).port],probeUrl:base+"/company/login",
      projectRoot:process.cwd(),environment:fixture.environment,
      probe:async({initialResponse,output})=>{
        assert.equal(initialResponse.status,200);
        const browser=await chromium.launch({headless:true});
        try{
          const companyA=await browser.newPage({viewport:{width:1400,height:900}});
          const companyB=await browser.newPage({viewport:{width:1400,height:900}});
          const errors=[];
          for(const page of [companyA,companyB]){
            page.on("pageerror",error=>errors.push(error.message));
            page.on("response",response=>{if(response.status()>=500)errors.push("HTTP "+response.status()+" "+new URL(response.url()).pathname);});
          }
          await login(companyA,base,original);
          await login(companyB,base,second);
          await companyA.goto(base+"/company/billing",{waitUntil:"domcontentloaded"});
          await companyB.goto(base+"/company/billing",{waitUntil:"domcontentloaded"});
          const invoiceCard=page=>page.locator(".card").filter({has:page.getByRole("heading",{name:"Invoices",exact:true})}).first();
          const aInvoice=(await invoiceCard(companyA).locator("tbody tr td").first().innerText()).trim();
          assert.match(aInvoice,/^billing_invoice_/);
          assert.equal(await invoiceCard(companyB).getByText("No invoices yet.",{exact:true}).count(),1);
          const aBalance=await companyA.locator(".metric-card").filter({hasText:"Company credits"}).locator("strong").innerText();
          const bBalance=await companyB.locator(".metric-card").filter({hasText:"Company credits"}).locator("strong").innerText();
          assert.equal(aBalance,"3");assert.equal(bBalance,"0");
          const buy=companyB.locator(".card").filter({has:companyB.getByRole("heading",{name:"Buy sandbox credits",exact:true})}).first();
          await buy.getByLabel("Credits",{exact:true}).fill("2");
          await buy.getByLabel("Amount (minor units)",{exact:true}).fill("200");
          await buy.getByRole("button",{name:"Create sandbox checkout",exact:true}).click();
          await companyB.waitForURL(url=>url.pathname==="/company/billing");
          const checkout=companyB.locator("tr").filter({has:companyB.getByRole("button",{name:"Complete sandbox checkout",exact:true})}).first();
          await checkout.getByRole("button",{name:"Complete sandbox checkout",exact:true}).click();
          await companyB.waitForURL(url=>url.pathname==="/company/billing");
          await invoiceCard(companyB).getByText("PAID",{exact:true}).waitFor();
          const bInvoice=(await invoiceCard(companyB).locator("tbody tr td").first().innerText()).trim();
          assert.match(bInvoice,/^billing_invoice_/);
          assert.notEqual(bInvoice,aInvoice);
          assert.equal(await invoiceCard(companyB).getByText(aInvoice,{exact:true}).count(),0);
          await companyA.reload({waitUntil:"domcontentloaded"});
          assert.equal(await invoiceCard(companyA).getByText(bInvoice,{exact:true}).count(),0);
          assert.equal(await invoiceCard(companyA).getByText(aInvoice,{exact:true}).count(),1);
          console.log("ACTUAL_M305_TWO_COMPANIES_BROWSER distinct paid sandbox invoices and credit balances visible only to their owners");

          // The printable receipt itself is private, not just the invoice
          // table. Both authorized owners see their captured amount and credit
          // activity, but guessed cross-tenant receipt URLs must be 404.
          const receiptUrl=id=>base+"/company/billing/receipts/"+encodeURIComponent(id);
          assert.equal((await companyA.goto(receiptUrl(aInvoice),{waitUntil:"domcontentloaded"}))?.status(),200);
          await companyA.getByRole("heading",{name:"Payment receipt",exact:true}).waitFor();
          await companyA.getByText(aInvoice,{exact:true}).waitFor();
          await companyA.getByText(fixture.credentials.company.tenantId,{exact:true}).waitFor();
          await companyA.getByText("3",{exact:true}).first().waitFor();
          assert.equal((await companyB.goto(receiptUrl(bInvoice),{waitUntil:"domcontentloaded"}))?.status(),200);
          await companyB.getByRole("heading",{name:"Payment receipt",exact:true}).waitFor();
          await companyB.getByText(SECOND.tenantId,{exact:true}).waitFor();
          await companyB.getByText(bInvoice,{exact:true}).waitFor();
          assert.equal((await companyB.goto(receiptUrl(aInvoice),{waitUntil:"domcontentloaded"}))?.status(),404);
          assert.equal(await companyB.getByText(aInvoice,{exact:true}).count(),0);
          assert.equal((await companyA.goto(receiptUrl(bInvoice),{waitUntil:"domcontentloaded"}))?.status(),404);
          assert.equal(await companyA.getByText(bInvoice,{exact:true}).count(),0);
          console.log("ACTUAL_M305_RECEIPT_BROWSER own paid receipts 200, both foreign guessed URLs 404, no invoice details");
          await companyA.goto(base+"/company/billing",{waitUntil:"domcontentloaded"});
          await companyB.goto(base+"/company/billing",{waitUntil:"domcontentloaded"});
          const activityA=companyA.locator(".card").filter({has:companyA.getByRole("heading",{name:"Credit activity",exact:true})}).first();
          const activityB=companyB.locator(".card").filter({has:companyB.getByRole("heading",{name:"Credit activity",exact:true})}).first();
          assert.equal(await activityA.getByText(aInvoice,{exact:true}).count(),1);
          assert.equal(await activityA.getByText(bInvoice,{exact:true}).count(),0);
          assert.equal(await activityB.getByText(bInvoice,{exact:true}).count(),1);
          assert.equal(await activityB.getByText(aInvoice,{exact:true}).count(),0);
          const refunds=companyB.locator(".card").filter({has:companyB.getByRole("heading",{name:"Refunds",exact:true})}).first();
          await refunds.getByLabel("Invoice ID").fill(aInvoice);
          await refunds.getByLabel("Amount (minor units)").fill("100");
          await refunds.getByRole("button",{name:"Request sandbox refund",exact:true}).click();
          await companyB.waitForURL(url=>url.pathname==="/company/billing"&&url.searchParams.has("billingError"));
          await companyB.getByRole("alert").getByText("Billing access was denied.",{exact:true}).waitFor();
          assert.equal(await invoiceCard(companyB).getByText(aInvoice,{exact:true}).count(),0);
          await companyA.reload({waitUntil:"domcontentloaded"});
          assert.equal(await invoiceCard(companyA).getByText(aInvoice,{exact:true}).count(),1);
          console.log("ACTUAL_M305_FOREIGN_REFUND_BROWSER forged cross-tenant invoice ID rejected without disclosing invoice details");
          assert.deepEqual(errors,[],output());
        }finally{await browser.close();}
      }
    });
    assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
    const db=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
    try{
      const tenants=(await db.query(`SELECT tenant_id,COUNT(*)::int AS invoices,SUM(credit_units)::int AS credits, SUM(amount_minor)::int AS amount
        FROM billing_invoices WHERE tenant_id=ANY($1::text[]) GROUP BY tenant_id ORDER BY tenant_id`,
        [[fixture.credentials.company.tenantId,SECOND.tenantId]])).rows;
      assert.equal(tenants.length,2);
      assert.equal(tenants.find(t=>t.tenant_id===fixture.credentials.company.tenantId).credits,3);
      assert.equal(tenants.find(t=>t.tenant_id===SECOND.tenantId).credits,2);
      assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM billing_refunds WHERE tenant_id=$1",[SECOND.tenantId])).rows[0].n,0);
      assert.equal((await db.query("SELECT COALESCE(SUM(credit_delta),0)::int AS n FROM billing_credit_ledger WHERE tenant_id=$1",[SECOND.tenantId])).rows[0].n,2);
      console.log("ACTUAL_M305_TENANT_DB independent invoices, credit ledger and zero forged cross-tenant refund writes");
    }finally{await db.close();}
  }finally{await fixture.cleanup();}
});
