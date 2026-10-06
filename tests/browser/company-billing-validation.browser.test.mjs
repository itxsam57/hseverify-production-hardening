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

test("Company sandbox checkout capture and recoverable refund validation",{timeout:180000},async()=>{
 const root=process.cwd(),dbDir=await mkdtemp(join(tmpdir(),"hse-billing-validation-")),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const env={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:dbDir,HSE_AUDIT_CREDENTIALS_PATH:join(dbDir,"audit-credentials.json"),HSE_RELEASE_SHA:"billing-validation-browser",HSE_SESSION_SECRET:"billing-validation-session-secret-more-than-thirty-two",HSE_AUTH_PEPPER:"billing-validation-auth-pepper-more-than-thirty-two",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false"};
 try{
  for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){const r=spawnSync(process.execPath,[script],{cwd:root,env,encoding:"utf8"});assert.equal(r.status,0,r.stderr||r.stdout);}
  const credentials=JSON.parse(await readFile(env.HSE_AUDIT_CREDENTIALS_PATH,"utf8"));
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/company/login",projectRoot:root,environment:env,probe:async()=>{
   const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();await login(page,baseUrl,credentials.company,"company");await page.goto(baseUrl+"/company/billing");
    const credits=page.locator(".metric-card").filter({hasText:"Company credits"}).locator("strong");const before=Number(await credits.innerText());
    const buy=page.locator(".card").filter({has:page.getByRole("heading",{name:"Buy sandbox credits",exact:true})});await buy.getByLabel("Credits",{exact:true}).fill("3");await buy.getByLabel("Amount (minor units)",{exact:true}).fill("300");await buy.getByRole("button",{name:"Create sandbox checkout",exact:true}).click();
    const complete=page.getByRole("button",{name:"Complete sandbox checkout",exact:true});await complete.waitFor();const cachedContext=await browser.newContext({javaScriptEnabled:false,storageState:await page.context().storageState()}),cachedPage=await cachedContext.newPage();await cachedPage.goto(baseUrl+"/company/billing");const cachedCapture=cachedPage.getByRole("button",{name:"Complete sandbox checkout",exact:true});await cachedCapture.waitFor();assert.equal(Number(await credits.innerText()),before);await complete.click();await page.getByText("Captured",{exact:true}).waitFor();await page.reload();assert.equal(Number(await credits.innerText()),before+3);assert.equal(await complete.count(),0);const repeated=cachedPage.waitForResponse(response=>response.request().method()==="POST");await cachedCapture.click();const repeat=await repeated;assert.ok(repeat.status()<400,"Cached repeated capture failed HTTP"+repeat.status());await cachedContext.close();await page.reload();assert.equal(Number(await credits.innerText()),before+3);
    const invoices=page.locator(".card").filter({has:page.getByRole("heading",{name:"Invoices",exact:true})});const invoiceId=(await invoices.locator("tbody tr").first().locator("td").first().innerText()).trim();
    console.log("ACTUAL_BILLING_BROWSER create checkout -> capture -> exact credits/invoice retained on reload");
    const refund=page.locator(".card").filter({has:page.getByRole("heading",{name:"Refunds",exact:true})});await refund.getByLabel("Invoice ID",{exact:true}).fill(invoiceId);await refund.getByLabel("Amount (minor units)",{exact:true}).fill("101");const rejected=page.waitForResponse(r=>r.request().method()==="POST");await refund.getByRole("button",{name:"Request sandbox refund",exact:true}).click();const invalidResponse=await rejected;assert.ok(invalidResponse.status()<400,"Invalid refund must produce recoverable feedback, not HTTP"+invalidResponse.status());
    await page.getByRole("alert").getByText("Refund amount must equal a whole number of purchased credits.",{exact:true}).waitFor({timeout:10000});
    const retryRefund=page.locator(".card").filter({has:page.getByRole("heading",{name:"Refunds",exact:true})});await retryRefund.getByLabel("Invoice ID",{exact:true}).fill(invoiceId);await retryRefund.getByLabel("Amount (minor units)",{exact:true}).fill("100");await retryRefund.getByRole("button",{name:"Request sandbox refund",exact:true}).click();await retryRefund.getByText(/REQUIRES_PROVIDER/).waitFor();await page.waitForURL(url=>url.pathname==="/company/billing"&&!url.searchParams.has("billingError"));assert.equal(await page.getByRole("alert").getByText("Refund amount must equal a whole number of purchased credits.",{exact:true}).count(),0,"Successful refund retry must clear stale billing error feedback");await page.getByRole("button",{name:"Run reconciliation",exact:true}).click();await page.getByText(/0 discrepancy item/).waitFor();await page.reload();assert.equal(Number(await credits.innerText()),before+3);console.log("ACTUAL_BILLING_BROWSER invalid refund feedback -> valid pending refund -> reconciliation -> retained ledger; duplicate capture harmless");
   }finally{await browser.close();}
  }});
  const db=new PGlite(dbDir);try{assert.deepEqual((await db.query("SELECT status,credit_units,amount_minor FROM billing_checkouts WHERE tenant_id=$1",[credentials.company.tenantId])).rows,[{status:"PAID",credit_units:3,amount_minor:300}]);assert.deepEqual((await db.query("SELECT status,credit_units,amount_minor FROM billing_refunds WHERE tenant_id=$1",[credentials.company.tenantId])).rows,[{status:"REQUIRES_PROVIDER",credit_units:1,amount_minor:100}]);assert.equal((await db.query("SELECT count(*)::int n FROM billing_credit_ledger WHERE tenant_id=$1 AND entry_type=\'PURCHASE\'",[credentials.company.tenantId])).rows[0].n,1);assert.equal((await db.query("SELECT count(*)::int n FROM platform_audit_events WHERE action_key=\'billing.refund.requested\' AND actor_tenant_id=$1",[credentials.company.tenantId])).rows[0].n,1);console.log("ACTUAL_BILLING_DB exact one capture/purchase and pending refund with required scoped audit");}finally{await db.close();}
 }finally{await rm(dbDir,{recursive:true,force:true});}
});
