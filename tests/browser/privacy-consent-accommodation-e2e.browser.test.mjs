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

test("Worker privacy request and accommodation approval traverse Worker -> Admin -> Worker with consent history", { timeout: 300_000 }, async () => {
  const root = process.cwd();
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

          await worker.goto(baseUrl + "/worker/privacy", { waitUntil: "domcontentloaded" });
          await worker.getByLabel("Privacy request type").selectOption("restriction");
          await worker.getByRole("button", { name: "Submit privacy request" }).click();
          await worker.getByText("restriction: OPEN", { exact: true }).waitFor({ timeout: 15_000 });

          await worker.getByLabel("Accommodation request").fill("Extra reading time and captions");
          await worker.getByRole("button", { name: "Submit accommodation" }).click();
          await worker.getByText("Extra reading time and captions", { exact: true }).waitFor({ timeout: 15_000 });
          await worker.getByText("Status: REQUESTED", { exact: true }).waitFor();

          await worker.goto(baseUrl + "/worker/share-links", { waitUntil: "domcontentloaded" });
          await worker.getByLabel("Purpose").fill("Employer onboarding evidence");
          await worker.getByRole("button", { name: "Create secure link" }).click();
          await worker.getByText("Share link created.", { exact: false }).waitFor({ timeout: 15_000 });

          await login(admin, baseUrl, credentials.admin, "admin");
          await admin.goto(baseUrl + "/admin/privacy", { waitUntil: "domcontentloaded" });
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
      const request = await db.query(
        "SELECT request_type,status FROM privacy_requests WHERE worker_id=$1 AND request_type='restriction'",
        [credentials.worker.accountId]
      );
      assert.equal(request.rows[0]?.status, "OPEN");
      const accommodation = await db.query(
        "SELECT status,case_id,approved_adjustment FROM accessibility_accommodations WHERE worker_id=$1",
        [credentials.worker.accountId]
      );
      assert.equal(accommodation.rows[0]?.status, "APPROVED");
      assert.equal(accommodation.rows[0]?.case_id, caseId);
      const overlay = await db.query(
        "SELECT adjustment FROM assurance_case_accommodation_overlays WHERE case_id=$1",
        [caseId]
      );
      assert.equal(Number(overlay.rows[0]?.adjustment?.timeMultiplier), 1.5);
      assert.equal(Boolean(overlay.rows[0]?.adjustment?.captions), true);
      const consent = await db.query(
        "SELECT consent_type,action FROM privacy_consent_records WHERE worker_id=$1 AND consent_type='scoped_share_links'",
        [credentials.worker.accountId]
      );
      assert.equal(consent.rows[0]?.action, "GRANTED");
    } finally {
      await db.close();
    }
  } finally {
    await rm(databaseDirectory, { recursive: true, force: true });
  }
});
