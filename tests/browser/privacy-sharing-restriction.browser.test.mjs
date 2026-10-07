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

test('Worker optional sharing restriction reaches Admin fulfilment, recipient denial and server-enforced new-link refusal', {timeout:180_000}, async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hse-sharing-restriction-')),databaseDirectory=join(directory,'db'),port=await freePort(),baseUrl='http://127.0.0.1:'+port;
 const environment={...process.env,HSE_APP_ENV:'development',HSE_DATABASE_DRIVER:'pglite',HSE_PGLITE_DATA_DIR:databaseDirectory,HSE_RELEASE_SHA:'privacy-sharing-restriction-browser',HSE_SESSION_SECRET:'restriction-browser-session-secret-more-than-thirty-two',HSE_AUTH_PEPPER:'restriction-browser-auth-pepper-more-than-thirty-two',HSE_ENABLE_WORKER_DEMO_AUTH:'false',HSE_USE_WORKER_DEMO_DATA:'false',HSE_AUDIT_CREDENTIALS_PATH:join(directory,'credentials.json')};
 try {
 for(const script of ['scripts/db-migrate.mjs','scripts/independent-audit-seed.mjs']){const result=spawnSync(process.execPath,[script],{cwd:process.cwd(),env:environment,encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.stdout);}
 const credentials=JSON.parse(await readFile(environment.HSE_AUDIT_CREDENTIALS_PATH,'utf8'));
 const result=await runDevelopmentServer({args:['--hostname','127.0.0.1','--port',String(port)],probeUrl:baseUrl+'/worker/login',projectRoot:process.cwd(),environment,probe:async()=>{
 const browser=await chromium.launch({headless:true});
 const workerContext=await browser.newContext(),adminContext=await browser.newContext(),publicContext=await browser.newContext();
 try {
 const worker=await workerContext.newPage(),admin=await adminContext.newPage(),recipient=await publicContext.newPage();
 await login(worker,baseUrl,credentials.worker,'worker');await login(admin,baseUrl,credentials.admin,'admin');
 await worker.goto(baseUrl+'/worker/share-links');await worker.getByLabel('Purpose',{exact:true}).fill('Restriction browser owned sharing');
 await worker.getByRole('button',{name:'Create secure link',exact:true}).click();
 const link=worker.getByRole('link',{name:'Open secure share link',exact:true});await link.waitFor();const url=await link.getAttribute('href');assert.ok(url);
 await recipient.goto(baseUrl+url);await recipient.getByRole('heading',{name:'Shared digital passport',exact:true}).waitFor();
 await worker.goto(baseUrl+'/worker/privacy');await worker.getByLabel('Privacy request type').selectOption('restriction');await worker.getByRole('button',{name:'Submit privacy request',exact:true}).click();
 await worker.getByText('restriction: OPEN',{exact:true}).waitFor();
 await admin.goto(baseUrl+'/admin/privacy');const card=admin.locator('article').filter({hasText:'Request type: restriction'});
 await card.getByText('Status: OPEN',{exact:true}).waitFor();
 const actionFields=await card.locator('form').evaluate(form=>Object.fromEntries([...new FormData(form).entries()].map(([key,value])=>[key,String(value)])));
 const denied=await worker.request.post(baseUrl+'/admin/privacy',{multipart:{...actionFields,decision:'COMPLETED',reason:'Unauthorized Worker must never complete a privacy restriction.'},maxRedirects:0});assert.equal(denied.status(),303);assert.equal(new URL(denied.headers().location,baseUrl).pathname,'/access-denied');
 await admin.reload();await card.getByText('Status: OPEN',{exact:true}).waitFor();
 await card.getByLabel('Request decision').selectOption('COMPLETED');await card.getByLabel('Request review reason').fill('Restrict optional sharing while preserving required case processing and retained evidence.');
 await card.getByRole('button',{name:'Save privacy request decision',exact:true}).click();await card.getByText('Status: COMPLETED',{exact:true}).waitFor();
 await worker.reload();await worker.getByText('restriction: COMPLETED',{exact:true}).waitFor();
 await recipient.reload();await recipient.getByRole('heading',{name:'Share link unavailable',exact:true}).waitFor();
 await worker.goto(baseUrl+'/worker/share-links');assert.equal(await worker.getByRole('button',{name:'Create secure link',exact:true}).isDisabled(),true);
 await worker.getByText('Optional sharing is restricted. Existing links are revoked and new share links are unavailable.',{exact:true}).waitFor();
 const refused=await worker.request.post(baseUrl+'/api/share-links',{data:{fields:['worker_id'],purpose:'Forged client bypass',createdAt:new Date().toISOString(),expiresAt:null}});assert.equal(refused.status(),403);assert.deepEqual(await refused.json(),{error:'optional_sharing_restricted'});
 await worker.goto(baseUrl+'/worker/privacy');await worker.getByLabel('Privacy request type').selectOption('correction');await worker.getByRole('button',{name:'Submit privacy request',exact:true}).click();await worker.getByText('correction: OPEN',{exact:true}).waitFor();
 await admin.goto(baseUrl+'/admin/privacy');const staleCard=admin.locator('article').filter({hasText:'Request type: correction'});await staleCard.getByText('Status: OPEN',{exact:true}).waitFor();
 const staleFields=await staleCard.locator('form').evaluate(form=>Object.fromEntries([...new FormData(form).entries()].map(([key,value])=>[key,String(value)])));
 const staleCookies=await adminContext.cookies();await admin.goto(baseUrl+'/account/sessions');await admin.getByRole('button',{name:'Sign out this session',exact:true}).click();await admin.waitForURL(url=>url.pathname==='/admin/login');
 await adminContext.addCookies(staleCookies);const staleResponse=await admin.request.post(baseUrl+'/admin/privacy',{multipart:{...staleFields,decision:'REJECTED',reason:'Revoked Admin session must not record a review decision.'},maxRedirects:0});assert.equal(staleResponse.status(),303);const deniedLogin=new URL(staleResponse.headers().location,baseUrl);assert.equal(deniedLogin.pathname,'/admin/login');assert.equal(deniedLogin.searchParams.get('reason'),'session-required');
 await worker.reload();await worker.getByText('correction: OPEN',{exact:true}).waitFor();
 console.log('ACTUAL_RESTRICTION_BROWSER valid link -> trusted request -> unauthorized Worker review denied -> Admin completion -> recipient denial -> disabled form and real403 issuance refusal');
 }finally{await workerContext.close();await adminContext.close();await publicContext.close();await browser.close();}
 }});assert.equal(result.requestedSignal,'SMOKE_COMPLETE');
 const db=new PGlite(databaseDirectory);try {
 const requests=(await db.query("SELECT status,details FROM privacy_requests WHERE worker_id=$1 AND request_type='restriction'",[credentials.worker.accountId])).rows;assert.equal(requests.length,1);assert.equal(requests[0].status,'COMPLETED');assert.equal(requests[0].details.fulfilment.method,'optional_sharing_restriction');
 assert.equal((await db.query("SELECT count(*)::int n FROM scoped_share_links WHERE purpose='Forged client bypass'")).rows[0].n,0);
 assert.equal((await db.query("SELECT count(*)::int n FROM privacy_requests WHERE worker_id=$1 AND request_type='correction' AND status='OPEN'",[credentials.worker.accountId])).rows[0].n,1);
 assert.equal((await db.query("SELECT count(*)::int n FROM privacy_request_reviews reviews JOIN privacy_requests requests USING(request_id) WHERE requests.worker_id=$1 AND requests.request_type='correction'",[credentials.worker.accountId])).rows[0].n,0);
 const history=(await db.query("SELECT reviewer_account_id FROM privacy_request_reviews WHERE request_id=(SELECT request_id FROM privacy_requests WHERE worker_id=$1 AND request_type='restriction')",[credentials.worker.accountId])).rows;assert.equal(history.length,1);assert.equal(history[0].reviewer_account_id,credentials.admin.accountId);
 }finally{await db.close();}
 }finally{await rm(directory,{recursive:true,force:true});}
});
