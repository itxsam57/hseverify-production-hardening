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

test("M3.03 share-link API boundary is reachable through real Chromium", async () => {
  const projectRoot = process.cwd();
  const databaseDirectory = await mkdtemp(join(tmpdir(), "hse-m303-browser-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: databaseDirectory,
    HSE_RELEASE_SHA: "m3-03-browser-local",
    HSE_SESSION_SECRET: "m3-03-browser-session-secret-2026-000000000000"
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
      probeUrl: `${baseUrl}/api/share-links?ownerWorkerId=HSE-WRK-000321`,
      projectRoot,
      environment,
      probe: async () => {
        const browser = await chromium.launch({ headless: true });
        try {
          const page = await browser.newPage();
          const response = await page.goto(
            `${baseUrl}/share/invalid-token?shareLinkId=share_link_missing`,
            { waitUntil: "networkidle" }
          );
          assert(response);
          assert.equal(response.status(), 200);
          await page.getByRole("heading", { name: "Share link unavailable" }).waitFor();
          const heading = await page
            .getByRole("heading", { name: "Share link unavailable" })
            .textContent();
          assert.equal(heading, "Share link unavailable");
          const body = await page.locator("main").textContent();
          assert.match(body ?? "", /invalid|unavailable/);
        } finally {
          await browser.close();
        }
      }
    });
  } finally {
    await rm(databaseDirectory, { recursive: true, force: true });
  }
});
