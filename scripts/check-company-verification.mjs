import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(path) { return readFileSync(resolve(path), "utf8"); }
function fail(message) { console.error(message); process.exit(1); }
function requireMarker(source, marker, label) {
  if (!source.includes(marker)) fail(`${label} lost required M1.08 contract: ${marker}`);
}
function forbidMarker(source, marker, label) {
  if (source.includes(marker)) fail(`${label} contains forbidden M1.08 authority/scope: ${marker}`);
}

const required = [
  "database/migrations/0022_company_registration_verification.up.sql",
  "database/migrations/0023_company_registration_duplicate_claims.up.sql",
  "database/migrations/0024_company_verification_transition_guards.up.sql",
  "database/migrations/0025_company_verification_authority_integration.up.sql",
  "src/lib/company/company-verification-domain.ts",
  "src/lib/company/company-verification-repository.ts",
  "src/lib/company/company-verification-service.ts",
  "src/lib/company/company-verification-secure-file-authority-repository.ts",
  "src/lib/company/company-registration-repository.ts",
  "src/lib/company/company-registration-service.ts",
  "src/lib/company/company-application-secure-file-service.ts",
  "src/app/company/register/page.tsx",
  "src/app/company/register/verify/page.tsx",
  "src/app/company/(portal)/settings/profile/page.tsx",
  "src/app/company/(portal)/settings/profile/actions.ts",
  "src/components/company/company-verification-workspace.tsx",
  "tests/platform/company-verification.test.mjs",
  "tests/platform/company-verification-transition-guards.test.mjs"
];
for (const path of required) if (!existsSync(resolve(path))) fail(`M1.08 implementation is missing ${path}`);

const foundation = read("database/migrations/0022_company_registration_verification.up.sql");
for (const marker of [
  "company_registration_flows", "company_verification_cases", "company_verification_versions",
  "company_verification_evidence", "company_verification_duplicate_signals",
  "company_verification_version_history_guard", "company_verification_evidence_history_guard"
]) requireMarker(foundation, marker, "M1.08 migration 0022");

const duplicateClaims = read("database/migrations/0023_company_registration_duplicate_claims.up.sql");
for (const marker of ["company_registration_flow_case_fk", "registration_fingerprint", "legal_name_fingerprint", "company_verification_registration_claim_idx"])
  requireMarker(duplicateClaims, marker, "M1.08 migration 0023");

const lifecycle = read("database/migrations/0024_company_verification_transition_guards.up.sql");
for (const marker of ["hse_guard_company_verification_case_lifecycle", "hse_guard_company_verification_version_history"])
  requireMarker(lifecycle, marker, "M1.08 migration 0024");

const integration = read("database/migrations/0025_company_verification_authority_integration.up.sql");
for (const marker of [
  "company_verification_secure_file_authorities",
  "company_verification_secure_file_authority_validate_insert",
  "authority.reservation_key = NEW.reservation_key",
  "authority.owner_account_id = NEW.owner_account_id",
  "authority.tenant_id = NEW.tenant_id",
  "authority.membership_id = NEW.membership_id",
  "cases.case_status = 'draft'",
  "versions.version_status = 'draft'",
  "memberships.membership_role IN ('owner', 'admin')",
  "tenants.tenant_status IN ('pending', 'active')",
  "company_verification.updated",
  "company_verification.submitted",
  "company_verification.status.changed"
]) requireMarker(integration, marker, "M1.08 migration 0025");
forbidMarker(integration, "ADD COLUMN IF NOT EXISTS authority_mode", "M1.08 migration 0025 must not mutate M1.06 table shape");

const secureDomain = read("src/lib/secure-files/secure-file-domain.ts");
for (const marker of [
  'authorityMode: "active_tenant"', 'authorityMode: "company_application"',
  "bindTrustedCompanyApplicationSecureFileOwner", "TRUSTED_SECURE_FILE_AUTHORITY_MODES",
  'Object.defineProperty(owner, "authorityMode"', "enumerable: false",
  'membership.tenantStatus !== "active"',
  'membership.tenantStatus !== "pending" && membership.tenantStatus !== "active"',
  'membership.role !== "owner" && membership.role !== "admin"'
]) requireMarker(secureDomain, marker, "M1.08 secure-file authority");

