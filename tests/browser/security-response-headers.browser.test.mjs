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
          assert.match(csp, /script-src[^;]*'nonce-[^']+'/, "per-request CSP nonce is required");
          assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/, "do not permit arbitrary inline scripts");
          assert.match(headers["strict-transport-security"] ?? "", /max-age=31536000/);
          assert.equal(headers["x-content-type-options"], "nosniff");
          assert.equal(headers["x-frame-options"], "DENY");
          assert.match(headers["permissions-policy"] ?? "", /geolocation=\(\)/);
          assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin");
          assert.equal(headers["x-powered-by"], undefined);
          const body = await response.text();
          assert.equal(body.includes(environment.HSE_SESSION_SECRET), false, "Session secret leaked to browser");
          assert.equal(body.includes(environment.HSE_AUTH_PEPPER), false, "Auth pepper leaked to browser");

          // Test normal HTML inline event handling, not page.evaluate's
          // privileged script injection (strict-dynamic may trust those).
          const documentResponse = await page.goto(baseUrl + path, { waitUntil: "domcontentloaded" });
          assert.equal(documentResponse.status(), 200);
          const policy = documentResponse.headers()["content-security-policy"] ?? "";
          assert.match(policy, /script-src[^;]*'nonce-[^']+'/);
          const proof = await page.evaluate(async () => {
            const violations = [];
            const onViolation = (event) => violations.push(event.violatedDirective);
            document.addEventListener("securitypolicyviolation", onViolation);
            const image = document.createElement("img");
            // Wait for the real resource error rather than assuming that the dev
            // server and the browser finish this request within 300 ms. Keep the
            // strict script-src-attr violation assertion below unchanged.
            const resourceError = new Promise((resolve) => image.addEventListener("error", resolve, { once: true }));
            image.setAttribute("onerror", 'document.documentElement.dataset.hseCspTest = "ran"');
            image.src = "/hse-nonce-csp-harmless-missing-image.png?csp-probe=" + encodeURIComponent(location.pathname);
            document.body.appendChild(image);
            await Promise.race([
              (async () => {
                await resourceError;
                for (let i = 0; i < 30 && !violations.includes("script-src-attr"); i += 1) {
                  await new Promise((resolve) => setTimeout(resolve, 100));
                }
              })(),
              new Promise((resolve) => setTimeout(resolve, 5000))
            ]);
            const executed = document.documentElement.dataset.hseCspTest === "ran";
            delete document.documentElement.dataset.hseCspTest;
            image.remove();
            document.removeEventListener("securitypolicyviolation", onViolation);
            return { executed, violations };
          });
          assert.equal(proof.executed, false, "non-nonced inline event handler must not execute");
          assert.ok(proof.violations.includes("script-src-attr"), `browser must enforce script-src-attr; observed=${JSON.stringify(proof.violations)}`);
        }
        const deniedFile = await page.request.get(baseUrl + "/api/secure-files/preview", { maxRedirects: 0 });
        assert.equal(deniedFile.status(), 404);
        assert.match(deniedFile.headers()["content-security-policy"] ?? "", /script-src 'none'/);
        assert.match(deniedFile.headers()["cache-control"] ?? "", /no-store/);

        const redirect = await page.request.get(baseUrl + "/worker/dashboard", { maxRedirects: 0 });
        assert.equal(redirect.status(), 307);
        assert.match(redirect.headers().location ?? "", /^\/worker\/login\?reason=session-required$/);
      } finally {
        await browser.close();
      }
    }
  });
});
