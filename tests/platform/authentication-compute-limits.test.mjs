import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function source(path) {
  return readFile(resolve(path), "utf8");
}

test("password reset is persistently limited before password hashing", async () => {
  const recoveryService = await source("src/lib/auth/auth-recovery-service.ts");
  const resetSection = recoveryService.slice(
    recoveryService.indexOf("async resetPassword"),
    recoveryService.indexOf("async resend")
  );
  assert.match(resetSection, /context: "reset"/);
  assert.match(resetSection, /MAX_RECOVERY_RESET_ATTEMPTS/);
  assert.ok(
    resetSection.indexOf("await this.enforceRateLimit") <
      resetSection.indexOf("await hashPassword")
  );
});

test("staff profile enrollment is limited before provisioning hashes the password", async () => {
  const [action, limiter] = await Promise.all([
    source("src/app/staff/invite/accept/actions.ts"),
    source("src/lib/auth/staff-enrollment-rate-limit.ts")
  ]);
  assert.match(action, /enforceStaffProfileEnrollmentRateLimit/);
  assert.ok(
    action.indexOf("await enforceStaffProfileEnrollmentRateLimit") <
      action.indexOf(".completeProfile")
  );
  assert.match(limiter, /consumeAccessRateLimit/);
  assert.match(limiter, /MAX_STAFF_PROFILE_ATTEMPTS/);
  assert.match(limiter, /staff-enrollment-profile-rate-limit/);
});
