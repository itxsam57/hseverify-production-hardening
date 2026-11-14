import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";

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
    for (const width of [390, 320, 1280]) {
      await page.setViewportSize({ width, height: 840 });
      const overflow = await page.evaluate(() => ({
        full: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
        viewport: document.documentElement.clientWidth
      }));
      assert(overflow.full <= overflow.viewport + 2, buttonName + " error content overflows " + width + "px: " + JSON.stringify(overflow));
      await page.getByRole("button", { name: buttonName, exact: true }).waitFor({ state: "visible" });
    }
  } finally {
    page.off("pageerror", onPageError);
  }
}


test("real error boundaries retry Worker Dashboard and global route requests without exposing internals", { timeout: 420_000 }, async () => {
  const projectRoot = process.cwd();
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-error-recovery-pg16-"));
  const pgBin = process.env.HSE_PG_BIN ?? "/usr/lib/postgresql/16/bin";
  const pgData = join(databaseDirectory, "pg-data");
  const pgLog = join(databaseDirectory, "postgres.log");
  const passFile = join(databaseDirectory, "postgres-pass");
  const pgPort = await freePort();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const pgPassword = randomBytes(24).toString("hex");
  const databaseUrl = `postgresql://hseqa:${pgPassword}@127.0.0.1:${pgPort}/postgres`;
  const environment = {
    ...process.env,
    NODE_ENV: "development", HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "postgres", HSE_DISPOSABLE_POSTGRES_QA: "true",
    DATABASE_URL: databaseUrl,
    HSE_AUDIT_CREDENTIALS_PATH: join(databaseDirectory, "audit-credentials.json"),
    HSE_RELEASE_SHA: "error-recovery-pg16-browser",
    HSE_SESSION_SECRET: "error-recovery-session-secret-2026-000000000000",
    HSE_AUTH_PEPPER: "error-recovery-auth-pepper-2026-00000000000000",
    HSE_ENABLE_WORKER_DEMO_AUTH: "false", HSE_USE_WORKER_DEMO_DATA: "false"
  };
  let postgresStarted = false;
  const pgRun = (command, args) => {
    const result = spawnSync(join(pgBin, command), args, {
      cwd: projectRoot, encoding: "utf8", timeout: 45_000, maxBuffer: 8 * 1024 * 1024
    });
    assert.equal(result.status, 0, `${command} failed: ${result.stderr || result.stdout}`);
  };
  try {
    await writeFile(passFile, pgPassword + "\n", { mode: 0o600 });
    pgRun("initdb", ["-D", pgData, "-U", "hseqa", "--auth-host=scram-sha-256",
      "--auth-local=scram-sha-256", `--pwfile=${passFile}`, "--no-instructions"]);
    pgRun("pg_ctl", ["-D", pgData, "-l", pgLog, "-o",
      `-c listen_addresses=127.0.0.1 -c unix_socket_directories=${databaseDirectory} -p ${pgPort}`,
      "-w", "start"]);
    postgresStarted = true;
    await rm(passFile, { force: true });
    for (const script of ["scripts/db-migrate.mjs", "scripts/independent-audit-seed.mjs"]) {
      const result = spawnSync(process.execPath, [script], {
        cwd: projectRoot, env: environment, encoding: "utf8", timeout: 80_000,
        maxBuffer: 12 * 1024 * 1024
      });
      assert.equal(result.status, 0, `${script}: ${result.stderr || result.stdout}`);
    }
    const credentials = JSON.parse(await readFile(environment.HSE_AUDIT_CREDENTIALS_PATH, "utf8"));
    const database = await openScriptDatabase({ databaseDriver: "postgres", databaseUrl });
    try {
      await database.query("ALTER TABLE credential_appeals RENAME TO credential_appeals_error_recovery_fixture");
      await database.query("ALTER TABLE billing_checkouts RENAME TO billing_checkouts_error_recovery_fixture");
    } finally {
      await database.close();
    }

    const browser = await chromium.launch({ headless: true });
    try {
      const initial = await runDevelopmentServer({
        args: ["--hostname", "127.0.0.1", "--port", String(port)],
        probeUrl: `${baseUrl}/worker/login`,
        projectRoot,
        environment,
        probe: async ({ output }) => {
          // The original authenticated browser and Next server remain alive
          // during a real PostgreSQL outage and recovery.
          const workerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
          const worker = await workerContext.newPage();
          await login(worker, baseUrl, "worker", credentials.worker, "/worker/company-access/complete-registration");
          await worker.waitForURL((url) => url.pathname === "/worker/company-access/complete-registration", { timeout: 20_000 });
          await worker.goto(`${baseUrl}/worker/dashboard`, { waitUntil: "domcontentloaded" });
          await worker.getByRole("heading", { name: "We could not load your dashboard.", exact: true }).waitFor({ timeout: 15_000 });
          const workerBody = await worker.locator("body").innerText();
          assert.match(workerBody, /We could not load your dashboard\.|HSE Verify could not complete this request\./,
            `Worker fault did not render an error boundary. body=${workerBody.slice(0, 1800)} server=${output().slice(-4000)}`);
          assert.doesNotMatch(workerBody, /credential_appeals|SELECT|RuntimeError|stack/i);
          await assertRecoveryControlRuns(worker, "Retry dashboard", "We could not load your dashboard.");

          const companyContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
          const company = await companyContext.newPage();
          await login(company, baseUrl, "company", credentials.company);
          await company.goto(`${baseUrl}/company/billing`, { waitUntil: "domcontentloaded" });
          await company.getByRole("heading", { name: "HSE Verify could not complete this request.", exact: true })
            .waitFor({ timeout: 15_000 });
          const companyBody = await company.locator("body").innerText();
          assert.doesNotMatch(companyBody, /billing_checkouts|SELECT|RuntimeError|stack/i);
          await assertRecoveryControlRuns(company, "Try again", "HSE Verify could not complete this request.");
          assert.match(output(), /credential_appeals|billing_checkouts/);

          // M10203_RESTORED_BACKEND_RETRY: online restoration on live isolated
          // PostgreSQL16 while both user sessions and the Next server remain open.
          const restoredDb = await openScriptDatabase({ databaseDriver: "postgres", databaseUrl });
          try {
            await restoredDb.query("ALTER TABLE credential_appeals_error_recovery_fixture RENAME TO credential_appeals");
            await restoredDb.query("ALTER TABLE billing_checkouts_error_recovery_fixture RENAME TO billing_checkouts");
            const sessions = await restoredDb.query("SELECT count(*)::int AS n FROM auth_sessions WHERE revoked_at IS NULL");
            assert(sessions.rows[0].n >= 2, "Recovery must preserve authenticated sessions");
            assert.equal((await restoredDb.query("SELECT count(*)::int AS n FROM billing_checkouts")).rows[0].n, 0);
          } finally {
            await restoredDb.close();
          }

          // A mere disappearance of the red banner is insufficient: require
          // real authorized server-rendered successful data on both roles.
          await worker.getByRole("button", { name: "Retry dashboard", exact: true }).click();
          try {
            await worker.getByRole("heading", { name: /^Welcome,/ }).waitFor({ timeout: 20_000 });
          } catch (error) {
            const body = await worker.locator("body").innerText().catch(() => "unavailable");
            throw new Error(`Worker after restored-backend Retry did not recover. url=${worker.url()} body=${body.slice(0,1200)} cause=${error.message}`);
          }
          assert.equal(await worker.getByRole("heading", { name: "We could not load your dashboard.", exact: true }).count(), 0);
          assert.doesNotMatch(await worker.locator("body").innerText(), /credential_appeals|RuntimeError|SELECT/i);

          await company.getByRole("button", { name: "Try again", exact: true }).click();
          await company.getByRole("heading", { name: "Company billing", exact: true }).waitFor({ timeout: 20_000 });
          assert.equal(await company.getByRole("heading", { name: "HSE Verify could not complete this request.", exact: true }).count(), 0);
          await company.getByText("Sandbox billing mode", { exact: false }).waitFor();
          assert.doesNotMatch(await company.locator("body").innerText(), /billing_checkouts|RuntimeError|SELECT/i);
          const finalDb = await openScriptDatabase({ databaseDriver: "postgres", databaseUrl });
          try {
            assert.equal((await finalDb.query("SELECT count(*)::int AS n FROM billing_checkouts")).rows[0].n, 0,
              "Recovery and page reload cannot create a phantom checkout");
            assert((await finalDb.query("SELECT count(*)::int AS n FROM auth_sessions WHERE revoked_at IS NULL")).rows[0].n >= 2,
              "Original Worker and Company sessions survive the outage");
          } finally {
            await finalDb.close();
          }

          // M10203_WORKER_PROFILE_ROUTE_RECOVERY: inject an actual SQL
          // outage after authentication, without restarting the server or
          // replacing the signed-in browser context. Profile loads in both
          // the Worker layout and the child route: the child recovery control
          // must remain visible, safe and genuinely usable.
          const profileFaultDb = await openScriptDatabase({ databaseDriver: "postgres", databaseUrl });
          try {
            await profileFaultDb.query("ALTER TABLE worker_profiles RENAME TO worker_profiles_error_recovery_fixture");
          } finally {
            await profileFaultDb.close();
          }
          await worker.goto(`${baseUrl}/worker/profile`, { waitUntil: "domcontentloaded" });
          await worker.getByRole("heading", { name: "Profile could not be loaded", exact: true }).waitFor({ timeout: 12_000 });
          assert.doesNotMatch(await worker.locator("body").innerText(), /worker_profiles|SELECT|RuntimeError|stack/i);
          await assertRecoveryControlRuns(worker, "Try again", "Profile could not be loaded");
          const profileRecoveryDb = await openScriptDatabase({ databaseDriver: "postgres", databaseUrl });
          try {
            await profileRecoveryDb.query("ALTER TABLE worker_profiles_error_recovery_fixture RENAME TO worker_profiles");
          } finally {
            await profileRecoveryDb.close();
          }
          await worker.getByRole("button", { name: "Try again", exact: true }).click();
          await worker.getByRole("heading", { name: "My profile", exact: true }).waitFor({ timeout: 20_000 });
          assert.equal(await worker.getByRole("heading", { name: "Profile could not be loaded", exact: true }).count(), 0);
          assert.doesNotMatch(await worker.locator("body").innerText(), /worker_profiles|SELECT|RuntimeError|stack/i);

          // M10203_COMPANY_TENANT_SCOPE_ROUTE_RECOVERY: safely fail the
          // authorized Company's own tenant data only, without changing its
          // login, membership, payment or a separate real tenant.
          const tenantFaultDb = await openScriptDatabase({ databaseDriver: "postgres", databaseUrl });
          let originalTenantRows;
          try {
            originalTenantRows = (await tenantFaultDb.query(
              "SELECT count(*)::int AS n FROM authorization_tenant_scope_fixtures"
            )).rows[0].n;
            await tenantFaultDb.query("ALTER TABLE authorization_tenant_scope_fixtures RENAME TO authorization_tenant_scope_fixtures_error_recovery_fixture");
          } finally {
            await tenantFaultDb.close();
          }
          await company.goto(`${baseUrl}/company/tenant-scope`, { waitUntil: "domcontentloaded" });
          await company.getByRole("heading", { name: "Tenant demonstration unavailable", exact: true })
            .waitFor({ timeout: 12_000 });
          assert.doesNotMatch(await company.locator("body").innerText(), /authorization_tenant_scope_fixtures|SELECT|RuntimeError|stack/i);
          await assertRecoveryControlRuns(company, "Retry protected load", "Tenant demonstration unavailable");
          const tenantRestoreDb = await openScriptDatabase({ databaseDriver: "postgres", databaseUrl });
          try {
            await tenantRestoreDb.query("ALTER TABLE authorization_tenant_scope_fixtures_error_recovery_fixture RENAME TO authorization_tenant_scope_fixtures");
            assert.equal((await tenantRestoreDb.query(
              "SELECT count(*)::int AS n FROM authorization_tenant_scope_fixtures"
            )).rows[0].n, originalTenantRows, "Tenant recovery must not mutate protected records");
          } finally {
            await tenantRestoreDb.close();
          }
          await company.getByRole("button", { name: "Retry protected load", exact: true }).click();
          await company.getByRole("heading", { name: "Current Company tenant boundary", exact: true })
            .waitFor({ timeout: 20_000 });
          assert.equal(await company.getByRole("heading", { name: "Tenant demonstration unavailable", exact: true }).count(), 0);
          assert.doesNotMatch(await company.locator("body").innerText(), /authorization_tenant_scope_fixtures|SELECT|RuntimeError|stack/i);

          // M10203_SIX_ROLE_NOTIFICATION_ROUTE_RECOVERY: use one real online
          // PostgreSQL fault, six separately authenticated original Chrome
          // sessions and each role's actual notifications page. This also
          // exercises authorization even if the portal header's bell fails.
          const rolePages = new Map([["worker", worker], ["company", company]]);
          for (const role of ["assessor", "verifier", "admin", "root"]) {
            const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
            const rolePage = await context.newPage();
            await login(rolePage, baseUrl, role, credentials[role]);
            rolePages.set(role, rolePage);
          }
          for (const [role, page] of rolePages) {
            await page.goto(`${baseUrl}/${role}/notifications`, { waitUntil: "domcontentloaded" });
            await page.locator(".notification-center-summary").waitFor({ timeout: 15_000 });
          }
          const noticeFaultDb = await openScriptDatabase({ databaseDriver: "postgres", databaseUrl });
          let originalNotices;
          try {
            originalNotices = (await noticeFaultDb.query("SELECT count(*)::int AS n FROM platform_notifications")).rows[0].n;
            await noticeFaultDb.query("ALTER TABLE platform_notifications RENAME TO platform_notifications_error_recovery_fixture");
          } finally {
            await noticeFaultDb.close();
          }
          for (const [role, page] of rolePages) {
            await page.goto(`${baseUrl}/${role}/notifications`, { waitUntil: "domcontentloaded" });
            await page.getByRole("heading", { name: "Notifications are temporarily unavailable", exact: true })
              .waitFor({ timeout: 12_000 });
            assert.doesNotMatch(await page.locator("body").innerText(), /platform_notifications|SELECT|RuntimeError|stack/i,
              `${role} notification error exposed SQL details`);
            const bell = page.locator("details.notification-menu");
            assert.equal(await bell.locator("summary").getAttribute("aria-label"), "Notifications temporarily unavailable",
              `${role} header must not claim zero unread when the database is unavailable`);
            await bell.locator("summary").click();
            await bell.getByText("Notifications temporarily unavailable. Open Notifications to retry.", { exact: true }).waitFor();
            await bell.locator("summary").click();
            await assertRecoveryControlRuns(page, "Try again", "Notifications are temporarily unavailable");
          }
          // Regression: an active Worker cookie can never open the Company's
          // protected role data even while the shared notification storage is
          // missing and the bell is using its constrained outage fallback.
          const forgedRole = await workerContext.newPage();
          try {
            await forgedRole.goto(`${baseUrl}/company/notifications`, { waitUntil: "domcontentloaded" });
            await forgedRole.waitForURL((url) => url.pathname === "/access-denied" || url.pathname.startsWith("/company/login"),
              { timeout: 15_000 });
            assert.equal(await forgedRole.locator(".notification-center-summary").count(), 0);
          } finally {
            await forgedRole.close();
          }

          const noticeRestoreDb = await openScriptDatabase({ databaseDriver: "postgres", databaseUrl });
          try {
            await noticeRestoreDb.query("ALTER TABLE platform_notifications_error_recovery_fixture RENAME TO platform_notifications");
            assert.equal((await noticeRestoreDb.query("SELECT count(*)::int AS n FROM platform_notifications")).rows[0].n,
              originalNotices, "Read-only failure/retry must not create/delete any notifications");
          } finally {
            await noticeRestoreDb.close();
          }
          for (const [role, page] of rolePages) {
            await page.getByRole("button", { name: "Try again", exact: true }).click();
            await page.locator(".notification-center-summary").waitFor({ timeout: 20_000 });
            assert.equal(await page.getByRole("heading", { name: "Notifications are temporarily unavailable", exact: true }).count(), 0);
            assert.doesNotMatch(await page.locator("body").innerText(), /platform_notifications|SELECT|RuntimeError|stack/i,
              `${role} notification recovery exposed SQL details`);
            await page.reload({ waitUntil: "domcontentloaded" });
            const label = await page.locator("details.notification-menu > summary").getAttribute("aria-label");
            assert.match(label ?? "", /^\d+ unread notifications$/, `${role} header still claims outage after successful DB recovery`);
          }
          const noticeFinalDb = await openScriptDatabase({ databaseDriver: "postgres", databaseUrl });
          try {
            assert.equal((await noticeFinalDb.query("SELECT count(*)::int AS n FROM platform_notifications")).rows[0].n,
              originalNotices, "Six role-specific retries must not lose or forge a notification");
            const active = (await noticeFinalDb.query("SELECT count(*)::int AS n FROM auth_sessions WHERE revoked_at IS NULL")).rows[0].n;
            assert(active >= 6, `Expected six original role sessions retained after outage, found ${active}`);
          } finally {
            await noticeFinalDb.close();
          }
        }
      });
      assert.equal(initial.requestedSignal, "SMOKE_COMPLETE");
    } finally {
      await browser.close();
    }
  } finally {
    try {
      if (postgresStarted) pgRun("pg_ctl", ["-D", pgData, "-m", "fast", "-w", "stop"]);
    } finally {
      await rm(databaseDirectory, { recursive: true, force: true });
    }
  }
});
