import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
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



test("Company filtered directory preserves status through Next, refresh and Previous", {timeout:180000}, async () => {
 const directory=await mkdtemp(join(tmpdir(),"hse-workforce-pagination-")), port=await freePort(), baseUrl="http://127.0.0.1:"+port;
 const environment={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:join(directory,"db"),HSE_RELEASE_SHA:"workforce-pagination-contract",HSE_SESSION_SECRET:"pagination-browser-session-secret-more-than-thirty-two",HSE_AUTH_PEPPER:"pagination-browser-auth-pepper-more-than-thirty-two",HSE_ENABLE_WORKER_DEMO_AUTH:"false",HSE_USE_WORKER_DEMO_DATA:"false",HSE_AUDIT_CREDENTIALS_PATH:join(directory,"credentials.json")};
 let savedStorage;
 try {
  for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){const r=spawnSync(process.execPath,[script],{cwd:process.cwd(),env:environment,encoding:"utf8"});assert.equal(r.status,0,r.stderr||r.stdout);}
  const credentials=JSON.parse(await readFile(environment.HSE_AUDIT_CREDENTIALS_PATH,"utf8"));
  // Schema-valid directory fixtures; this does not certify invitation acceptance.
  const db=await PGlite.create(environment.HSE_PGLITE_DATA_DIR);
  try {
   const now=new Date().toISOString(), expiry=new Date(Date.now()+86400000).toISOString();
   const passwordHash=(await db.query("SELECT password_hash FROM auth_accounts WHERE account_id=$1",[credentials.worker.accountId])).rows[0].password_hash;
   for(let n=0;n<28;n++){
    const suffix=String(n).padStart(24,"0"), accountId="pagination_worker_"+suffix, email="pagination."+n+"@example.test", invitationId="worker_invitation_"+suffix;
    await db.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,worker_reference,email_verified_at,password_set_at,created_at,updated_at) VALUES($1,$2,$3,'active',$4,$5,$6,$6,$6,$6)",[accountId,email,"Safety & Operations "+String(n===27?25:n).padStart(2,"0"),passwordHash,"HSE-REG-PAGINATION"+suffix,now]);
    await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'worker',$2)",[accountId,now]);
    if(n===27) continue; // Matching foreign Worker has no authorized Company link.
    await db.query("INSERT INTO company_worker_invitations(invitation_id,tenant_id,email_normalized,token_hash,invitation_status,invited_by_membership_id,accepted_by_worker_account_id,resend_available_at,expires_at,accepted_at,created_at,updated_at) VALUES($1,$2,$3,$4,'accepted',$5,$6,$7,$8,$7,$7,$7)",[invitationId,credentials.company.tenantId,email,"pagination_token_hash_"+suffix,credentials.company.membershipId,accountId,now,expiry]);
    await db.query("INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,link_source,invitation_id,link_status,worker_accepted_at,activated_at,revoked_at,created_at,updated_at) VALUES($1,$2,$3,'invitation',$4,$5,$6,$6,$7,$6,$6)",["company_worker_link_"+suffix,credentials.company.tenantId,accountId,invitationId,n===26?"revoked":"active",now,n===26?now:null]);
   }
  } finally {await db.close();}
  const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/company/login",projectRoot:process.cwd(),environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try {
    const context=await browser.newContext(), page=await context.newPage();
    await login(page,baseUrl,credentials.company,"company");

    for(const width of [1440,390,320]){
     await page.setViewportSize({width,height:1000});
     await page.goto(baseUrl+"/company/dashboard",{waitUntil:"domcontentloaded"});
     const search=page.locator("header.portal-header").getByRole("group",{name:"Workforce search",exact:true});
     assert.equal(await search.count(),1,"Authorized Company header search is missing");
     const control=await search.locator("summary").boundingBox();assert.ok(control && control.x>=0 && control.x+control.width<=width && control.height>=44,"Search control must fit the viewport");
     assert.ok(await page.locator("header.portal-header").evaluate(el=>el.scrollWidth<=el.clientWidth),"Header controls overflow");
     await search.locator("summary").focus();await page.keyboard.press("Enter");
     const input=search.getByLabel("Search workforce",{exact:true});
     await input.fill("Safety & Operations 25");
     const box=await input.boundingBox();assert.ok(box && box.x>=0 && box.x+box.width<=width,"Search input overflows viewport");
     await input.press("Enter");
     await page.waitForURL(url=>url.pathname==="/company/workers"&&url.searchParams.get("q")==="Safety & Operations 25");
     await page.getByText("1 matching Worker",{exact:true}).waitFor();
     assert.equal(await page.locator("tbody tr").count(),1);
     await page.locator("tbody tr").getByRole("link",{name:"View company-scoped report",exact:true}).click();
     await page.waitForURL(url=>url.pathname.startsWith("/company/workers/"));
    await page.getByRole("heading",{name:"Safety & Operations 25",exact:true}).waitFor();
    }
    await page.goto(baseUrl+"/company/workers?"+new URLSearchParams({q:"Safety & Operations 25",tenantId:"foreign",accountId:"foreign"}),{waitUntil:"domcontentloaded"});
    await page.getByText("1 matching Worker",{exact:true}).waitFor();
    await page.goto(baseUrl+"/company/workers?"+new URLSearchParams({q:"\u0027 OR 1=1 --"}),{waitUntil:"domcontentloaded"});
    await page.getByText("No Workers match these filters.",{exact:true}).waitFor();
    const filters=new URLSearchParams({q:"Safety & Operations",status:"active"});
    await page.goto(baseUrl+"/company/workers?"+filters,{waitUntil:"domcontentloaded"});
    await page.getByText("26 matching Workers",{exact:true}).waitFor();
    const next=page.getByRole("link",{name:"Next",exact:true});
    const nextQuery=new URL(await next.getAttribute("href"),baseUrl).searchParams;
    assert.equal(nextQuery.get("status"),"active","Next lost active status");
    assert.equal(nextQuery.get("q"),"Safety & Operations");
    await next.focus(); await page.keyboard.press("Enter");
    await page.getByText("Page 2 of 2",{exact:true}).waitFor();
    await page.getByText("26 matching Workers",{exact:true}).waitFor();
    assert.equal(await page.locator("tbody tr").count(),1);
    assert.equal(await page.locator("tbody tr").filter({hasText:"Safety & Operations 26"}).count(),0);
    await page.reload({waitUntil:"domcontentloaded"});
    await page.getByText("26 matching Workers",{exact:true}).waitFor();
    await page.getByRole("link",{name:"Previous",exact:true}).click();
    await page.getByText("Page 1 of 2",{exact:true}).waitFor();
    assert.equal(await page.locator("tbody tr").count(),25);
    assert.equal(new URL(page.url()).searchParams.get("status"),"active");
    savedStorage=await context.storageState();
    console.log("ACTUAL_COMPANY_HEADER_SEARCH desktop/mobile keyboard submit, scoped report, matching foreign Worker excluded, forged scope ignored, SQL-like query unmatched");
    console.log("ACTUAL_FILTERED_PAGINATION_BROWSER active26 excludesrevoked throughNextRefreshPrevious");
   } finally {await browser.close();}
  }});assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
  const denyDb=await PGlite.create(environment.HSE_PGLITE_DATA_DIR);
  try {
   await denyDb.query("INSERT INTO auth_tenant_permission_overrides(membership_id,membership_role,permission_key,effect,created_by_account_id,reason) VALUES($1,'owner','company.workforce.manage','deny',$2,'Search authorization regression fixture')",[credentials.company.membershipId,credentials.company.accountId]);
  } finally {await denyDb.close();}
  const denied=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/company/login",projectRoot:process.cwd(),environment,probe:async()=>{
   const browser=await chromium.launch({headless:true});
   try {
    const context=await browser.newContext({storageState:savedStorage}),page=await context.newPage();
    await page.goto(baseUrl+"/company/dashboard",{waitUntil:"domcontentloaded"});
    assert.equal(new URL(page.url()).pathname,"/company/dashboard");
    assert.equal(await page.locator("header.portal-header").getByRole("group",{name:"Workforce search",exact:true}).count(),0);
    await page.goto(baseUrl+"/company/workers?q=Safety",{waitUntil:"domcontentloaded"});
    await page.waitForURL("**/access-denied");
    console.log("ACTUAL_COMPANY_SEARCH_LIVE_DENIAL existing session retains portal, search hidden and direct result route denied after permission removal");
   } finally {await browser.close();}
  }});assert.equal(denied.requestedSignal,"SMOKE_COMPLETE");

 } finally {await rm(directory,{recursive:true,force:true});}
});
