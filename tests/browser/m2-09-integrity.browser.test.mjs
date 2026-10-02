import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations } from "../../scripts/lib/migrations.mjs";

async function prepareIntegrityDatabase() {
  const dataDirectory = await mkdtemp(join(tmpdir(), "hse-m2-09-integrity-browser-"));
  const database = await openScriptDatabase({ databaseDriver: "pglite", pgliteDataDir: dataDirectory });
  await applyPendingMigrations(database, "m2-09-integrity-browser-test");
  await database.close();
  return { HSE_DATABASE_DRIVER: "pglite", HSE_PGLITE_DATA_DIR: dataDirectory };
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

test("M2.09 integrity owner acceptance boundary launches Chromium", async () => {
  const environment = await prepareIntegrityDatabase();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  await runDevelopmentServer({
    args: ["--port", String(port)],
    environment: { ...process.env, ...environment, HSE_APP_ENV: "development", HSE_SESSION_SECRET: "integrity-browser-test-session-secret-2026-32", HSE_AUTH_PEPPER: "integrity-browser-test-auth-pepper-2026-32" },
    probeUrl: `${baseUrl}/integrity`,
    probe: async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(`${baseUrl}/integrity`, { waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: "Continue with limited monitoring" }).click();
        await page.waitForFunction(() => document.querySelector("[data-testid=integrity-state]")?.textContent === "DEGRADED");
        assert.equal(await page.getByTestId("integrity-state").textContent(), "DEGRADED");
        await page.getByRole("button", { name: "Check camera and microphone" }).waitFor();
        assert.equal(await page.getByText(/This check does not save audio or video/i).isVisible(), true);
      } finally {
        await browser.close();
      }
    }
  });
});
