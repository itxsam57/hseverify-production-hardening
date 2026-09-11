import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(message);
  process.exit(1);
}
function read(path) {
  if (!existsSync(resolve(path))) fail(`M1.10 required production surface is missing: ${path}`);
  return readFileSync(resolve(path), "utf8");
}
function requireMarker(text, marker, label) {
  if (!text.includes(marker)) fail(`${label} is missing M1.10 contract evidence: ${marker}`);
}
function requirePattern(text, pattern, label, fact) {
  if (!pattern.test(text)) fail(`${label} is missing M1.10 contract evidence: ${fact}`);
}
function forbidPattern(text, pattern, label, fact) {
  if (pattern.test(text)) fail(`${label} contains forbidden M1.10 evidence: ${fact}`);
}

const paths = Object.freeze({
  up: "database/migrations/0028_company_worker_invitations_codes.up.sql",
  down: "database/migrations/0028_company_worker_invitations_codes.down.sql",
  hardeningUp: "database/migrations/0029_company_worker_invitations_cross_brick_hardening.up.sql",
  hardeningDown: "database/migrations/0029_company_worker_invitations_cross_brick_hardening.down.sql",
  domain: "src/lib/company/company-workforce-domain.ts",
  service: "src/lib/company/company-workforce-service.ts",
  auditDomain: "src/lib/audit/audit-domain.ts",
  actions: "src/app/company/(portal)/invitations/actions.ts",
  page: "src/app/company/(portal)/invitations/page.tsx",
  workspace: "src/components/company/company-workforce-invitations-workspace.tsx",
  companyPortalShell: "src/components/auth/role-portal-shell.tsx",
  workerNavigation: "src/components/worker/worker-navigation.tsx",
  workerInvitationPage: "src/app/worker/company-invitations/[token]/page.tsx",
  workerInvitationActions: "src/app/worker/company-invitations/[token]/actions.ts",
  workerAccessPage: "src/app/worker/(portal)/company-access/page.tsx",
  workerAccessActions: "src/app/worker/(portal)/company-access/actions.ts",
  registrationForm: "src/app/worker/register/registration-forms.tsx",
  registrationActions: "src/app/worker/register/actions.ts",
  registrationBinding: "src/lib/company/company-workforce-registration-binding.ts",
  packageJson: "package.json",
  runner: "scripts/run-company-worker-invitation-tests.mjs",
  runtimeTest: "tests/platform/company-worker-invitations.test.mjs",
  migrationTest: "tests/platform/company-worker-invitations-migration-stack.test.mjs"
});

const up = read(paths.up);
const down = read(paths.down);
const hardeningUp = read(paths.hardeningUp);
const hardeningDown = read(paths.hardeningDown);
const domain = read(paths.domain);
const service = read(paths.service);
const auditDomain = read(paths.auditDomain);
read(paths.runner);
read(paths.runtimeTest);
read(paths.migrationTest);

for (const marker of [
  "company_worker_invitations",
  "company_registration_codes",
  "company_worker_links",
  "token_hash",
  "code_hash",
  "usage_limit",
  "usage_count",
  "payment_responsibility",
  "site_id",
  "department_id",
  "worker_identity_worker_ids",
  "platform_audit_events"
]) requireMarker(up, marker, paths.up);

requirePattern(down, /(?:monotonic|security|history)[\s\S]*SELECT\s+1/i, paths.down, "monotonic rollback contract");
forbidPattern(
  down,
  /DROP\s+(?:TABLE|TRIGGER|FUNCTION|CONSTRAINT)[\s\S]*(?:company_worker|company_registration|platform_audit)/i,
  paths.down,
  "destructive rollback of accepted M1.10 workforce/audit invariants"
);
requirePattern(hardeningDown, /(?:monotonic|hardening|reversible)[\s\S]*SELECT\s+1/i, paths.hardeningDown, "monotonic cross-brick hardening rollback");
forbidPattern(hardeningDown, /ADD\s+CONSTRAINT|REFERENCES\s+/i, paths.hardeningDown, "reintroduction of lower-brick hard foreign keys during rollback");

