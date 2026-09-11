import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function source(path) {
  return readFile(resolve(path), "utf8");
}

test("signed-out portal proxy performs only an optimistic missing-cookie redirect", async () => {
  const [proxy, cookieName, cookieService, authorizationService] =
    await Promise.all([
      source("src/proxy.ts"),
      source("src/lib/auth/auth-session-cookie-name.ts"),
      source("src/lib/auth/auth-session-cookie.ts"),
      source("src/lib/authorization/authorization-service.ts")
    ]);

  assert.match(proxy, /export function proxy\(request: NextRequest\)/);
  assert.match(proxy, /request\.cookies\.has\(authSessionCookieName\(\)\)/);
  assert.match(proxy, /ROLE_LOGIN_PATHS\[role\]/);
  assert.match(proxy, /reason", "session-required"/);
  assert.match(proxy, /NextResponse\.redirect\(loginUrl, 307\)/);
  assert.match(proxy, /return NextResponse\.next\(\)/);
  assert.doesNotMatch(
    proxy,
    /getDatabaseClient|getAuthorizationContextRepository|evaluatePlatformPermission|evaluateTenantPermission|requirePortalAuthorization|requireCurrentTenantPermission|tenantId\s*[:=]|membershipId\s*[:=]/
  );

  for (const role of [
    "worker",
    "company",
    "assessor",
    "verifier",
    "admin",
    "root"
  ]) {
    assert.match(proxy, new RegExp(`/${role}/dashboard/:path\\*`));
  }
  assert.match(proxy, /\/company\/tenant-scope\/:path\*/);

  assert.match(cookieName, /__Host-hse_session/);
  assert.match(cookieName, /hse_session/);
  assert.match(cookieService, /authSessionCookieName/);
  assert.doesNotMatch(cookieService, /function authSessionCookieName/);

  assert.match(authorizationService, /getAuthorizationContextRepository/);
  assert.match(authorizationService, /requirePortalAuthorization/);
  assert.match(authorizationService, /requireCurrentTenantPermission/);
});

test("runtime redirect smoke is permanent inside the complete application gate", async () => {
  const [packageDocument, smoke] = await Promise.all([
    readFile(resolve("package.json"), "utf8").then(JSON.parse),
    source("scripts/smoke-signed-out-portal-redirects.mjs")
  ]);

  assert.equal(
    packageDocument.scripts["test:portal-redirects"],
    "node scripts/smoke-signed-out-portal-redirects.mjs"
  );
  assert.match(packageDocument.scripts.check, /test:portal-redirects/);
  assert.match(smoke, /response\.status,[\s\S]*307/);
  assert.match(smoke, /redirectBody === "" \|\| redirectBody === expected/);
  assert.match(smoke, /doesNotMatch\(redirectBody/);
  assert.match(smoke, /<main class="auth-page" id="main-content">/);
  assert.match(smoke, /worker/);
  assert.match(smoke, /company/);
  assert.match(smoke, /\/company\/tenant-scope/);
});
