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

test("M1.07 Worker identity routes render in Chromium", async () => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  await runDevelopmentServer({
    args: ["--port", String(port)],
    probeUrl: `${baseUrl}/worker/identity`,
    probe: async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const errors = [];
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        page.on("pageerror", (error) => errors.push(error.message));

        const response = await page.goto(`${baseUrl}/worker/identity`, {
          waitUntil: "domcontentloaded"
        });
        assert(response);
        assert(response.status() < 500);

        const body = await page.textContent("body");
        assert(body);
        assert.match(body, /Worker|Identity|Verified account contacts/);

        assert.equal(errors.filter((error) => !error.includes("favicon")).length, 0);
      } finally {
        await browser.close();
      }
    }
  });
});
