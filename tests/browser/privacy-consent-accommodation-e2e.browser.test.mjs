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

const CONSENT_REQUEST_MODE = process.env.HSE_PRIVACY_CONSENT_REQUEST === "true";
const DATA_MODE = process.env.HSE_PRIVACY_DATA_DOWNLOAD === "true";
const EXPIRY_MODE = process.env.HSE_SHARE_EXPIRY === "true";
const DIRECT_MODE = process.env.HSE_DIRECT_SHARE_REVOCATION === "true";
const FULFILMENT_MODE = process.env.HSE_PRIVACY_FULFILMENT === "true";
const EXTRA_PRIVACY_TYPES = ["access","correction","consent_withdrawal","share_link_revocation","retention_inquiry","export","deletion"];

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
async function seedCase(dataDirectory, tenantId, workerId) {
  const db = new PGlite(dataDirectory);
  try {
    const orderId = "assurance_order_" + "p".repeat(24);
    const targetId = "assurance_target_" + "q".repeat(24);
    const caseId = "assurance_case_" + "r".repeat(24);
    const linkId = "worker_link_privacy_e2e";
    await db.query(
      `INSERT INTO assurance_orders(
         order_id,tenant_id,created_by_membership_id,order_name,order_reference,order_status
       ) VALUES($1,$2,$3,'Accessible Assurance','PRIV-E2E','DRAFT')`,
      [orderId, tenantId, "membership_privacy_e2e_owner"]
    );
    await db.query(
      `INSERT INTO assurance_order_workers(
         target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,target_status
       ) VALUES($1,$2,$3,$4,$5,'company','eligible')`,
      [targetId, orderId, tenantId, linkId, workerId]
    );
    await db.query(
      `INSERT INTO assurance_cases(
         case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,
         case_status,owner_kind,next_action
       ) VALUES($1,$2,$3,$4,$5,$6,'Assessment pending','worker','Complete the assigned assessment.')`,
      [caseId, orderId, targetId, tenantId, linkId, workerId]
    );
    return caseId;
  } finally {
    await db.close();
  }
}

