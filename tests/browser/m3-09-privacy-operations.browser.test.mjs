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

test("M3.09 privacy operations route crosses browser boundary and requires worker access", async () => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  await runDevelopmentServer({
    args: ["--port", String(port)],
    probeUrl: `${baseUrl}/worker/privacy`,
    probe: async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const response = await page.goto(`${baseUrl}/worker/privacy`, {
          waitUntil: "domcontentloaded"
        });
        assert(response);
        assert(response.status() < 500);
        assert.match(page.url(), /\/worker\/login/);
        assert.equal(errors.length, 0);
      } finally {
        await browser.close();
      }
    }
  });
});
