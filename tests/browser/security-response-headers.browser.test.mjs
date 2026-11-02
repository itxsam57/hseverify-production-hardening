import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

test("real HTTP login and signed-out redirects enforce CSP, HSTS, frame and content protections", { timeout: 120_000 }, async () => {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const environment = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_SESSION_SECRET: "a23-synthetic-session-secret-for-isolated-headers",
    HSE_AUTH_PEPPER: "a23-synthetic-auth-pepper-for-isolated-headers",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_RELEASE_SHA: "a23-security-header-local"
  };
  await runDevelopmentServer({
    args: ["--hostname", "127.0.0.1", "--port", String(port)],
    probeUrl: baseUrl + "/worker/login",
    projectRoot: process.cwd(),
    environment,
    probe: async () => {
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        for (const path of ["/worker/login", "/company/login"]) {
          const response = await page.request.get(baseUrl + path);
          assert.equal(response.status(), 200, path);
          const headers = response.headers();
          const csp = headers["content-security-policy"];
          assert.match(csp ?? "", /default-src 'self'/);
          assert.match(csp, /frame-ancestors 'none'/);
          assert.match(csp, /object-src 'none'/);
          assert.match(csp, /form-action 'self'/);
          assert.match(headers["strict-transport-security"] ?? "", /max-age=31536000/);
          assert.equal(headers["x-content-type-options"], "nosniff");
          assert.equal(headers["x-frame-options"], "DENY");
          assert.match(headers["permissions-policy"] ?? "", /geolocation=\(\)/);
          assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin");
          assert.equal(headers["x-powered-by"], undefined);
          const body = await response.text();
          assert.equal(body.includes(environment.HSE_SESSION_SECRET), false, "Session secret leaked to browser");
          assert.equal(body.includes(environment.HSE_AUTH_PEPPER), false, "Auth pepper leaked to browser");
        }
        const redirect = await page.request.get(baseUrl + "/worker/dashboard", { maxRedirects: 0 });
        assert.equal(redirect.status(), 307);
        assert.match(redirect.headers().location ?? "", /^\/worker\/login\?reason=session-required$/);
      } finally {
        await browser.close();
      }
    }
  });
});
