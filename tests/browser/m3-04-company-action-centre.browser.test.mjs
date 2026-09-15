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

test("M3.04 Company Action Centre crosses the rendered browser boundary", async () => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  await runDevelopmentServer({
    args: ["--port", String(port)],
    probeUrl: `${baseUrl}/company/action-centre`,
    probe: async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const browserErrors = [];
        page.on("console", (message) => {
          if (message.type() === "error") browserErrors.push(message.text());
        });
        page.on("pageerror", (error) => browserErrors.push(error.message));
        const response = await page.goto(`${baseUrl}/company/action-centre`, {
          waitUntil: "domcontentloaded"
        });
        assert(response);
        assert(response.status() < 500);
        assert.match(page.url(), /\/company\/login/);
        assert.match(await page.textContent("body"), /Company sign in|Secure access/i);
        const body = await page.textContent("body");
        assert.doesNotMatch(body ?? "", /credential-target|competency gap|pending owner|overdue/i);
        assert.deepEqual(browserErrors, []);
      } finally {
        await browser.close();
      }
    }
  });
});
