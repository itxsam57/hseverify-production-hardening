import assert from "node:assert/strict";
import { createServer } from "node:net";
import { chromium } from "playwright";
import test from "node:test";

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

test("design system production routes render interactive accessible controls", async () => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  await runDevelopmentServer({
    args: ["--port", String(port)],
    probeUrl: `${baseUrl}/worker/login`,
    probe: async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        const response = await page.goto(`${baseUrl}/worker/login`, { waitUntil: "domcontentloaded" });

        assert(response);
        assert.equal(response.status(), 200);
        await page.getByText(/Worker/i).first().waitFor();

        const controls = await page.locator("button, input, a").evaluateAll((nodes) => nodes.filter((node) => {
          const style = window.getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && node.getAttribute("type") !== "hidden";
        }).map((node) => ({
          tag: node.tagName,
          name: node.getAttribute("aria-label") || node.textContent || node.getAttribute("placeholder") || node.getAttribute("alt") || ""
        })));

        assert.ok(controls.length > 0);
        assert.ok(controls.some((control) => control.tag === "BUTTON" && control.name.trim().length > 0));
      } finally {
        await browser.close();
      }
    }
  });
});
