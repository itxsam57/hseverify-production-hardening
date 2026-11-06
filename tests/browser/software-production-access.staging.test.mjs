import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import { login } from "../helpers/appeal-consumer-browser-journey.mjs";
import { stageBrowserArgs, withOwnedStagingServer } from "../helpers/owned-staging-server.mjs";

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
  const operator = spawnSync(process.execPath, [resolve(config.projectRoot, "scripts/validate-environment.mjs")], {
    cwd: config.projectRoot, env, encoding: "utf8", timeout: 5000,
  });
  assert.ifError(operator.error);
  assert.equal(operator.status, 0);
  assert.match(config.candidateSha, /^[a-f0-9]{40}$/);
  assert.ok(operator.stdout.includes("Environment valid: production, database=postgres, release=" + config.candidateSha + "."));
  assert.ok(secrets.every(secret => !operator.stdout.includes(secret)));
  console.log("OPERATOR_RUNTIME_IDENTITY_PASS production PostgreSQL", config.candidateSha);
  const credentials = JSON.parse(await readFile(config.accountsPath, "utf8"));
  const browser = await chromium.launch({ headless: true, args: stageBrowserArgs(config) });
  const options = { httpCredentials: { username: config.user, password: config.password } };
  try {
    const startupScript = resolve(config.projectRoot, "scripts/start-production.mjs");
    const authorization = "Basic " + Buffer.from(config.user + ":" + config.password).toString("base64");
    const operations = config.url + "/admin/operations";
    const assertOutage = async () => {
      const response = await fetch(operations, {
        headers: { authorization }, redirect: "manual", signal: AbortSignal.timeout(10000),
      });
      assert.equal(response.status, 502);
      const body = await response.text();
      assert.ok(!body.includes("Admin operations health"));
      assert.ok(secrets.every(secret => !body.includes(secret)));
    };
    const anonymous = await fetch(operations, { redirect: "manual", signal: AbortSignal.timeout(10000) });
    assert.equal(anonymous.status, 401);
    const invalid = spawnSync(process.execPath, [startupScript], {
      cwd: config.projectRoot, env: { ...env, HSE_SESSION_SECRET: "" }, encoding: "utf8", timeout: 5000,
    });
    assert.ifError(invalid.error);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /HSE_SESSION_SECRET/);
    await assertOutage();

    await withOwnedStagingServer({ ...config, startupScript }, async ({ restart, crash }) => {
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
      await crash();
      await assertOutage();
      await restart();
      await checkBody(await worker.reload());
      assert.equal(new URL(worker.url()).pathname, "/worker/dashboard");
      await checkBody(await admin.reload());
      await admin.getByRole("heading", { name: "Admin operations health", exact: true }).waitFor();
      console.log("PRODUCTION_ACCESS_PASS invalid-start rejection and correction, perimeter, roles, secret isolation, graceful restart and forced process recovery");
    });
  } finally {
    await browser.close();
  }
});
