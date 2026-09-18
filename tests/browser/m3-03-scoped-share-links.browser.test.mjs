import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";
import { execFileSync } from "node:child_process";

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
  execFileSync("node", ["scripts/db-migrate.mjs"], {
    stdio: "inherit"
  });
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  await runDevelopmentServer({
    args: ["--port", String(port)],
    probeUrl: `${baseUrl}/api/share-links?ownerWorkerId=HSE-WRK-000321`,
    probe: async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const response = await page.goto(`${baseUrl}/share/invalid-token?shareLinkId=share_link_missing`, { waitUntil: "networkidle" });
        assert(response);
        assert.equal(response.status(), 200);
        await page.getByRole("heading", { name: "Share link unavailable" }).waitFor();
        const heading = await page.getByRole("heading", { name: "Share link unavailable" }).textContent();
        assert.equal(heading, "Share link unavailable");
        const body = await page.locator("main").textContent();
        assert.match(body ?? "", /invalid|unavailable/);
      } finally {
        await browser.close();
      }
    }
  });
});
