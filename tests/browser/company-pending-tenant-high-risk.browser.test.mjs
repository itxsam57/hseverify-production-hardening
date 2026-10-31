import assert from "node:assert/strict";
import {createServer} from "node:net";
import test from "node:test";
import {chromium} from "playwright";
import {PGlite} from "@electric-sql/pglite";
import {runDevelopmentServer} from "../../scripts/lib/development-server.mjs";
import {reportCompanyFixture,reportNativePrincipal} from "../helpers/report-company-fixture.mjs";
import {loadWorkerRegistrationTs} from "../helpers/worker-registration-runtime-loader.mjs";

const {CompanyWorkforceService}=loadWorkerRegistrationTs("src/lib/company/company-workforce-service.ts");
const {BillingService}=loadWorkerRegistrationTs("src/lib/billing/billing-service.ts");
const {AssuranceOrderService}=loadWorkerRegistrationTs("src/lib/assurance/assurance-order-service.ts");

const draft={orderName:"Pending tenant forbidden assurance",orderReference:"PENDING-TENANT-REJECT-2026",
  siteId:null,departmentId:null,requestedIdentityChecks:["identity"],requestedEvidenceChecks:["qualification"],
  assessmentFrameworkReferences:[],interviewRequired:false,credentialTarget:null,deadline:"2099-01-01T00:00:00.000Z",
  effectivePolicyReference:null,companyNotes:"Should never be committed by an unverified tenant.",purchaseOrderReference:null};
function count(db,table,tenantId){return db.query("SELECT COUNT(*)::int n FROM "+table+" WHERE tenant_id=$1",[tenantId]).then(r=>r.rows[0].n);}
async function port(){return new Promise((resolve,reject)=>{const s=createServer();s.once("error",reject);
 s.listen(0,"127.0.0.1",()=>{const a=s.address();s.close(e=>e?reject(e):!a||typeof a==="string"?reject(new Error("Missing local port")):resolve(a.port));});});}

