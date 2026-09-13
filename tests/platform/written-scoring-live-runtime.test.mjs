import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:net";
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

test("written scoring verifier boundary runs through the application runtime", async () => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  await runDevelopmentServer({
    args: ["--port", String(port)],
    probeUrl: `${baseUrl}/verifier/reviews/scoring`,
    probe: async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const response = await page.goto(`${baseUrl}/verifier/reviews/scoring`, { waitUntil: "domcontentloaded" });
        assert(response);
        assert(response.status() < 500);
        assert.match(page.url(), /\/verifier\/login/);
      } finally {
        await browser.close();
      }
    }
  });
});
