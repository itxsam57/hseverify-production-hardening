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

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = value.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = "";
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`Invalid base32 character: ${char}`);
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
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
        else if (!address || typeof address === "string") reject(new Error("No port."));
        else resolve(address.port);
      });
    });
  });
}

async function login(page, baseUrl, role, credential, returnTo = null) {
  const loginUrl = returnTo ? `${baseUrl}/${role}/login?returnTo=${encodeURIComponent(returnTo)}` : `${baseUrl}/${role}/login`;
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(credential.email);
  await page.getByLabel("Password").fill(credential.password);
  if (credential.totpSecret) {
    await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== `/${role}/login`, { timeout: 20_000 });
}

async function assertRecoveryControlRuns(page, buttonName, errorHeading) {
  const clientErrors = [];
  const onPageError = (error) => clientErrors.push(error.message);
  page.on("pageerror", onPageError);
  try {
    const button = page.getByRole("button", { name: buttonName, exact: true });
    await button.waitFor({ state: "visible", timeout: 15_000 });
    await button.click();
    await page.waitForTimeout(750);
    await page.getByRole("heading", { name: errorHeading, exact: true }).waitFor({ timeout: 15_000 });
    assert.deepEqual(clientErrors, [], `${buttonName} produced a client-side error: ${clientErrors.join(" | ")}`);
  } finally {
    page.off("pageerror", onPageError);
  }
}


test("real error boundaries retry Worker Dashboard and global route requests without exposing internals", { timeout: 180_000 }, async () => {
  const projectRoot = process.cwd();
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-error-recovery-browser-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: databaseDirectory,
    HSE_RELEASE_SHA: "error-recovery-browser",
    HSE_SESSION_SECRET: "error-recovery-session-secret-2026-000000000000",
    HSE_AUTH_PEPPER: "error-recovery-auth-pepper-2026-00000000000000",
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false"
  };

  try {
    for (const script of ["scripts/db-migrate.mjs", "scripts/independent-audit-seed.mjs"]) {
      const result = spawnSync(process.execPath, [script], {
        cwd: projectRoot,
        env: environment,
        encoding: "utf8"
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    const credentials = JSON.parse(await readFile("/tmp/independent-audit-credentials.json", "utf8"));

    // Fault only disposable test data. Authentication/profile tables remain intact.
    const database = new PGlite(databaseDirectory);
    try {
      await database.query("ALTER TABLE credential_appeals RENAME TO credential_appeals_error_recovery_fixture");
      await database.query("ALTER TABLE billing_checkouts RENAME TO billing_checkouts_error_recovery_fixture");
    } finally {
      await database.close();
    }

    const result = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: `${baseUrl}/worker/login`,
      projectRoot,
      environment,
      probe: async ({ output }) => {
        const browser = await chromium.launch({ headless: true });
        try {
          const workerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
          const worker = await workerContext.newPage();
          await login(worker, baseUrl, "worker", credentials.worker, "/worker/company-access/complete-registration");
          await worker.waitForURL((url) => url.pathname === "/worker/company-access/complete-registration", { timeout: 20_000 });
          await worker.goto(`${baseUrl}/worker/dashboard`, { waitUntil: "domcontentloaded" });
          await worker.getByRole("heading", { name: "We could not load your dashboard.", exact: true }).waitFor({ timeout: 15_000 });
          const workerBody = await worker.locator("body").innerText();
          assert.match(
            workerBody,
            /We could not load your dashboard\.|HSE Verify could not complete this request\./,
            `Worker fault did not render an error boundary. body=${workerBody.slice(0, 1800)} server=${output().slice(-4000)}`
          );
          assert.doesNotMatch(workerBody, /credential_appeals|SELECT|RuntimeError|stack/i);
          await assertRecoveryControlRuns(
            worker,
            "Retry dashboard",
            "We could not load your dashboard."
          );
          await workerContext.close();

          const companyContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
          const company = await companyContext.newPage();
          await login(company, baseUrl, "company", credentials.company);
          await company.goto(`${baseUrl}/company/billing`, { waitUntil: "domcontentloaded" });
          await company
            .getByRole("heading", { name: "HSE Verify could not complete this request.", exact: true })
            .waitFor({ timeout: 15_000 });
          const companyBody = await company.locator("body").innerText();
          assert.doesNotMatch(companyBody, /billing_checkouts|SELECT|RuntimeError|stack/i);
          await assertRecoveryControlRuns(
            company,
            "Try again",
            "HSE Verify could not complete this request."
          );
          await companyContext.close();

          assert.match(output(), /credential_appeals|billing_checkouts/);
        } finally {
          await browser.close();
        }
      }
    });
    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
  } finally {
    await rm(databaseDirectory, { recursive: true, force: true });
  }
});
