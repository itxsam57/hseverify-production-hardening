import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

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

test("M3.01 credential status route crosses browser boundary", async () => {
  const projectRoot = process.cwd();
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-m301-browser-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: databaseDirectory,
    HSE_RELEASE_SHA: "m3-01-browser-local",
    HSE_SESSION_SECRET: "m3-01-browser-session-secret-2026-000000000000"
  };

  try {
    const migration = spawnSync(process.execPath, ["scripts/db-migrate.mjs"], {
      cwd: projectRoot,
      env: environment,
      encoding: "utf8"
    });
    assert.equal(migration.status, 0, migration.stderr || migration.stdout);

    await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: `${baseUrl}/verify/result/unknown`,
      projectRoot,
      environment,
      probe: async () => {
        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage();
          const response = await page.goto(`${baseUrl}/verify/result/unknown`, {
            waitUntil: "domcontentloaded"
          });
          assert(response);
          assert(response.status() < 500);
          const heading = await page.locator("h1").first().textContent();
          assert.equal(heading?.trim(), "Identifier not verified");
          const bodyText = await page.locator("main").textContent();
          assert(bodyText?.includes("Public verification"));
        } finally {
          await browser.close();
        }
      }
    });
  } finally {
    await rm(databaseDirectory, { recursive: true, force: true });
  }
});
