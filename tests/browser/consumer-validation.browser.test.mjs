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
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a browser-test port."));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

test("consumer forms preserve context, expose every required error, and retain visible keyboard focus", { timeout: 120_000 }, async () => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  await runDevelopmentServer({
    args: ["--hostname", "127.0.0.1", "--port", String(port)],
    probeUrl: `${baseUrl}/worker/register`,
    probe: async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1365, height: 768 } });

        await page.goto(`${baseUrl}/worker/register`, { waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: "Create Worker account" }).click();
        await page.getByText("Check the highlighted registration details.", { exact: true }).waitFor();
        const confirmation = page.getByLabel("Confirm password");
        assert.equal(await confirmation.getAttribute("aria-invalid"), "true");
        await page.getByText("Confirm your password.", { exact: true }).waitFor();
        assert.match(await confirmation.getAttribute("aria-describedby") ?? "", /confirmPassword-error/);

        await page.goto(`${baseUrl}/company/register`, { waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: "Create Company application" }).click();
        await page.getByText("Check the highlighted Company registration details.", { exact: true }).waitFor();
        assert.equal(new URL(page.url()).pathname, "/company/register");
        assert.equal(await page.getByLabel("Legal Company name").getAttribute("aria-invalid"), "true");

        await page.goto(`${baseUrl}/worker/login`, { waitUntil: "domcontentloaded" });
        const signIn = page.getByRole("button", { name: "Sign in" });
        await signIn.focus();
        const focus = await signIn.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            outlineStyle: style.outlineStyle,
            outlineWidth: style.outlineWidth,
            outlineColor: style.outlineColor,
            boxShadow: style.boxShadow
          };
        });
        const hasOutline = focus.outlineStyle !== "none" && Number.parseFloat(focus.outlineWidth) >= 2;
        const hasShadow = focus.boxShadow !== "none";
        assert(hasOutline || hasShadow, `Primary button has no visible focus indicator: ${JSON.stringify(focus)}`);
      } finally {
        await browser.close();
      }
    }
  });
});
