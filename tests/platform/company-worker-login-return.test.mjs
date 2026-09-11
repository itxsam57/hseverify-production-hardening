import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const runtime = process.env.HSE_COMPANY_WORKFORCE_RUNTIME_DIST;
assert.ok(runtime, "HSE_COMPANY_WORKFORCE_RUNTIME_DIST is required");

const returnModule = await import(
  pathToFileURL(join(runtime, "auth", "auth-login-return.js")).href
);
const { safeRoleLoginReturnPath } = returnModule;

test("M1.10 Worker login permits only frozen Company-workforce completion destinations", () => {
  assert.equal(
    safeRoleLoginReturnPath("worker", "/worker/company-access/complete-invitation"),
    "/worker/company-access/complete-invitation"
  );
  assert.equal(
    safeRoleLoginReturnPath("worker", "/worker/company-access/complete-registration"),
    "/worker/company-access/complete-registration"
  );
});

test("M1.10 Worker login rejects external, cross-role and arbitrary return destinations", () => {
  for (const value of [
    "https://evil.example/worker/company-access/complete-registration",
    "//evil.example/worker/company-access/complete-registration",
    "/company/dashboard",
    "/admin/system",
    "/worker/profile",
    "/worker/company-access/complete-registration?next=https://evil.example",
    "worker/company-access/complete-registration",
    ""
  ]) {
    assert.equal(safeRoleLoginReturnPath("worker", value), "/worker/dashboard", value);
  }
});

test("M1.10 return helper never changes non-Worker role homes", () => {
  assert.equal(
    safeRoleLoginReturnPath("company", "/worker/company-access/complete-registration"),
    "/company/dashboard"
  );
  assert.equal(
    safeRoleLoginReturnPath("admin", "/worker/company-access/complete-invitation"),
    "/admin/dashboard"
  );
});
