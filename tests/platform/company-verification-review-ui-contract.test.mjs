import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(path, "utf8");
}

test("Admin Company verification review route is fixed-role and reads server-authorized cases", async () => {
  const page = await source("src/app/admin/(portal)/company-verifications/page.tsx");
  assert.match(page, /requirePlatformPermission\(/);
  assert.match(page, /expectedRole:\s*"admin"/);
  assert.match(page, /permission:\s*"platform\.tenants\.manage"/);
  assert.match(page, /getCompanyVerificationReviewService\(\)/);
  assert.match(page, /listForReview\(/);
  assert.match(page, /Company verification review/);
});

test("Admin Company verification actions revalidate live authority and use the canonical service transitions", async () => {
  const actions = await source("src/app/admin/(portal)/company-verifications/actions.ts");
  assert.match(actions, /^"use server";/);
  assert.doesNotMatch(actions, /export\s+(?:const|let|var|class|enum)\s+/);
  assert.match(actions, /export async function beginCompanyVerificationReviewAction/);
  assert.match(actions, /export async function decideCompanyVerificationAction/);
  assert.match(actions, /requirePlatformPermission\(/);
  assert.match(actions, /expectedRole:\s*"admin"/);
  assert.match(actions, /permission:\s*"platform\.tenants\.manage"/);
  assert.match(actions, /\.beginReview\(/);
  assert.match(actions, /\.decide\(/);
  assert.match(actions, /verified/);
  assert.match(actions, /changes_requested/);
  assert.match(actions, /rejected/);
});

test("review read model is live-decider guarded and exposes case/evidence metadata without object storage secrets", async () => {
  const service = await source("src/lib/company/company-verification-review-service.ts");
  assert.match(service, /COMPANY_VERIFICATION_DECIDER_GUARD_SQL/);
  assert.match(service, /company_verification_cases/);
  assert.match(service, /company_verification_versions/);
  assert.match(service, /company_verification_evidence/);
  assert.match(service, /platform_secure_files/);
  assert.match(service, /submitted/);
  assert.match(service, /under_review/);
  assert.doesNotMatch(service, /objectKey:\s*row\.object_key/);
});

test("Admin evidence preview is case-bound, fixed-role and delegated through the review service", async () => {
  const route = await source("src/app/admin/(portal)/company-verifications/[caseId]/evidence/[fileId]/route.ts");
  assert.match(route, /requirePlatformPermission\(/);
  assert.match(route, /expectedRole:\s*"admin"/);
  assert.match(route, /permission:\s*"platform\.tenants\.manage"/);
  assert.match(route, /previewEvidence\(/);
  assert.match(route, /caseId/);
  assert.match(route, /fileId/);
});

test("Administrator navigation exposes Company verification review", async () => {
  const shell = await source("src/components/auth/role-portal-shell.tsx");
  assert.match(shell, /href="\/admin\/company-verifications"/);
  assert.match(shell, />Company verifications</);
});
