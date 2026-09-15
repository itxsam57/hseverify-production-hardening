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

const PUBLIC_ROUTES = [
  ["/", "HSE Verify"],
  ["/verify", "Verify"],
  ["/worker/login", "Worker"],
  ["/company/login", "Company"],
  ["/admin/login", "Admin"],
  ["/verifier/login", "Verifier"],
  ["/assessor/login", "Assessor"],
];

async function assertViewport(page, route, width, height) {
  await page.setViewportSize({ width, height });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert(
    overflow <= 1,
    `${route} overflows at ${width}px by ${overflow}px`,
  );
}

test("HSE-X02 public portal matrix renders responsive failure-safe pages", async () => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  await runDevelopmentServer({
    args: ["--port", String(port)],
    probeUrl: `${baseUrl}/`,
    probe: async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const consoleErrors = [];
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text());
        });
        page.on("pageerror", (error) => consoleErrors.push(error.message));

        for (const [route, text] of PUBLIC_ROUTES) {
          const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
          assert(response, `${route} returned no response`);
          assert(response.status() < 500, `${route} returned ${response.status()}`);
          await page.getByText(text, { exact: false }).first().waitFor({ timeout: 10000 });
          await assertViewport(page, route, 1440, 1000);
          await assertViewport(page, route, 390, 844);
          const title = await page.title();
          assert(title.length > 0, `${route} has no document title`);
          const interactiveWithoutName = await page.evaluate(() =>
            [...document.querySelectorAll("button, a, input")].filter((node) => {
              const style = window.getComputedStyle(node);
              if (style.display === "none" || style.visibility === "hidden" || node.type === "hidden") return false;
              const labelledBy = node.getAttribute("aria-labelledby");
              const labelText = labelledBy ? document.getElementById(labelledBy)?.textContent : node.labels?.[0]?.textContent;
              const name = node.getAttribute("aria-label") || labelText || node.textContent || node.getAttribute("placeholder") || node.getAttribute("alt");
              return !name || !name.trim();
            }).length,
          );
          assert.equal(interactiveWithoutName, 0, `${route} has unnamed controls`);
        }

        const failureResponse = await page.goto(`${baseUrl}/verify/result/invalid-token`, { waitUntil: "domcontentloaded" });
        assert(failureResponse, "/verify/result/invalid-token returned no response");
        assert(failureResponse.status() < 500, "failure state crashed");
        await page.getByText(/Verify|invalid|not found|unavailable/i).first().waitFor({ timeout: 10000 });

        assert.deepEqual(consoleErrors, []);
      } finally {
        await browser.close();
      }
    }
  });
});
