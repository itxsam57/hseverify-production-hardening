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

test("M1.11 Worker evidence routes render through real Chromium", async () => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  await runDevelopmentServer({
    args: ["--port", String(port)],
    probeUrl: `${baseUrl}/worker/profile`,
    probe: async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const consoleErrors = [];
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("pageerror", (error) => consoleErrors.push(error.message));

        for (const path of ["/worker/profile", "/worker/register", "/worker/login"]) {
          const response = await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
          assert(response);
          assert(response.status() < 500);
        }

        if (consoleErrors.length) console.log(JSON.stringify(consoleErrors));
        const runtimeErrors = consoleErrors.filter((error) =>
          !error.includes("favicon") &&
          !error.includes("_next/hmr") &&
          !error.includes("Failed to load resource: the server responded with a status of 403")
        );
        assert.equal(runtimeErrors.length, 0);
      } finally {
        await browser.close();
      }
    }
  });
});