const authorityRepository = read("src/lib/company/company-verification-secure-file-authority-repository.ts");
for (const marker of [
  "COMPANY_VERIFICATION_SECURE_FILE_AUTHORITY_INSERT_SQL",
  'getTrustedSecureFileAuthorityMode(owner) !== "company_application"',
  "cases.current_version_id", "cases.case_status = 'draft'", "versions.version_status = 'draft'",
  "DatabaseSecureFileRepository(Promise.resolve(transaction))", "return files.reserve(owner, intent)"
]) requireMarker(authorityRepository, marker, "M1.08 secure-file claim repository");
for (const forbidden of ["clientCaseId", "clientVersionId", "reviewerId:", "verifierId:", "providerId:"])
  forbidMarker(authorityRepository, forbidden, "M1.08 secure-file claim repository");

const registrationRepository = read("src/lib/company/company-registration-repository.ts");
for (const marker of [
  "'company', 'owner', 'invited'", "WITH activated_membership AS", "membership_status = 'active'",
  "activated_at = $2", "memberships.membership_status = 'invited'", "flows.current_step = 'pending_mfa'",
  "SET current_step = 'complete'"
]) requireMarker(registrationRepository, marker, "M1.08 Company registration membership lifecycle");
forbidMarker(registrationRepository, "'company', 'owner', 'active', $4, $4", "M1.08 must not grant Company owner authority before MFA");

const verificationRepository = read("src/lib/company/company-verification-repository.ts");
for (const marker of [
  "COMPANY_VERIFICATION_MANAGER_GUARD_SQL", "COMPANY_VERIFICATION_DECIDER_GUARD_SQL", "FOR UPDATE",
  "draft_revision = draft_revision + 1", "lifecycle_status = 'available'", "case_status = 'submitted'",
  "case_status = 'under_review'", "tenant_status = 'active'", "activated_at = $2", "activated_at IS NULL",
  "startCorrection", "version_number"
]) requireMarker(verificationRepository, marker, "M1.08 verification repository");
for (const forbidden of ["clientTenantId", "reviewerId:", "verifierId:", "providerId:", "storageRoot:", "objectKey: input"])
  forbidMarker(verificationRepository, forbidden, "M1.08 verification repository");

const registrationService = read("src/lib/company/company-registration-service.ts");
for (const marker of ["verifyTotp", "lastAcceptedCounter: factor.lastAcceptedCounter", "registrationFingerprint: companyRegistrationFingerprint", "createTotpSecret", "pending_email"])
  requireMarker(registrationService, marker, "M1.08 registration service");
forbidMarker(registrationService, "verifyTotpCode", "M1.08 registration service");

for (const path of [
  "src/app/company/(portal)/settings/profile/actions.ts",
  "src/components/company/company-verification-workspace.tsx",
  "src/app/company/register/company-registration-forms.tsx"
]) {
  if (/\bencType=/.test(read(path))) fail(`${path} must not override React Server Action form encoding.`);
}

const tests = read("tests/platform/company-verification.test.mjs");
for (const marker of [
  'const OWNED_MIGRATION = "0025_company_verification_authority_integration"',
  "CompanyVerificationSecureFileAuthorityRepository", "company_verification_secure_file_authorities", "immutable"
]) requireMarker(tests, marker, "M1.08 permanent runtime regression");

// Permanent state ownership: M1.08 protects its accepted product/security contracts
// while legitimate later bricks advance. It must not own the current active brick.
const currentState = read("docs/NEXT_BUILD_UNIT.md");
requireMarker(currentState, "M1.08 Company Registration and Verification — **IMPLEMENTATION MERGED — ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED", "Current build state");
requireMarker(currentState, "M1.09 Sites, Departments and Company Team — **IMPLEMENTATION MERGED — ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED", "Current build state");
requireMarker(currentState, "M1.10 Worker Invitations and Company Codes — **IMPLEMENTATION MERGED — ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED", "Current build state");
requireMarker(currentState, "M1.11 Employment, Experience, Qualification, Skill and Leaving Records — **IMPLEMENTATION MERGED — ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED", "Current build state");
requireMarker(currentState, "# M1.12 — PUBLIC VERIFICATION FOUNDATION — IN PROGRESS", "Current build state");

console.log("Permanent M1.08 Company registration/verification contracts remain protected while the legitimate M1.12 continuation advances.");