requirePattern(up, /CHECK\s*\([^)]*usage_count\s*<=\s*usage_limit/i, paths.up, "usage count cannot exceed code usage limit");
requirePattern(up, /payment_responsibility[\s\S]{0,220}(?:company|worker)/i, paths.up, "bounded company/worker payment responsibility");
forbidPattern(up, /\b(?:raw_)?(?:invitation_)?token\s+(?:TEXT|VARCHAR|CHAR)/i, paths.up, "raw invitation token persistence");
forbidPattern(up, /\b(?:raw_)?(?:registration_)?code\s+(?:TEXT|VARCHAR|CHAR)/i, paths.up, "raw Company code persistence");

for (const constraint of [
  "company_worker_invitations_tenant_id_fkey",
  "company_worker_invitations_invited_by_membership_id_fkey",
  "company_worker_invitations_accepted_by_worker_account_id_fkey",
  "company_worker_invitation_site_fk",
  "company_worker_invitation_department_fk",
  "company_registration_codes_tenant_id_fkey",
  "company_registration_codes_created_by_membership_id_fkey",
  "company_registration_code_site_fk",
  "company_registration_code_department_fk",
  "company_worker_links_tenant_id_fkey",
  "company_worker_links_worker_account_id_fkey",
  "company_worker_links_permanent_worker_id_fkey",
  "company_worker_links_requested_by_membership_id_fkey",
  "company_worker_link_site_fk",
  "company_worker_link_department_fk"
]) requireMarker(hardeningUp, `DROP CONSTRAINT IF EXISTS ${constraint}`, paths.hardeningUp);
for (const guard of [
  "hse_validate_company_worker_invitation_authority",
  "hse_validate_company_registration_code_authority",
  "hse_validate_company_worker_link_authority"
]) requireMarker(hardeningUp, guard, paths.hardeningUp);
for (const lowerAuthority of ["platform_tenants", "auth_tenant_memberships", "auth_accounts", "auth_account_roles"])
  requireMarker(hardeningUp, lowerAuthority, paths.hardeningUp);
requireMarker(up, "hse_validate_company_workforce_scope", paths.up);
requireMarker(up, "hse_validate_company_worker_link_identity", paths.up);
requireMarker(hardeningUp, "Company workforce tenant is unavailable.", paths.hardeningUp);
requireMarker(hardeningUp, "Company workforce membership is unavailable.", paths.hardeningUp);

requireMarker(domain, 'COMPANY_WORKFORCE_MANAGE_PERMISSION = "company.workforce.manage"', paths.domain);
requireMarker(service, "COMPANY_WORKFORCE_MANAGE_PERMISSION", paths.service);
for (const marker of [
  "runTenantScopedCommand",
  "hashOpaqueValue",
  "createOpaqueToken",
  "company_verification_cases",
  "worker_identity_worker_ids",
  "company_worker_invitations",
  "company_registration_codes",
  "company_worker_links"
]) requireMarker(service, marker, paths.service);
for (const marker of ["company", "worker", "pending", "revoked", "accepted"])
  requireMarker(domain, marker, paths.domain);

const workforceAuditActions = [
  "company_workforce.invitation.created",
  "company_workforce.invitation.resent",
  "company_workforce.invitation.revoked",
  "company_workforce.invitation.accepted",
  "company_workforce.code.created",
  "company_workforce.code.revoked",
  "company_workforce.code.redeemed",
  "company_workforce.link.requested",
  "company_workforce.link.accepted",
  "company_workforce.link.revoked"
];
for (const action of workforceAuditActions) requireMarker(auditDomain, action, paths.auditDomain);
requireMarker(service, "DatabaseAuditRepository", paths.service);
forbidPattern(service, /INSERT\s+INTO\s+platform_audit_events/i, paths.service, "direct audit-table writes that bypass DatabaseAuditRepository");

