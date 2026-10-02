import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decode32(value) {
  let bits = 0;
  let acc = 0;
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

async function login(page, baseUrl, identity) {
  await page.goto(baseUrl + "/admin/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin/dashboard", { timeout: 20_000 });
}

test("M3.11 executed certification persists into the protected Admin operations surface", { timeout: 420_000 }, async () => {
  const dbDir = await mkdtemp(join(tmpdir(), "hse-certification-browser-"));
  const environment = { ...process.env, HSE_APP_ENV: "test", HSE_DATABASE_DRIVER: "pglite", HSE_PGLITE_DATA_DIR: dbDir,
    HSE_RELEASE_SHA: "certification-browser-disposable-test", HSE_SESSION_SECRET: "certification-browser-session-secret-2026-32",
    HSE_AUTH_PEPPER: "certification-browser-auth-pepper-2026-32", HSE_ENABLE_AUTH_SANDBOX: "false",
    HSE_ENABLE_WORKER_DEMO_AUTH: "false", HSE_USE_WORKER_DEMO_DATA: "false" };
  try {
  for (const script of ["scripts/db-migrate.mjs", "scripts/independent-audit-seed.mjs", "scripts/run-m3-11-certification.mjs"]) {
    const result = spawnSync(process.execPath, [script], { env: environment, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  const credentials = JSON.parse(
    await readFile("/tmp/independent-audit-credentials.json", "utf8")
  );
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const result = await runDevelopmentServer({
    args: ["--hostname", "127.0.0.1", "--port", String(port)],
    probeUrl: baseUrl + "/admin/login",
    projectRoot: process.cwd(),
    environment,
    probe: async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const anonymous = await browser.newPage();
        const anonymousResponse = await anonymous.goto(baseUrl + "/admin/operations", {
          waitUntil: "domcontentloaded"
        });
        assert(anonymousResponse);
        assert(anonymousResponse.status() < 500);
        assert.match(anonymous.url(), /\/admin\/login/);
        await anonymous.close();

        const page = await browser.newPage();
        await login(page, baseUrl, credentials.admin);
        const response = await page.goto(baseUrl + "/admin/operations", {
          waitUntil: "domcontentloaded"
        });
        assert(response);
        assert(response.status() < 500);

        await page.getByText("Load, security and recovery certification", { exact: true }).waitFor();
        assert.equal(
          (await page.getByLabel("certification-status").innerText()).trim(),
          "Certification: certified"
        );

        for (const drill of ["concurrency", "tenant_isolation", "restore", "incident"]) {
          await page.getByText(new RegExp("^" + drill + ": passed")).waitFor({
            state: "visible",
            timeout: 15_000
          });
        }
        await browser.close();
      } catch (error) {
        await browser.close();
        throw error;
      }
    }
  });

  assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
  } finally { await rm(dbDir, { recursive: true, force: true }); }
});
