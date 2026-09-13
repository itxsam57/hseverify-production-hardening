import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { bootstrapCompanyVerificationRuntimeTest } from "../helpers/company-verification-runtime-bootstrap.mjs";

bootstrapCompanyVerificationRuntimeTest(import.meta.url);

const runtime = process.env.HSE_COMPANY_VERIFICATION_RUNTIME_DIST;
assert.ok(runtime, "HSE_COMPANY_VERIFICATION_RUNTIME_DIST is required");

process.env.HSE_APP_ENV = "production";
process.env.HSE_DATABASE_DRIVER = "postgres";
process.env.DATABASE_URL = "postgresql://example.invalid/hseverify";
process.env.HSE_RELEASE_SHA = "m1-08-storage-boundary";
process.env.HSE_SESSION_SECRET = "m1-08-storage-boundary-session-secret-1234567890";
process.env.HSE_AUTH_PEPPER = "m1-08-storage-boundary-auth-pepper-1234567890";
process.env.HSE_ENABLE_AUTH_SANDBOX = "false";
process.env.HSE_ENABLE_WORKER_DEMO_AUTH = "false";
process.env.HSE_USE_WORKER_DEMO_DATA = "false";

const reviewModule = await import(
  pathToFileURL(join(runtime, "company", "company-verification-review-service.js")).href
);
const domainModule = await import(
  pathToFileURL(join(runtime, "company", "company-verification-domain.js")).href
);

const { CompanyVerificationReviewService } = reviewModule;
const { CompanyVerificationAccessDeniedError } = domainModule;

const principal = Object.freeze({
  accountId: "account_admin_storage_guard",
  sessionId: "session_admin_storage_guard",
  activeRole: "admin",
  tenantMembership: null,
  accountStatus: "active",
  email: "admin-storage-guard@example.com",
  displayName: "Storage Guard Admin",
  createdAt: "2026-09-12T00:00:00.000Z",
  lastSeenAt: "2026-09-12T00:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z"
});

test("M1.08 Company verification evidence preview fails closed before file lookup in production", async () => {
  let queryCount = 0;
  const database = {
    async query() {
      queryCount += 1;
      if (queryCount === 1) {
        return { rows: [{ session_id: principal.sessionId }] };
      }
      throw new Error("production preview crossed the local-storage boundary");
    }
  };

  const service = new CompanyVerificationReviewService(database);
  await assert.rejects(
    () => service.previewEvidence(
      principal,
      "company_case_storage_guard",
      "secure_file_storage_guard_123456",
      new Date("2026-09-12T00:00:00.000Z")
    ),
    CompanyVerificationAccessDeniedError
  );
  assert.equal(queryCount, 1);
});
