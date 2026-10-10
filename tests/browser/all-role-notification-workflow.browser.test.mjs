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

const ROLES = ["worker","company","assessor","verifier","admin","root"];
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value) {
  const clean = value.toUpperCase().replace(/=+$/g, "");
  let bits = "";
  for (const char of clean) bits += B32.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}
function totp(secret) {
  const counter = Math.floor(Date.now() / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
async function login(page, baseUrl, role, credential) {
  await page.goto(`${baseUrl}/${role}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(credential.email);
  await page.getByLabel("Password").fill(credential.password);
  if (credential.totpSecret) await page.getByLabel("Authenticator code").fill(totp(credential.totpSecret));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`**/${role}/dashboard`, { timeout: 20_000 });
}

test("every portal notification bell creates, opens, deep-links and marks persisted notifications read", { timeout: 300_000 }, async () => {
  const root = process.cwd();
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-role-notifications-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: databaseDirectory,
    HSE_RELEASE_SHA: "all-role-notifications-browser",
    HSE_SESSION_SECRET: "all-role-notifications-session-secret-2026-000000000",
    HSE_AUTH_PEPPER: "all-role-notifications-auth-pepper-2026-00000000000",
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false"
  };

  try {
    for (const script of ["scripts/db-migrate.mjs", "scripts/independent-audit-seed.mjs"]) {
      const result = spawnSync(process.execPath, [script], { cwd: root, env: environment, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    const credentials = JSON.parse(await readFile(process.env.HSE_AUDIT_CREDENTIALS_PATH ?? "/tmp/independent-audit-credentials.json", "utf8"));

    const result = await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: `${baseUrl}/worker/login`,
      projectRoot: root,
      environment,
      probe: async () => {
        const browser = await chromium.launch({ headless: true });
        try {
          for (const role of ROLES) {
            const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
            const page = await context.newPage();
            await login(page, baseUrl, role, credentials[role]);

            await page.goto(`${baseUrl}/${role}/notifications`, { waitUntil: "networkidle" });
            await page.getByRole("button", { name: "Create persisted test notification" }).click();
            await page.waitForURL(/notice=fixture-ready/, { timeout: 15_000 });
            await page.getByText("The real outbox worker projected the test notification successfully.", { exact: true }).waitFor();
            await page.locator(".notification-center-summary").getByText("1", { exact: true }).waitFor();

            await page.goto(`${baseUrl}/${role}/dashboard`, { waitUntil: "networkidle" });
            const bell = page.locator("details.notification-menu");
            const summary = bell.locator("summary");
            await summary.waitFor({ state: "visible" });
            assert.match((await summary.getAttribute("aria-label")) ?? "", /^1 unread notifications$/);
            await summary.click();
            await bell.locator(".notification-panel").waitFor({ state: "visible" });
            const unreadItem = bell.getByRole("button", { name: /Unread: Notification foundation ready/ });
            await unreadItem.waitFor({ state: "visible" });
            await unreadItem.click();
            await page.waitForURL(`**/${role}/dashboard`, { timeout: 15_000 });

            await page.reload({ waitUntil: "networkidle" });
            assert.equal(await page.locator("details.notification-menu > summary").getAttribute("aria-label"), "0 unread notifications");

            await page.goto(`${baseUrl}/${role}/notifications`, { waitUntil: "networkidle" });
            await page.getByRole("button", { name: "Create persisted test notification" }).click();
            await page.waitForURL(/notice=fixture-ready/, { timeout: 15_000 });
            const unreadCard = page.locator(".notification-center-item.notification-unread").first();
            await unreadCard.getByRole("button", { name: "Mark read" }).click();
            await page.locator(".notification-center-summary").getByText("0", { exact: true }).waitFor({ timeout: 15_000 });
            for (let i = 0; i < 2; i++) {
              await page.getByRole("button", { name: "Create persisted test notification" }).click();
              await page.waitForURL(/notice=fixture-ready/, { timeout: 15_000 });
              await page.locator(".notification-center-summary").getByText(String(i + 1), { exact: true }).waitFor();
            }
            await page.getByRole("button", { name: "Mark all read", exact: true }).click();
            await page.locator(".notification-center-summary").getByText("0", { exact: true }).waitFor();
            assert.equal(await page.locator(".notification-unread").count(), 0);
            await page.reload({ waitUntil: "networkidle" });
            assert.equal(await page.locator("details.notification-menu > summary").getAttribute("aria-label"), "0 unread notifications");
            await context.close();
          }
        } finally {
          await browser.close();
        }
      }
    });
    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
    const database = new PGlite(databaseDirectory);
    try {
      const rows = (await database.query("SELECT recipient_role, read_at FROM platform_notifications WHERE notification_type='platform.foundation.ready'")).rows;
      assert.equal(rows.length, 24);
      for (const role of ROLES) {
        const owned = rows.filter(row => row.recipient_role === role);
        assert.equal(owned.length, 4);
        assert.ok(owned.every(row => row.read_at));
      }
      const audits = (await database.query("SELECT actor_role, target_reference FROM platform_audit_events WHERE action_key='notification.read'")).rows;
      assert.equal(audits.length, 24);
      assert.equal(new Set(audits.map(row => row.target_reference)).size, 24);
    } finally { await database.close(); }

  } finally {
    await rm(databaseDirectory, { recursive: true, force: true });
  }
});