test("M1.08.02 pending Company remains signed in for verification but cannot invite, issue orders or purchase credits",{timeout:180000},async()=>{
 const fixture=await reportCompanyFixture();let browser;
 const tenantId=fixture.credentials.company.tenantId;
 const before={};const errors=[];
 try{
  const db=fixture.database;
  const workforce=new CompanyWorkforceService(db,fixture.environment.HSE_AUTH_PEPPER);
  const billing=new BillingService(db),orders=new AssuranceOrderService(db);
  const [workforcePrincipal,billingPrincipal,orderPrincipal]=await Promise.all([
   reportNativePrincipal(db,fixture.credentials.company,"company.workforce.manage"),
   reportNativePrincipal(db,fixture.credentials.company,"company.billing.manage"),
   reportNativePrincipal(db,fixture.credentials.company,"company.orders.manage")
  ]);
  // Prove a real, previously authenticated, known-active owner can create
  // a Company registration code before tenant verification is suspended.
  const positive=await workforce.createRegistrationCode(workforcePrincipal,{
   usageLimit:1,expiresAt:new Date(Date.now()+3600000).toISOString(),
   paymentResponsibility:"worker",siteId:null,departmentId:null,assessmentReference:null
  });
  assert.ok(positive.registrationCode);
  for(const table of ["company_worker_invitations","company_registration_codes","assurance_orders",
   "billing_checkouts","billing_invoices","billing_credit_ledger"])before[table]=await count(db,table,tenantId);
  const priorSession=(await db.query("SELECT COUNT(*)::int n FROM auth_sessions WHERE account_id=$1 AND revoked_at IS NULL",[fixture.credentials.company.accountId])).rows[0].n;
  await db.query("UPDATE platform_tenants SET tenant_status='pending',activated_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=$1",[tenantId]);
  assert.equal((await db.query("SELECT tenant_status FROM platform_tenants WHERE tenant_id=$1",[tenantId])).rows[0].tenant_status,"pending");
  await assert.rejects(workforce.inviteWorker(workforcePrincipal,{
   email:"pending-danger-invite@example.test",paymentResponsibility:"company",siteId:null,departmentId:null,assessmentReference:null
  }),e=>/Access|Scope/.test(e.name));
  await assert.rejects(workforce.createRegistrationCode(workforcePrincipal,{
   usageLimit:1,expiresAt:new Date(Date.now()+3600000).toISOString(),
   paymentResponsibility:"worker",siteId:null,departmentId:null,assessmentReference:null
  }),e=>/Access|Scope/.test(e.name));
  await assert.rejects(billing.createCreditCheckout(billingPrincipal,{
   idempotencyKey:"pending-tenant-must-fail",creditUnits:1,amountMinor:100,currency:"USD"
  }),e=>/Access|Scope/.test(e.name));
  await assert.rejects(orders.createDraft(orderPrincipal,draft),e=>/Access|Scope/.test(e.name));
  for(const [table,n] of Object.entries(before))assert.equal(await count(db,table,tenantId),n,
   "Pending tenant must not mutate "+table);
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM auth_sessions WHERE account_id=$1 AND revoked_at IS NULL",[fixture.credentials.company.accountId])).rows[0].n,priorSession,
   "Suspending high-risk tenant permissions must not revoke the owner's safe account access.");
  await db.close();
  const baseUrl="http://127.0.0.1:"+(await port());
  browser=await chromium.launch({headless:true});
  const page=await(await browser.newContext()).newPage();
  page.on("pageerror",e=>errors.push(e.message));
  page.on("response",r=>{if(r.status()>=500)errors.push(r.status()+" "+new URL(r.url()).pathname);});
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",new URL(baseUrl).port],
   probeUrl:baseUrl+"/company/login",environment:fixture.environment,projectRoot:process.cwd(),probe:async()=>{
    await page.goto(baseUrl+"/company/login");
    await page.getByLabel("Email address").fill(fixture.credentials.company.email);
    await page.getByLabel("Password").fill(fixture.credentials.company.password);
    const {createHmac}=await import("node:crypto");
    const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits=0,carry=0;const bytes=[];
    for(const c of fixture.credentials.company.totpSecret.toUpperCase().replace(/=+$/g,"")){
     carry=(carry<<5)|alphabet.indexOf(c);bits+=5;
     if(bits>=8){bytes.push((carry>>>(bits-8))&255);bits-=8;carry&=bits?((1<<bits)-1):0;}
    }
    const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
    const digest=createHmac("sha1",Buffer.from(bytes)).update(counter).digest();
    const otp=String((digest.readUInt32BE(digest.at(-1)&15)&0x7fffffff)%1000000).padStart(6,"0");
    await page.getByLabel("Authenticator code").fill(otp);
    await page.getByRole("button",{name:"Sign in",exact:true}).click();
    await page.waitForURL("**/company/dashboard",{timeout:20000});
    await page.getByRole("link",{name:"Open Company verification",exact:true}).waitFor();
    assert.match((await page.locator("body").innerText()).toLowerCase(),/pending/);
    await page.getByRole("link",{name:"Open Company verification",exact:true}).click();
    await page.waitForURL("**/company/settings/profile");
    await page.getByRole("heading",{name:"Company profile and verification",exact:true}).waitFor();
    await page.goto(baseUrl+"/company/dashboard");
    for(const path of ["/company/billing","/company/invitations","/company/assurance-orders"]){
      await page.goto(baseUrl+path);
      const body=await page.locator("body").innerText();
      const route=new URL(page.url()).pathname;
      assert.ok(route!==path || !/Buy sandbox credits|Worker invitations and Company codes|Create Assurance Order/i.test(body),
       "Pending Company must not render protected high-risk operating forms at "+path);
      assert.ok(route==="/access-denied"||route==="/company/dashboard"||/access denied|not authorized|permission/i.test(body),
       "Pending Company must receive a safe and explicit denial at "+path+" (arrived "+route+")");
    }
    await page.goto(baseUrl+"/company/dashboard");
    await page.getByRole("link",{name:"Open Company verification",exact:true}).waitFor();
   }});
  const proof=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
   for(const [table,n] of Object.entries(before))assert.equal(await count(proof,table,tenantId),n,
    "Browser high-risk navigation must not create "+table+" while tenant pending.");
   assert.equal((await proof.query("SELECT tenant_status FROM platform_tenants WHERE tenant_id=$1",[tenantId])).rows[0].tenant_status,"pending");
   const login=(await proof.query("SELECT COUNT(*)::int n FROM auth_sessions WHERE account_id=$1 AND revoked_at IS NULL",[fixture.credentials.company.accountId])).rows[0].n;
   assert.ok(login>priorSession,"Pending tenant owner can independently sign into Company verification account.");
  }finally{await proof.close();}
  // Re-activate the same tenant: its previously verified assurance case should
  // now display as verified, without an obsolete verification banner. This
  // also proves the restriction is not a permanent account lockout.
  const restored=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
    await restored.query("UPDATE platform_tenants SET tenant_status='active',activated_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=$1",[tenantId]);
  }finally{await restored.close();}
  await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",new URL(baseUrl).port],
    probeUrl:baseUrl+"/company/login",environment:fixture.environment,projectRoot:process.cwd(),probe:async()=>{
      await page.goto(baseUrl+"/company/dashboard");
      await page.getByText("Company verification: verified",{exact:false}).waitFor();
      assert.equal(await page.getByRole("link",{name:"Open Company verification",exact:true}).count(),0);
      await page.goto(baseUrl+"/company/billing");
      await page.getByRole("heading",{name:"Company billing",exact:true}).waitFor();
      await page.goto(baseUrl+"/company/invitations");
      await page.getByRole("heading",{name:"Worker invitations and Company codes",exact:true}).waitFor();
    }
  });
  assert.deepEqual(errors,[]);
  console.log("M10802_REAL_PENDING_TENANT pending Company can safely verify, operations denied without mutation; reactivated verified Company regains correct badge and billing/workforce access");
 }finally{await browser?.close();await fixture.cleanup();}
});