test(CONSENT_REQUEST_MODE ? "Worker scoped-consent withdrawal request reaches staff fulfilment and denies recipient access" : DATA_MODE ? "Worker access/export request reaches reviewed owner-only JSON download" : DIRECT_MODE ? "Worker direct revocation uses server time and preserves the first outcome" : EXPIRY_MODE ? "Natural share-link expiry denies a previously working recipient and preserves unrelated sharing" : FULFILMENT_MODE ? "Worker share-link revocation request reaches staff fulfilment and removes recipient access" : "Worker privacy request and accommodation approval traverse Worker -> Admin -> Worker with consent history", { timeout: 300_000 }, async () => {
  const root = process.cwd();
  let shortExpiry;
  let directRevokedAt;
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-privacy-browser-"));
  const port = await freePort();
  const baseUrl = "http://127.0.0.1:" + port;
  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: databaseDirectory,
    HSE_RELEASE_SHA: "privacy-browser-e2e",
    HSE_SESSION_SECRET: "privacy-browser-session-secret-2026-more-than-thirty-two",
    HSE_AUTH_PEPPER: "privacy-browser-auth-pepper-2026-more-than-thirty-two",
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false"
  };

  try {
    const migration = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], {
      cwd: root, env: environment, encoding: "utf8"
    });
    assert.equal(migration.status, 0, migration.stderr || migration.stdout);
    const seed = spawnSync(process.execPath, ["scripts/independent-audit-seed.mjs"], {
      cwd: root, env: environment, encoding: "utf8"
    });
    assert.equal(seed.status, 0, seed.stderr || seed.stdout);
    const credentials = JSON.parse(await readFile("/tmp/independent-audit-credentials.json", "utf8"));
    const caseId = await seedCase(
      databaseDirectory,
      credentials.company.tenantId,
      credentials.worker.accountId
    );

    if (DATA_MODE) {
      const db = new PGlite(databaseDirectory);
      try {
        await db.query(`INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,
          password_hash,email_verified_at,password_set_at,worker_reference,created_at,updated_at)
          SELECT 'privacy_download_foreign_worker','privacy-download-foreign@example.test','Foreign privacy Worker',
          'active',password_hash,email_verified_at,password_set_at,'privacy_download_foreign_ref',created_at,updated_at
          FROM auth_accounts WHERE account_id=$1`,[credentials.worker.accountId]);
        await db.query("INSERT INTO auth_account_roles(account_id,role) VALUES('privacy_download_foreign_worker','worker')");
        for (const accountId of [credentials.worker.accountId,"privacy_download_foreign_worker"]) {
          const account=(await db.query("SELECT worker_reference FROM auth_accounts WHERE account_id=$1",[accountId])).rows[0];
          const now=new Date().toISOString();
          const document={schemaVersion:1,workerSub:accountId,workerId:account.worker_reference,version:1,status:"draft",
            personal:{legalFirstName:"Provided-"+accountId},contact:{city:"Home-"+accountId},
            professional:{jobTitle:"Role-"+accountId},createdAt:now,updatedAt:now,submittedAt:null,
            audit:[{private:"INTERNAL_PROFILE_AUDIT_SENTINEL"}]};
          await db.query(`INSERT INTO worker_profiles(worker_sub,worker_id,schema_version,version,status,
            profile_document,created_at,updated_at,submitted_at)
            SELECT account_id,worker_reference,1,1,'draft',$2::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,NULL
            FROM auth_accounts WHERE account_id=$1
            ON CONFLICT(worker_sub) DO UPDATE SET profile_document=EXCLUDED.profile_document`,[accountId,JSON.stringify(document)]);
        }
      } finally { await db.close(); }
    }
    const result = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: baseUrl + "/worker/login",
      projectRoot: root,
      environment,
      probe: async () => {
        const browser = await chromium.launch({ headless: true });
        const workerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        const worker = await workerContext.newPage();
        const admin = await adminContext.newPage();
        try {
          await login(worker, baseUrl, credentials.worker, "worker");
          if (DATA_MODE) {
            await login(admin,baseUrl,credentials.admin,"admin");
            const foreignContext=await browser.newContext(), publicContext=await browser.newContext();
            try {
              const foreign=await foreignContext.newPage();
              await login(foreign,baseUrl,{...credentials.worker,email:"privacy-download-foreign@example.test"},"worker");
              for (const type of ["access","export"]) {
                await worker.goto(baseUrl+"/worker/privacy");
                await worker.getByLabel("Privacy request type").selectOption(type);
                await worker.getByRole("button",{name:"Submit privacy request",exact:true}).click();
                const own=worker.locator("article").filter({hasText:type+": OPEN"});
                await own.waitFor();
                assert.equal(await own.getByRole("link",{name:"Download your current data (JSON)",exact:true}).count(),0);
                await admin.goto(baseUrl+"/admin/privacy");
                const card=admin.locator("article").filter({hasText:"Request type: "+type});
                const requestId=await card.locator('input[name="requestId"]').inputValue();
                const url=baseUrl+"/api/privacy/requests/"+encodeURIComponent(requestId)+"/download";
                const open=await worker.request.get(url);assert.equal(open.status(),404);
                await card.getByLabel("Request decision").selectOption("PROCESSING");
                await card.getByLabel("Request review reason").fill("Review the Worker own current account and workflow data.");
                await card.getByRole("button",{name:"Save privacy request decision",exact:true}).click();
                await card.getByText("Status: PROCESSING",{exact:true}).waitFor();
                await card.getByLabel("Request decision").selectOption("COMPLETED");
                await card.getByLabel("Request review reason").fill("Prepared the Worker own current account and workflow JSON download.");
                await card.getByRole("button",{name:"Save privacy request decision",exact:true}).click();
                await card.getByText("Status: COMPLETED",{exact:true}).waitFor();
                await worker.reload();
                const done=worker.locator("article").filter({hasText:type+": COMPLETED"});
                const link=done.getByRole("link",{name:"Download your current data (JSON)",exact:true});
                await link.waitFor();assert.equal(await link.getAttribute("href"),new URL(url).pathname);
                const response=await worker.request.get(url);assert.equal(response.status(),200);
                assert.equal(response.headers()["cache-control"],"private, no-store");
                assert.equal(response.headers()["x-content-type-options"],"nosniff");
                assert.match(response.headers()["content-disposition"],/attachment/);
                const data=await response.json();assert.equal(data.account.account_id,credentials.worker.accountId);
                assert.equal(data.account.email_normalized,credentials.worker.email.toLowerCase());
                assert.equal(data.workerProfile.personal.legalFirstName,"Provided-"+credentials.worker.accountId);
                assert.equal(data.workerProfile.contact.city,"Home-"+credentials.worker.accountId);
                assert.equal(data.workerProfile.professional.jobTitle,"Role-"+credentials.worker.accountId);
                assert.equal(JSON.stringify(data).includes("privacy_download_foreign_worker"),false);
                assert.equal(JSON.stringify(data).includes("INTERNAL_PROFILE_AUDIT_SENTINEL"),false);
                for(const secret of ["password_hash","token_nonce_hash","privacy-download-foreign@example.test"])
                  assert.equal(JSON.stringify(data).includes(secret),false,secret);
                assert.equal((await foreign.request.get(url)).status(),404);
                const anonymous=await publicContext.request.get(url,{maxRedirects:0});
                assert.notEqual(anonymous.status(),200);
                const staff=await admin.request.get(url,{maxRedirects:0});assert.notEqual(staff.status(),200);
                const missing=await worker.request.get(baseUrl+"/api/privacy/requests/missing/download");
                assert.equal(missing.status(),404);assert.deepEqual(await missing.json(),{error:"worker_data_unavailable"});
                // Verify the visible link produces an actual browser attachment.
                const downloadPromise=worker.waitForEvent("download");
                await link.click();const download=await downloadPromise;
                assert.equal(download.suggestedFilename(),"hse-verify-personal-data.json");
                assert.equal(await download.failure(),null);
              }
              console.log("ACTUAL_PRIVACY_DATA_BROWSER access/export Worker -> Admin processing/completion -> real JSON attachment; foreign, anonymous, staff and open requests denied");
              return;
            } finally {await foreignContext.close();await publicContext.close();}
          }
          await worker.route("**/api/share-links", async (route) => {
            if (route.request().method() !== "POST") return route.continue();
            const body = route.request().postDataJSON();
            if (EXPIRY_MODE && body.purpose === "Employer onboarding evidence") { shortExpiry = new Date(Date.now()+90000).toISOString(); body.expiresAt = shortExpiry; }
            await route.continue({ postData: JSON.stringify({ ...body, createdAt: "2099-01-01T00:00:00.000Z" }) });
          });


          await worker.goto(baseUrl + "/worker/privacy", { waitUntil: "domcontentloaded" });
          await worker.getByLabel("Privacy request type").selectOption("restriction");
          await worker.getByRole("button", { name: "Submit privacy request" }).click();
          await worker.getByText("restriction: OPEN", { exact: true }).waitFor({ timeout: 15_000 });
          for(const type of EXTRA_PRIVACY_TYPES) {
            await worker.getByLabel("Privacy request type").selectOption(type);
            await worker.getByRole("button",{name:"Submit privacy request",exact:true}).click();
            await worker.getByText(type.replaceAll("_"," ")+": OPEN",{exact:true}).waitFor({timeout:15000});
          }


          await worker.getByLabel("Accommodation request").fill("Extra reading time and captions");
          await worker.getByRole("button", { name: "Submit accommodation" }).click();
          await worker.getByText("Extra reading time and captions", { exact: true }).waitFor({ timeout: 15_000 });
          await worker.getByText("Status: REQUESTED", { exact: true }).waitFor();

          await worker.goto(baseUrl + "/worker/share-links", { waitUntil: "domcontentloaded" });
          await worker.getByLabel("Purpose").fill("Employer onboarding evidence");
          await worker.getByRole("button", { name: "Create secure link" }).click();
          await worker.getByText("Share link created.", { exact: false }).waitFor({ timeout: 15_000 });

          const shareUrl = await worker.getByRole("link", { name: "Open secure share link" }).getAttribute("href");
          assert.ok(shareUrl);
          await worker.getByLabel("Purpose").fill("Separate optional sharing remains active");
          await worker.getByRole("button", { name: "Create secure link" }).click();
          await worker.waitForFunction(previous => {
            const href = document.querySelector('section[aria-label="New secure share link"] a')?.getAttribute("href");
            return typeof href === "string" && href !== previous;
          }, shareUrl);
          const otherShareUrl = await worker.getByRole("link", { name: "Open secure share link" }).getAttribute("href");
          assert.ok(otherShareUrl);
          assert.notEqual(otherShareUrl, shareUrl);
          if (DIRECT_MODE) {
            const publicContext = await browser.newContext();
            try {
              const recipient = await publicContext.newPage();
              await recipient.goto(baseUrl + shareUrl);
              await recipient.getByRole("heading", { name: "Shared digital passport", exact: true }).waitFor();
              await worker.route("**/api/share-links", async route => {
                if (route.request().method() !== "DELETE") return route.continue();
                const body=route.request().postDataJSON();
                await route.continue({postData:JSON.stringify({...body,revokedAt:"2099-01-01T00:00:00.000Z"})});
              });
              const before=Date.now();
              const responsePromise=worker.waitForResponse(response=>response.url().endsWith("/api/share-links")&&response.request().method()==="DELETE");
              const card=worker.locator("article").filter({hasText:"Employer onboarding evidence"});
              await card.getByRole("button",{name:"Revoke",exact:true}).click();
              const response=await responsePromise;
              assert.equal(response.status(),200);
              const payload=await response.json();
              const recorded=new Date(payload.revokedAt).getTime();
              assert.ok(recorded>=before&&recorded<=Date.now(),"Revocation timestamp must be derived by the server, not the forged future client value.");
              directRevokedAt=payload.revokedAt;
              await card.getByText("Revoked",{exact:true}).waitFor();
              const repeat=await worker.request.delete(baseUrl+"/api/share-links",{data:{shareLinkId:payload.shareLinkId,revokedAt:"2100-01-01T00:00:00.000Z"}});
              assert.equal(repeat.status(),200);
              assert.equal((await repeat.json()).revokedAt,directRevokedAt);
              await worker.reload();
              await card.getByText("Revoked",{exact:true}).waitFor();
              await recipient.goto(baseUrl+shareUrl);
              await recipient.getByRole("heading",{name:"Share link unavailable",exact:true}).waitFor();
              await recipient.goto(baseUrl+otherShareUrl);
              await recipient.getByRole("heading",{name:"Shared digital passport",exact:true}).waitFor();
              console.log("ACTUAL_DIRECT_REVOCATION browser forged future timestamp ignored; prior recipient denied and unrelated sharing active");
              return;
            } finally {await publicContext.close();}
          }
          if (EXPIRY_MODE) {
            assert.ok(shortExpiry);
            const publicContext = await browser.newContext();
            try {
              const recipient = await publicContext.newPage();
              await recipient.goto(baseUrl + shareUrl);
              await recipient.getByRole("heading", { name: "Shared digital passport", exact: true }).waitFor();
              await recipient.goto(baseUrl + otherShareUrl);
              await recipient.getByRole("heading", { name: "Shared digital passport", exact: true }).waitFor();
              const wait = new Date(shortExpiry).getTime() - Date.now() + 1000;
              assert.ok(wait > 0 && wait <= 91000, "Initial working recipient must precede real expiry.");
              console.log("ACTUAL_EXPIRY_INITIAL both recipients work before persisted 90-second expiry; waiting natural wall clock");
              await new Promise(resolve => setTimeout(resolve, wait));
              await recipient.goto(baseUrl + shareUrl);
              await recipient.getByRole("heading", { name: "Share link unavailable", exact: true }).waitFor();
              await recipient.goto(baseUrl + shareUrl);
              await recipient.getByRole("heading", { name: "Share link unavailable", exact: true }).waitFor();
              await recipient.goto(baseUrl + otherShareUrl);
              await recipient.getByRole("heading", { name: "Shared digital passport", exact: true }).waitFor();
              await worker.reload();
              const expired = worker.locator("article").filter({ hasText: "Employer onboarding evidence" });
              await expired.getByText("Expired", { exact: true }).waitFor();
              assert.equal(await expired.getByRole("button", { name: "Revoke", exact: true }).count(), 0);
              const active = worker.locator("article").filter({ hasText: "Separate optional sharing remains active" });
              await active.getByText("Active", { exact: true }).waitFor();
              console.log("ACTUAL_EXPIRY_BROWSER prior recipient denied twice after real expiry; unrelated sharing active; owner sees Expired");
              return;
            } finally { await publicContext.close(); }
          }
          if (FULFILMENT_MODE || CONSENT_REQUEST_MODE) {
            const requestType = CONSENT_REQUEST_MODE ? "consent_withdrawal" : "share_link_revocation";
            const requestLabel = requestType.replaceAll("_"," ");
            const completionReason = CONSENT_REQUEST_MODE
              ? "Withdrew the requested optional sharing consent and confirmed recipient access is denied."
              : "Revoked the requested optional share link and confirmed recipient access is denied.";
            const publicContext = await browser.newContext();
            try {
              const recipient = await publicContext.newPage();
              await recipient.goto(baseUrl + otherShareUrl);
              await recipient.getByRole("heading", { name: "Shared digital passport", exact: true }).waitFor();
              await worker.goto(baseUrl + "/worker/privacy");
              await worker.getByLabel("Privacy request type").selectOption(requestType);
              await worker.getByLabel(CONSENT_REQUEST_MODE ? "Optional sharing consent for a withdrawal request" : "Share link for a revocation request").selectOption({ label: "Separate optional sharing remains active" });
              await worker.getByRole("button", { name: "Submit privacy request", exact: true }).click();
              const workerRequest = worker.getByRole("heading", { name: "Your privacy requests", exact: true }).locator("..").locator("article").filter({ hasText: "Share link: Separate optional sharing remains active" });
              await workerRequest.getByText(requestLabel+": OPEN", { exact: true }).waitFor();
              await login(admin, baseUrl, credentials.admin, "admin");
              await admin.goto(baseUrl + "/admin/privacy");
              const requestCard = admin.locator("article").filter({ hasText: "Request type: "+requestLabel }).filter({ hasText: "Share link: Separate optional sharing remains active" });
              assert.equal(await requestCard.count(), 1);
              await requestCard.getByLabel("Request decision").selectOption("PROCESSING");
              await requestCard.getByLabel("Request review reason").fill("Confirming this optional share link is the Worker's requested target.");
              await requestCard.getByRole("button", { name: "Save privacy request decision", exact: true }).click();
              await requestCard.getByText("Status: PROCESSING", { exact: true }).waitFor();
              await worker.reload();
              await workerRequest.getByText(requestLabel+": PROCESSING", { exact: true }).waitFor();
              await requestCard.getByLabel("Request decision").selectOption("COMPLETED");
              await requestCard.getByLabel("Request review reason").fill(completionReason);
              await requestCard.getByRole("button", { name: "Save privacy request decision", exact: true }).click();
              await requestCard.getByText("Status: COMPLETED", { exact: true }).waitFor();
              assert.equal(await requestCard.getByRole("button", { name: "Save privacy request decision", exact: true }).count(), 0);
              await worker.reload();
              await workerRequest.getByText(requestLabel+": COMPLETED", { exact: true }).waitFor();
              await workerRequest.getByText("Review outcome: "+completionReason, { exact: true }).waitFor();
              await recipient.goto(baseUrl + otherShareUrl);
              await recipient.getByRole("heading", { name: "Share link unavailable", exact: true }).waitFor();
              await recipient.goto(baseUrl + shareUrl);
              await recipient.getByRole("heading", { name: "Shared digital passport", exact: true }).waitFor();
              if (CONSENT_REQUEST_MODE) {
                const consentCard = worker.getByRole("heading",{name:"Current consent state",exact:true}).locator("..").locator("article").filter({hasText:"Share link purpose: Separate optional sharing remains active"});
                await consentCard.getByText("Status: WITHDRAWN · Version 2",{exact:true}).waitFor();
              }
              await worker.goto(baseUrl + "/admin/privacy");
              await worker.waitForURL("**/access-denied");
              console.log(CONSENT_REQUEST_MODE ? "ACTUAL_CONSENT_REQUEST_BROWSER owned selected consent -> staff processing -> operative withdrawal/revocation -> Worker withdrawn outcome; prior recipient denied and unrelated consent retained" : "ACTUAL_PRIVACY_FULFILMENT_BROWSER owned request -> staff processing -> real revocation/completion -> Worker outcome; prior recipient denied, unrelated link active, Worker denied staff route");
              return;
            } finally { await publicContext.close(); }
          }

          const publicContext = await browser.newContext();
          try {
            const recipient = await publicContext.newPage();
            await recipient.goto(baseUrl + shareUrl);
            await recipient.getByRole("heading", { name: "Shared digital passport", exact: true }).waitFor({ timeout: 10_000 });
            await worker.goto(baseUrl + "/worker/privacy");
            const consentCard = worker.locator("article").filter({ hasText: "Employer onboarding evidence" }).first();
            await consentCard.getByLabel("Withdrawal reason").fill("Withdraw optional employer onboarding sharing.");
            await consentCard.getByRole("button", { name: "Withdraw future processing consent" }).click();
            await consentCard.getByText(/Status: WITHDRAWN/).waitFor({ timeout: 10_000 });
            await recipient.goto(baseUrl + shareUrl);
            await recipient.getByRole("heading", { name: "Share link unavailable", exact: true }).waitFor({ timeout: 5_000 });
            await recipient.goto(baseUrl + otherShareUrl);
            await recipient.getByRole("heading", { name: "Shared digital passport", exact: true }).waitFor({ timeout: 5_000 });
          } finally { await publicContext.close(); }
          await worker.goto(baseUrl + "/admin/privacy", { waitUntil: "domcontentloaded" });
          await worker.waitForURL("**/access-denied", { timeout: 15_000 });
          assert.equal(await worker.getByRole("heading", { name: "Privacy requests", exact: true }).count(), 0);
          await login(admin, baseUrl, credentials.admin, "admin");
          await admin.goto(baseUrl + "/admin/privacy", { waitUntil: "domcontentloaded" });
          await admin.getByRole("heading", { name: "Privacy requests", exact: true }).waitFor();
          for(const type of EXTRA_PRIVACY_TYPES) {
            const card=admin.locator("article").filter({has:admin.getByText("Request type: "+type.replaceAll("_"," "),{exact:true})});
            await card.getByText("Status: OPEN",{exact:true}).waitFor();
            await card.getByLabel("Request decision").selectOption("REJECTED");
            const reason="This synthetic "+type+" request is declined pending required request details.";
            await card.getByLabel("Request review reason").fill(reason);
            await card.getByRole("button",{name:"Save privacy request decision",exact:true}).click();
            await card.getByText("Status: REJECTED",{exact:true}).waitFor();
            await worker.goto(baseUrl+"/worker/privacy");
            await worker.getByText(type.replaceAll("_"," ")+": REJECTED",{exact:true}).waitFor();
            await worker.getByText("Review outcome: "+reason,{exact:true}).waitFor();
          }
          const privacyCard = admin.locator("article").filter({ hasText: "Request type: restriction" }).first();
          await privacyCard.getByLabel("Request decision").selectOption("PROCESSING");
          await privacyCard.getByLabel("Request review reason").fill("Reviewing the processing purpose and required retained evidence.");
          await privacyCard.getByRole("button", { name: "Save privacy request decision" }).click();
          await privacyCard.getByText("Status: PROCESSING", { exact: true }).waitFor();
          await worker.goto(baseUrl + "/worker/privacy", { waitUntil: "domcontentloaded" });
          await worker.getByText("restriction: PROCESSING", { exact: true }).waitFor();
          await worker.getByText("Reviewing the processing purpose and required retained evidence.", { exact: false }).waitFor();
          await privacyCard.getByLabel("Request decision").selectOption("REJECTED");
          await privacyCard.getByLabel("Request review reason").fill("Required assessment evidence remains retained; optional sharing can be revoked separately.");
          await privacyCard.getByRole("button", { name: "Save privacy request decision" }).click();
          await privacyCard.getByText("Status: REJECTED", { exact: true }).waitFor();
          await worker.goto(baseUrl + "/worker/privacy", { waitUntil: "domcontentloaded" });
          await worker.getByText("restriction: REJECTED", { exact: true }).waitFor();
          await worker.getByText("Required assessment evidence remains retained; optional sharing can be revoked separately.", { exact: false }).waitFor();
          await privacyCard.getByRole("button", { name: "Save privacy request decision" }).count().then(count => assert.equal(count, 0));
          const card = admin.locator("article").filter({ hasText: "Extra reading time and captions" }).first();
          await card.getByLabel("Assurance Case").selectOption(caseId);
          await card.getByLabel("Time multiplier").fill("1.5");
          await card.getByLabel("Extra break minutes").fill("15");
          await card.getByText("Captions", { exact: true }).locator("input").check();
          await card.getByLabel("Review reason").fill(
            "Approved accessible delivery conditions without changing competency standards."
          );
          await card.getByRole("button", { name: "Save accommodation decision" }).click();
          await admin.getByText("Status: APPROVED", { exact: true }).waitFor({ timeout: 15_000 });

          await worker.goto(baseUrl + "/worker/privacy", { waitUntil: "domcontentloaded" });
          const approved = worker.locator("article").filter({ hasText: "Extra reading time and captions" }).first();
          await approved.getByText("Status: APPROVED", { exact: true }).waitFor({ timeout: 15_000 });
          await approved.getByText(caseId, { exact: false }).waitFor();
          await worker.getByLabel("Accommodation request").fill("Alternative delivery decline verification");
          await worker.getByRole("button",{name:"Submit accommodation",exact:true}).click();
          await worker.locator("article").filter({hasText:"Alternative delivery decline verification"}).getByText("Status: REQUESTED",{exact:true}).waitFor();
          await admin.reload();
          const declineCard=admin.locator("article").filter({hasText:"Alternative delivery decline verification"});
          assert.equal(await declineCard.count(),1,"Decline request did not reach staff intake: "+await admin.locator("body").innerText());
          await declineCard.locator('select[name="decision"]').selectOption("DECLINED");
          await declineCard.getByLabel("Review reason",{exact:true}).fill("This request is declined because the requested format does not meet the assessment accessibility need.");
          await declineCard.getByRole("button",{name:"Save accommodation decision",exact:true}).click();
          await declineCard.getByText("Status: DECLINED",{exact:true}).waitFor();
          await worker.reload();
          const declinedWorkerCard=worker.locator("article").filter({hasText:"Alternative delivery decline verification"});
          await declinedWorkerCard.getByText("Status: DECLINED",{exact:true}).waitFor();
          await declinedWorkerCard.getByText("Review outcome: This request is declined because the requested format does not meet the assessment accessibility need.",{exact:true}).waitFor();

          await worker.getByText("scoped share links", { exact: true }).first().waitFor({ timeout: 15_000 });
          await worker.getByText("GRANTED", { exact: false }).first().waitFor();
        } finally {
          await workerContext.close();
          await adminContext.close();
          await browser.close();
        }
      }
    });
    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");

    const db = new PGlite(databaseDirectory);
    try {
      if (DATA_MODE) {
        const requests=await db.query("SELECT request_id,request_type,status,details,completed_at FROM privacy_requests WHERE worker_id=$1",[credentials.worker.accountId]);
        assert.equal(requests.rows.length,2);
        assert.deepEqual(requests.rows.map(r=>r.request_type).sort(),["access","export"]);
        for (const request of requests.rows) {
          assert.equal(request.status,"COMPLETED");assert.ok(request.completed_at);
          assert.equal(request.details.fulfilment.method,"owned_current_data_download");
          const history=await db.query("SELECT from_status,to_status,reviewer_account_id,reason FROM privacy_request_reviews WHERE request_id=$1 ORDER BY review_sequence",[request.request_id]);
          assert.deepEqual(history.rows.map(r=>[r.from_status,r.to_status]),[["OPEN","PROCESSING"],["PROCESSING","COMPLETED"]]);
          assert.ok(history.rows.every(r=>r.reviewer_account_id===credentials.admin.accountId && r.reason.length>=10));
        }
        console.log("ACTUAL_PRIVACY_DATA_DB both requests completed with server-derived delivery marker and exact reasoned staff history");
        return;
      }
      if (DIRECT_MODE) {
        const target=await db.query("SELECT share_link_id,created_at,revoked_at FROM scoped_share_links WHERE purpose='Employer onboarding evidence'");
        assert.equal(target.rows.length,1);
        assert.equal(new Date(target.rows[0].revoked_at).toISOString(),directRevokedAt);
        assert.ok(new Date(target.rows[0].created_at)<=new Date(directRevokedAt));
        const other=await db.query("SELECT revoked_at FROM scoped_share_links WHERE purpose='Separate optional sharing remains active'");
        assert.equal(other.rows.length,1);
        assert.equal(other.rows[0].revoked_at,null);
        const logs=await db.query("SELECT outcome,reason FROM scoped_share_access_logs WHERE share_link_id=$1 ORDER BY accessed_at",[target.rows[0].share_link_id]);
        assert.deepEqual(logs.rows.map(row=>[row.outcome,row.reason]),[["granted","active"],["denied","revoked"]]);
        console.log("ACTUAL_DIRECT_REVOCATION_DB server timestamp retained after repeat, historical creation unchanged and unrelated link active");
        return;
      }
      if (EXPIRY_MODE) {
        const target = await db.query("SELECT share_link_id,created_at,expires_at,revoked_at FROM scoped_share_links WHERE purpose='Employer onboarding evidence'");
        assert.equal(target.rows.length,1);
        const link = target.rows[0];
        assert.equal(new Date(link.expires_at).toISOString(),shortExpiry);
        assert.ok(new Date(link.expires_at) > new Date(link.created_at));
        assert.ok(new Date(link.expires_at) < new Date());
        assert.equal(link.revoked_at,null);
        const logs = await db.query("SELECT outcome,reason FROM scoped_share_access_logs WHERE share_link_id=$1 ORDER BY accessed_at", [link.share_link_id]);
        assert.deepEqual(logs.rows.map(row=>[row.outcome,row.reason]),[["granted","active"],["denied","expired"],["denied","expired"]]);
        const other = await db.query("SELECT expires_at,revoked_at FROM scoped_share_links WHERE purpose='Separate optional sharing remains active'");
        assert.equal(other.rows.length,1);
        assert.equal(other.rows[0].revoked_at,null);
        assert.ok(new Date(other.rows[0].expires_at)>new Date());
        console.log("ACTUAL_EXPIRY_DB real persisted expiry unchanged, no revocation, initial allowed and two expired access records, unrelated link still valid");
        return;
      }
      if (FULFILMENT_MODE || CONSENT_REQUEST_MODE) {
        const completed = await db.query("SELECT request_id,status,details,completed_at FROM privacy_requests WHERE worker_id=$1 AND request_type=$2 AND details->>'sharePurpose'='Separate optional sharing remains active'", [credentials.worker.accountId,CONSENT_REQUEST_MODE ? "consent_withdrawal" : "share_link_revocation"]);
        assert.equal(completed.rows.length,1);
        assert.equal(completed.rows[0].status,"COMPLETED");
        assert.ok(completed.rows[0].completed_at);
        const history = await db.query("SELECT from_status,to_status,reviewer_account_id,reason FROM privacy_request_reviews WHERE request_id=$1 ORDER BY review_sequence", [completed.rows[0].request_id]);
        assert.deepEqual(history.rows.map(row=>[row.from_status,row.to_status]),[["OPEN","PROCESSING"],["PROCESSING","COMPLETED"]]);
        assert.ok(history.rows.every(row=>row.reviewer_account_id===credentials.admin.accountId && row.reason.length>=10));
        let targetId=completed.rows[0].details.shareLinkId;
        if (CONSENT_REQUEST_MODE) {
          const consent=await db.query("SELECT version,action,actor_account_id,metadata FROM privacy_consent_records WHERE consent_id=$1 AND worker_id=$2 ORDER BY version",[completed.rows[0].details.consentId,credentials.worker.accountId]);
          assert.deepEqual(consent.rows.map(r=>r.action),["GRANTED","WITHDRAWN"]);
          assert.equal(consent.rows[1].actor_account_id,credentials.admin.accountId);
          targetId=consent.rows[0].metadata.shareLinkId;
          const unrelatedConsent=await db.query("SELECT action FROM privacy_consent_records WHERE worker_id=$1 AND metadata->>'sharePurpose'='Employer onboarding evidence'",[credentials.worker.accountId]);
          assert.deepEqual(unrelatedConsent.rows.map(r=>r.action),["GRANTED"]);
        }
        const target = await db.query("SELECT revoked_at FROM scoped_share_links WHERE share_link_id=$1", [targetId]);
        assert.ok(target.rows[0].revoked_at);
        const unrelated = await db.query("SELECT revoked_at FROM scoped_share_links WHERE purpose='Employer onboarding evidence'");
        assert.equal(unrelated.rows[0].revoked_at,null);
        const pending = await db.query("SELECT status FROM privacy_requests WHERE worker_id=$1 AND request_id<>$2", [credentials.worker.accountId,completed.rows[0].request_id]);
        assert.equal(pending.rows.length,8);
        assert.ok(pending.rows.every(row=>row.status==='OPEN'));
        console.log(CONSENT_REQUEST_MODE ? "ACTUAL_CONSENT_REQUEST_DB exact grant/withdrawal versions, real Admin actor, required processing/completion history and unrelated grant/requests retained" : "ACTUAL_PRIVACY_FULFILMENT_DB persisted owned target, completed timestamp, exact staff history, one revoked link, unrelated requests still open");
        return;
      }
      const request = await db.query(
        "SELECT request_type,status FROM privacy_requests WHERE worker_id=$1 AND request_type='restriction'",
        [credentials.worker.accountId]
      );
      assert.equal(request.rows[0]?.status, "REJECTED");
      const history = await db.query("SELECT from_status,to_status,reviewer_account_id,reason FROM privacy_request_reviews WHERE request_id=(SELECT request_id FROM privacy_requests WHERE worker_id=$1 AND request_type='restriction') ORDER BY review_sequence", [credentials.worker.accountId]);
      assert.deepEqual(history.rows.map(row => [row.from_status, row.to_status]), [["OPEN", "PROCESSING"], ["PROCESSING", "REJECTED"]]);
      assert.ok(history.rows.every(row => row.reviewer_account_id === credentials.admin.accountId && row.reason.length >= 10));
      const kinds=await db.query("SELECT request_type,status FROM privacy_requests WHERE worker_id=$1 AND request_type=ANY($2::text[])",[credentials.worker.accountId,EXTRA_PRIVACY_TYPES]);
      assert.equal(kinds.rows.length,EXTRA_PRIVACY_TYPES.length);
      assert.deepEqual(kinds.rows.map(row=>row.request_type).sort(),[...EXTRA_PRIVACY_TYPES].sort());
      assert.ok(kinds.rows.every(row=>row.status==="REJECTED"));
      const kindHistory=await db.query("SELECT requests.request_type,reviews.from_status,reviews.to_status,reviews.reviewer_account_id,reviews.reason FROM privacy_request_reviews reviews JOIN privacy_requests requests ON requests.request_id=reviews.request_id WHERE requests.worker_id=$1 AND requests.request_type=ANY($2::text[])",[credentials.worker.accountId,EXTRA_PRIVACY_TYPES]);
      assert.equal(kindHistory.rows.length,EXTRA_PRIVACY_TYPES.length);
      assert.ok(kindHistory.rows.every(row=>row.from_status==="OPEN"&&row.to_status==="REJECTED"&&row.reviewer_account_id===credentials.admin.accountId&&row.reason==="This synthetic "+row.request_type+" request is declined pending required request details."));
      const accommodation = await db.query(
        "SELECT status,case_id,approved_adjustment FROM accessibility_accommodations WHERE worker_id=$1 AND accommodation_type='Extra reading time and captions'",
        [credentials.worker.accountId]
      );
      assert.equal(accommodation.rows[0]?.status, "APPROVED");
      assert.equal(accommodation.rows[0]?.case_id, caseId);
      const overlay = await db.query(
        "SELECT adjustment FROM assurance_case_accommodation_overlays WHERE case_id=$1",
        [caseId]
      );
      const declined = await db.query(
        "SELECT accommodation_id,status,review_reason,case_id,approved_adjustment FROM accessibility_accommodations WHERE worker_id=$1 AND accommodation_type='Alternative delivery decline verification'",
        [credentials.worker.accountId]
      );
      assert.equal(declined.rows.length,1);
      assert.equal(declined.rows[0].status,"DECLINED");
      assert.match(declined.rows[0].review_reason,/declined because/);
      assert.equal(declined.rows[0].case_id,null);
      assert.equal(declined.rows[0].approved_adjustment,null);
      const declinedOverlays = await db.query(
        "SELECT overlay_id FROM assurance_case_accommodation_overlays WHERE accommodation_id=$1",
        [declined.rows[0].accommodation_id]
      );
      assert.equal(declinedOverlays.rows.length,0,"Declined accommodation created a delivery overlay.");
      assert.equal(overlay.rows.length,1,"The approved case gained an unexpected accommodation overlay.");
      assert.equal(Number(overlay.rows[0]?.adjustment?.timeMultiplier), 1.5);
      assert.equal(Boolean(overlay.rows[0]?.adjustment?.captions), true);
      const consent = await db.query(
        "SELECT consent_type,action FROM privacy_consent_records WHERE worker_id=$1 AND consent_type='scoped_share_links' AND metadata->>'sharePurpose'='Employer onboarding evidence' ORDER BY version",
        [credentials.worker.accountId]
      );
      assert.deepEqual(consent.rows.map(row => row.action), ["GRANTED", "WITHDRAWN"]);
      const links = await db.query("SELECT revoked_at,created_at FROM scoped_share_links WHERE purpose='Employer onboarding evidence'");
      assert.ok(new Date(links.rows[0].created_at).getTime() < new Date("2099-01-01").getTime(), "Creation retained a future client timestamp.");
      assert.ok(links.rows[0]?.revoked_at, "Withdrawal did not revoke the linked shared passport.");
      const otherLink = await db.query("SELECT revoked_at FROM scoped_share_links WHERE purpose='Separate optional sharing remains active'");
      assert.equal(otherLink.rows[0]?.revoked_at, null, "Withdrawal also revoked unrelated sharing consent.");
      const accesses = await db.query("SELECT outcome,reason FROM scoped_share_access_logs WHERE share_link_id=(SELECT share_link_id FROM scoped_share_links WHERE purpose='Employer onboarding evidence') ORDER BY accessed_at");
      assert.equal(accesses.rows.at(-1)?.outcome, "denied");
      assert.equal(accesses.rows.at(-1)?.reason, "revoked");
    } finally {
      await db.close();
    }
  } finally {
    await rm(databaseDirectory, { recursive: true, force: true });
  }
});
