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

test("M2.09 integrity owner acceptance boundary launches Chromium", async () => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  await runDevelopmentServer({
    args: ["--port", String(port)],
    probeUrl: `${baseUrl}/integrity`,
    probe: async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(`${baseUrl}/integrity`, { waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: "Simulate camera unavailable" }).click();
        await page.waitForFunction(() => document.querySelector("[data-testid=integrity-state]")?.textContent === "DEGRADED");
        assert.equal(await page.getByTestId("integrity-state").textContent(), "DEGRADED");
        await page.getByRole("button", { name: "Recover browser" }).click();
        await page.waitForFunction(() => document.querySelector("[data-testid=integrity-state]")?.textContent === "RECOVERED");
        assert.equal(await page.getByTestId("integrity-state").textContent(), "RECOVERED");
      } finally {
        await browser.close();
      }
    }
  });
});
