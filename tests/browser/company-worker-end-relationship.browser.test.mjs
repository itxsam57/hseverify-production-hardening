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




test("Company ends active Worker relationship while Worker retains identity and prior Company history", {timeout:210000}, async()=>{
 const directory=await mkdtemp(join(tmpdir(),"hse-a09-end-link-")),port=await freePort(),baseUrl="http://127.0.0.1:"+port;
 const environment={...process.env,HSE_APP_ENV:"development",HSE_DATABASE_DRIVER:"pglite",HSE_PGLITE_DATA_DIR:join(directory,"db"),
   HSE_RELEASE_SHA:"a09-end-company-link",HSE_SESSION_SECRET:"a09-end-link-session-secret-longer-than-thirty-two",
   HSE_AUTH_PEPPER:"a09-end-link-auth-pepper-longer-than-thirty-two",HSE_ENABLE_WORKER_DEMO_AUTH:"false",
   HSE_USE_WORKER_DEMO_DATA:"false",HSE_AUDIT_CREDENTIALS_PATH:join(directory,"credentials.json")};
 const linkId="company_worker_link_"+("R".repeat(24)),invitationId="worker_invitation_"+("R".repeat(24));
 try{
  for(const script of ["scripts/db-migrate.mjs","scripts/independent-audit-seed.mjs"]){
   const r=spawnSync(process.execPath,[script],{cwd:process.cwd(),env:environment,encoding:"utf8",timeout:60000});
   assert.equal(r.status,0,script+" "+(r.stderr||r.stdout).slice(-1500));
  }
  const identities=JSON.parse(await readFile(environment.HSE_AUDIT_CREDENTIALS_PATH,"utf8"));
  let originalWorkerId;
  const database=await PGlite.create(environment.HSE_PGLITE_DATA_DIR);
  try{
   const now=new Date().toISOString(),expiry=new Date(Date.now()+86400000).toISOString();
   originalWorkerId=identities.worker.accountId;
   await database.query("INSERT INTO company_worker_invitations(invitation_id,tenant_id,email_normalized,token_hash,invitation_status,invited_by_membership_id,accepted_by_worker_account_id,resend_available_at,expires_at,accepted_at,created_at,updated_at) VALUES($1,$2,$3,$4,'accepted',$5,$6,$7,$8,$7,$7,$7)",
     [invitationId,identities.company.tenantId,identities.worker.email.toLowerCase(),"a09-test-hash-R",identities.company.membershipId,originalWorkerId,now,expiry]);
   await database.query("INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,link_source,invitation_id,link_status,worker_accepted_at,activated_at,created_at,updated_at) VALUES($1,$2,$3,'invitation',$4,'active',$5,$5,$5,$5)",
     [linkId,identities.company.tenantId,originalWorkerId,invitationId,now]);
  }finally{await database.close();}
  const result=await runDevelopmentServer({args:["--hostname","127.0.0.1","--port",String(port)],probeUrl:baseUrl+"/company/login",projectRoot:process.cwd(),environment,
   probe:async()=>{
    const browser=await chromium.launch({headless:true});
    try{
     const company=await browser.newPage(),worker=await browser.newPage();
     await login(company,baseUrl,identities.company,"company");
     await login(worker,baseUrl,identities.worker,"worker");
     await worker.goto(baseUrl+"/worker/company-access");
     const active=worker.locator('section[aria-labelledby="active-company-links-heading"]');
     await active.getByText("active",{exact:true}).waitFor();
     await company.goto(baseUrl+"/company/workers/"+linkId);
     await company.getByRole("heading",{name:"End Company relationship",exact:true}).waitFor();
     await company.getByLabel("Reason for ending relationship").fill("Contract finished after project completion.");
     await company.getByLabel("I confirm the Company relationship will end immediately.").check();
     await company.getByRole("button",{name:"End relationship",exact:true}).click();
     await company.getByText("This Company relationship has ended. The Worker identity and prior history remain intact.",{exact:true}).waitFor({timeout:20000});
     assert.equal(await company.getByRole("button",{name:"End relationship",exact:true}).count(),0);
     await company.reload();
     await company.getByText("revoked",{exact:true}).waitFor();
     assert.equal(await company.getByRole("heading",{name:"End Company relationship",exact:true}).count(),0);
     await worker.goto(baseUrl+"/worker/company-access");
     const historical=worker.locator('section[aria-labelledby="historical-company-links-heading"]');
     await historical.getByText("revoked",{exact:true}).waitFor({timeout:20000});
     await worker.getByText("You are not currently linked to a Company through M1.10.",{exact:true}).waitFor();
     await worker.goto(baseUrl+"/worker/dashboard");
     await worker.getByRole("heading",{level:1,name:/Welcome,/}).waitFor();
     console.log("A09_END_LINK_BROWSER Company reasoned revocation -> Worker historical link, active access removed, authenticated Worker retained");
    }finally{await browser.close();}
   }});
  assert.equal(result.requestedSignal,"SMOKE_COMPLETE");
  const verify=await PGlite.create(environment.HSE_PGLITE_DATA_DIR);
  try{
   const rows=(await verify.query("SELECT link_status,revoked_at,worker_account_id FROM company_worker_links WHERE link_id=$1",[linkId])).rows;
   assert.equal(rows[0].link_status,"revoked");
   assert.ok(rows[0].revoked_at);
   assert.equal(rows[0].worker_account_id,originalWorkerId);
   assert.equal((await verify.query("SELECT account_status FROM auth_accounts WHERE account_id=$1",[originalWorkerId])).rows[0].account_status,"active");
   const audit=(await verify.query("SELECT metadata FROM platform_audit_events WHERE action_key='company_workforce.link.revoked' AND target_reference=$1",[linkId])).rows;
   assert.equal(audit.length,1);
   const metadata=typeof audit[0].metadata==="string"?JSON.parse(audit[0].metadata):audit[0].metadata;
   assert.equal(metadata.reason,"Contract finished after project completion.");
   console.log("A09_END_LINK_DB immutable single audit and Worker principal unchanged");
  }finally{await verify.close();}
 }finally{await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
});
