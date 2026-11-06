import assert from "node:assert/strict";
import test from "node:test";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import { login } from "../helpers/appeal-consumer-browser-journey.mjs";
import { withOwnedStagingServer } from "../helpers/owned-staging-server.mjs";

test("production browser roles and public responses isolate runtime secrets across restart", { timeout: 90000 }, async () => {
  const path = await realpath(process.env.HSE_SOFTWARE_STAGE_CONFIG);
  const config = JSON.parse(await readFile(path, "utf8"));
  assert.equal(config.syntheticOnly, true);
  assert.equal(dirname(path), config.privateRoot);
  assert.ok(config.privateRoot.startsWith(resolve(config.projectRoot, "..") + "/hse-https-stage."));
  assert.equal(new URL(config.url).protocol, "https:");
  const env = config.applicationEnvironment;
  assert.equal(env.HSE_APP_ENV, "production");
  assert.equal(env.HSE_DATABASE_DRIVER, "postgres");
  assert.equal(new URL(env.DATABASE_URL).hostname, "127.0.0.1");
  const secrets = [env.HSE_SESSION_SECRET, env.HSE_AUTH_PEPPER, env.HSE_CREDENTIAL_SIGNING_SECRET];
  assert.ok(secrets.every(value => typeof value === "string" && value.length >= 32));
  assert.equal(new Set(secrets).size, secrets.length);
  const credentials = JSON.parse(await readFile(config.accountsPath, "utf8"));
  const browser = await chromium.launch({ headless: true });
  const options = { httpCredentials: { username: config.user, password: config.password } };
  try {
    const startupScript = resolve(config.projectRoot, "scripts/start-production.mjs");
    await withOwnedStagingServer({ ...config, startupScript }, async ({ restart }) => {
      const anonymous = await fetch(config.url + "/admin/operations", { redirect: "manual" });
      assert.equal(anonymous.status, 401);
      const worker = await browser.newPage(options);
      const admin = await browser.newPage(options);
      const checkBody = async response => {
        assert.equal(response.status(), 200);
        const body = await response.text();
        assert.ok(secrets.every(secret => !body.includes(secret)), "Protected or public response exposed a runtime secret");
        assert.ok(!body.includes(env.DATABASE_URL), "Response exposed the database connection string");
      };
      await checkBody(await worker.goto(config.url + "/"));
      await login(worker, config.url, credentials.worker, "worker");
      await checkBody(await worker.goto(config.url + "/admin/operations"));
      assert.equal(new URL(worker.url()).pathname, "/access-denied");
      await login(admin, config.url, credentials.admin, "admin");
      await checkBody(await admin.goto(config.url + "/admin/operations"));
      await admin.getByRole("heading", { name: "Admin operations health", exact: true }).waitFor();

      const providers = admin.getByRole("list", { name: "Provider integrations" });
      await providers.getByText(/email: disabled.*Live availability: not checked/).waitFor();
      await providers.getByText(/sms: disabled.*Live availability: not checked/).waitFor();
      await providers.getByText(/video: ready.*built_in_available/).waitFor();
      await providers.getByText(/malware_scanning: configured.*configured_not_verified/).waitFor();

      await restart();
      await checkBody(await worker.goto(config.url + "/worker/dashboard"));
      assert.equal(new URL(worker.url()).pathname, "/worker/dashboard");
      await checkBody(await admin.reload());
      await admin.getByRole("heading", { name: "Admin operations health", exact: true }).waitFor();
      console.log("PRODUCTION_ACCESS_PASS perimeter, Worker denial, Admin visibility, private configuration and retained sessions");
    });
  } finally {
    await browser.close();
  }
});