const actions = read(paths.actions);
const page = read(paths.page);
const workspace = read(paths.workspace);
const companyPortalShell = read(paths.companyPortalShell);
const workerNavigation = read(paths.workerNavigation);
forbidPattern(actions, /\b(?:tenantId|actorAccountId|membershipId|authorizedTenantPermission|companyVerified)\s*:/, paths.actions, "browser-provided authorization context");
requireMarker(actions, "requireCurrentTenantPermission", paths.actions);
requireMarker(actions, "company.workforce.manage", paths.actions);
requireMarker(page, "Company", paths.page);
requirePattern(`${page}\n${workspace}`, /invitation/i, "M1.10 Company invitation UI", "invitation workflow");
requirePattern(workspace, /(?:CSV|bulk)/i, paths.workspace, "bulk CSV workflow");
requirePattern(workspace, /(?:registration code|company code)/i, paths.workspace, "Company registration code workflow");
forbidPattern(`${actions}\n${page}\n${workspace}`, /paste\s+(?:the\s+)?(?:invitation\s+)?token/i, "M1.10 invitation UX", "manual opaque invitation-token paste workflow");
requireMarker(companyPortalShell, 'href="/company/invitations"', paths.companyPortalShell);
requireMarker(workerNavigation, 'href: "/worker/company-access"', paths.workerNavigation);

const workerInvitationPage = read(paths.workerInvitationPage);
const workerInvitationActions = read(paths.workerInvitationActions);
const workerAccessPage = read(paths.workerAccessPage);
const workerAccessActions = read(paths.workerAccessActions);
const registrationForm = read(paths.registrationForm);
const registrationActions = read(paths.registrationActions);
const registrationBinding = read(paths.registrationBinding);
const packageJson = read(paths.packageJson);

for (const [source, label] of [
  [actions, paths.actions],
  [workerInvitationActions, paths.workerInvitationActions],
  [workerAccessActions, paths.workerAccessActions]
]) {
  requireMarker(source, '"use server"', label);
  forbidPattern(
    source,
    /export\s+const\s+\w+[\s\S]{0,200}=\s*Object\.freeze\s*\(/,
    label,
    "non-function object export from a use-server action module"
  );
}

requirePattern(workerInvitationPage, /(?:Create Worker account|Worker sign-in)/i, paths.workerInvitationPage, "new/existing Worker continuation choices");
requireMarker(workerInvitationActions, "acceptInvitation", paths.workerInvitationActions);
requirePattern(workerInvitationActions, /(?:write|prepare).*CompanyWorkforce.*Registration/i, paths.workerInvitationActions, "registration-safe invitation binding without persisting raw invitation secret");
forbidPattern(workerInvitationActions, /cookies\(\)[\s\S]{0,300}(?:invitationToken|registrationCode)[\s\S]{0,80}(?:set|value)/i, paths.workerInvitationActions, "raw Company workforce secret in a browser cookie");

requirePattern(workerAccessPage, /registration code/i, paths.workerAccessPage, "existing Worker Company-code redemption form");
requirePattern(workerAccessPage, /pending/i, paths.workerAccessPage, "pending Company link consent state");
requireMarker(workerAccessActions, "redeemRegistrationCode", paths.workerAccessActions);
requireMarker(workerAccessActions, "acceptWorkerLink", paths.workerAccessActions);
requireMarker(workerAccessActions, 'requirePortalAuthorization("worker")', paths.workerAccessActions);

requirePattern(registrationForm, /name=["']companyCode["']/, paths.registrationForm, "optional Company registration code on Worker registration");
requireMarker(registrationActions, "companyCode", paths.registrationActions);
requirePattern(registrationActions, /CompanyWorkforceRegistrationBinding/i, paths.registrationActions, "registration flow binding to a validated Company invitation/code");
for (const marker of ["httpOnly", "sameSite", "registrationTokenHash", "resourceId"])
  requireMarker(registrationBinding, marker, paths.registrationBinding);
forbidPattern(registrationBinding, /invitationToken\s*:/i, paths.registrationBinding, "raw invitation token in registration binding payload");
forbidPattern(registrationBinding, /registrationCode\s*:/i, paths.registrationBinding, "raw Company code in registration binding payload");

requireMarker(packageJson, '"check:m1-10"', paths.packageJson);
requireMarker(packageJson, '"test:m1-10"', paths.packageJson);
requirePattern(packageJson, /"check"\s*:\s*"[^"]*npm run check:m1-10/, paths.packageJson, "M1.10 source guard in the full application gate");
requirePattern(packageJson, /"check"\s*:\s*"[^"]*npm run test:m1-10/, paths.packageJson, "M1.10 runtime/migration suite in the full application gate");

console.log("M1.10 Company and Worker invitation/code/linking, discoverable navigation, registration handoff, cross-brick migration safety, secret, authorization, centralized audit and permanent-gate source contract passed.");
