import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const ROLES = ["worker", "company", "assessor", "verifier", "admin", "root"];
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function decodeBase32(secret) {
  let bits = 0, carry = 0;
  const bytes = [];
  for (const c of secret.toUpperCase().replace(/=+$/g, "")) {
    const i = BASE32.indexOf(c);
    if (i < 0) throw Error("Invalid synthetic MFA secret");
    carry = (carry << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((carry >>> (bits - 8)) & 255);
      bits -= 8;
      carry &= bits ? (1 << bits) - 1 : 0;
    }
  }
  return Buffer.from(bytes);
}
function totp(secret) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  return String((digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      s.close(error => error ? reject(error) : resolve(addr.port));
    });
  });
}
async function signIn(page, baseUrl, identity, role) {
  await page.goto(baseUrl + "/" + role + "/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  if (role !== "worker") await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/" + role + "/dashboard", { timeout: 30000 });
}
test("M1.04.01 real Admin Server Action POST rejects five foreign role sessions and unauthenticated replay", { timeout: 300000 }, async () => {
  const root = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "hse-m10401-cross-action-"));
  const port = await freePort();
  const baseUrl = "http://127.0.0.1:" + port;
  const target = "/admin/frameworks";
  const reference = "M10401-" + randomBytes(4).toString("hex").toUpperCase();
  const env = {
    ...process.env,
    HSE_APP_ENV: "development",
    HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: directory,
    HSE_AUDIT_CREDENTIALS_PATH: join(directory, "credentials.json"),
    HSE_RELEASE_SHA: "m10401-crossportal-post-action",
    HSE_SESSION_SECRET: "m10401-synthetic-session-secret-more-than-thirty-two",
    HSE_AUTH_PEPPER: "m10401-synthetic-auth-pepper-more-than-thirty-two",
    HSE_ENABLE_WORKER_DEMO_AUTH: "false",
    HSE_USE_WORKER_DEMO_DATA: "false"
  };
  try {
    for (const script of ["scripts/db-migrate.mjs", "scripts/independent-audit-seed.mjs"]) {
      const result = spawnSync(process.execPath, [script], { cwd: root, env, encoding: "utf8", timeout: 120000 });
      assert.equal(result.status, 0, script + " failed: " + (result.stderr || result.stdout).slice(-2000));
    }
    const identities = JSON.parse(await readFile(env.HSE_AUDIT_CREDENTIALS_PATH, "utf8"));
    await runDevelopmentServer({
      args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: baseUrl + "/admin/login",
      projectRoot: root,
      environment: env,
      probe: async () => {
        const browser = await chromium.launch({ headless: true });
        try {
          const admin = await browser.newContext({ viewport: { width: 390, height: 844 } });
          const page = await admin.newPage();
          await signIn(page, baseUrl, identities.admin, "admin");
          await page.goto(baseUrl + target, { waitUntil: "networkidle" });
          assert.ok(await page.getByRole("button", { name: "Create framework", exact: true }).isVisible());

          let captured;
          let captureResolve;
          const capture = new Promise(resolve => { captureResolve = resolve; });
          await page.route("**/admin/frameworks", async route => {
            const req = route.request();
            if (req.method() === "POST") {
              const headers = await req.allHeaders();
              captured = { body: req.postDataBuffer(), headers };
              captureResolve();
              await route.abort("blockedbyclient");
              return;
            }
            await route.continue();
          });
          await page.getByLabel("Reference", { exact: true }).fill(reference);
          await page.locator("form").filter({ has: page.getByRole("heading", { name: "Create framework", exact: true }) }).getByLabel("Title", { exact: true }).fill("Synthetic forbidden cross-portal POST proof");
          await page.getByRole("button", { name: "Create framework", exact: true }).click();
          await Promise.race([capture, new Promise((_, reject) => setTimeout(() => reject(Error("Admin browser Server Action POST not captured")), 20000))]);
          assert.ok(captured.body?.length > 0, "Must replay real browser-generated POST payload");
          assert.ok(captured.headers["next-action"], "Must capture a genuine Next Server Action identifier, not an invented endpoint");
          console.log("M10401_CAPTURED_REAL_ADMIN_ACTION", JSON.stringify({
            bytes: captured.body.length, serverAction: Boolean(captured.headers["next-action"])
          }));
          const baseHeaders = {
            "next-action": captured.headers["next-action"],
            "content-type": captured.headers["content-type"],
            "accept": captured.headers.accept || "text/x-component",
            "origin": baseUrl
          };
          if (captured.headers["next-router-state-tree"]) {
            baseHeaders["next-router-state-tree"] = captured.headers["next-router-state-tree"];
          }

          for (const role of ROLES.filter(value => value !== "admin")) {
            const context = await browser.newContext({ viewport: { width: 320, height: 740 } });
            try {
              const foreignPage = await context.newPage();
              await signIn(foreignPage, baseUrl, identities[role], role);
              const cookieNames = (await context.cookies()).map(c => c.name);
              assert.ok(cookieNames.some(name => name.toLowerCase().includes("session")), role + " must be signed in for this probe");
              const resp = await context.request.post(baseUrl + target + "?role=admin&activeRole=admin", {
                data: captured.body,
                headers: {
                  ...baseHeaders,
                  "x-hse-role": "admin",
                  "x-hse-active-role": "admin",
                  "x-hse-account-id": identities.admin.accountId
                },
                maxRedirects: 0,
                timeout: 30000
              });
              const body = await resp.text();
              const redirect = resp.headers()["x-action-redirect"] || resp.headers().location || "";
              console.log("M10401_FOREIGN_SIGNED_ACTION_REPLAY", JSON.stringify({
                role, http: resp.status(), redirect, bodyBytes: body.length
              }));
              assert.ok(resp.status() < 500, role + " action replay encountered HTTP " + resp.status());
              assert.ok(redirect.includes("/access-denied") || body.includes("/access-denied"),
                role + " real privileged Server Action replay must deny wrong-role principal");
              assert.ok(!body.includes("Synthetic forbidden cross-portal POST proof"),
                role + " response leaked submitted private payload");
            } finally {
              await context.close();
            }
          }
          const anonymous = await browser.newContext();
          try {
            const resp = await anonymous.request.post(baseUrl + target, {
              headers: baseHeaders, data: captured.body, maxRedirects: 0, timeout: 30000
            });
            const body = await resp.text();
            const redirect = resp.headers()["x-action-redirect"] || resp.headers().location || "";
            console.log("M10401_SIGNED_OUT_ACTION_REPLAY", JSON.stringify({ http: resp.status(), redirect }));
            assert.ok(resp.status() < 500 && (redirect.includes("/login") || body.includes("/login")),
              "Signed-out forged action must require authentication without a mutation");
          } finally { await anonymous.close(); }
          await page.unroute("**/admin/frameworks");
          const allowedPage = await admin.newPage();
          await allowedPage.goto(baseUrl + target, { waitUntil: "domcontentloaded" });
          await allowedPage.getByLabel("Reference", { exact: true }).fill(reference);
          await allowedPage.locator("form").filter({ has: allowedPage.getByRole("heading", { name: "Create framework", exact: true }) }).getByLabel("Title", { exact: true }).fill("Authorized Admin framework");
          await allowedPage.getByRole("button", { name: "Create framework", exact: true }).click();
          await allowedPage.waitForURL("**/admin/frameworks?status=framework-created", { timeout: 30000 });
          await allowedPage.getByText("Framework created.", { exact: true }).waitFor();
          console.log("M10401_AUTHORIZED_ADMIN_BROWSER_CREATED", reference);
          await admin.close();
        } finally { await browser.close(); }
      }
    });
    const db = new PGlite(directory);
    try {
      const frameworks = await db.query(
        "SELECT framework_reference,title,created_by_account_id FROM assurance_frameworks WHERE framework_reference=$1",
        [reference]
      );
      assert.equal(frameworks.rows.length, 1, "One authorized Admin create only, never foreign or anonymous writes");
      assert.equal(frameworks.rows[0].created_by_account_id, identities.admin.accountId);
      assert.equal(frameworks.rows[0].title, "Authorized Admin framework");
      const denied = await db.query(
        "SELECT account_id,active_role,metadata FROM auth_security_events WHERE event_type='access_denied' AND metadata->>'expectedRole'='admin' AND metadata->>'permission'='platform.operations.manage'"
      );
      for (const role of ROLES.filter(value => value !== "admin")) {
        const matching = denied.rows.filter(row =>
          row.account_id === identities[role].accountId && row.active_role === role
          && row.metadata.reason === "role_mismatch"
        );
        assert.ok(matching.length >= 1, role + " missing role-specific immutable security denial event");
      }
      console.log("M10401_REAL_SERVER_ACTION_CROSS_ROLE_DB", JSON.stringify({
        authorizedCreated: frameworks.rows.length,
        fiveForeignDenials: 5,
        auditEvents: denied.rows.length
      }));
    } finally { await db.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
