import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(path) {
  return readFileSync(resolve(path), "utf8");
}
function fail(message) {
  console.error(message);
  process.exit(1);
}
function requireMarker(source, marker, label) {
  if (!source.includes(marker)) fail(`${label} lost required M1.09 contract: ${marker}`);
}
function forbidMarker(source, marker, label) {
  if (source.includes(marker)) fail(`${label} contains forbidden M1.09 authority/scope: ${marker}`);
}

const required = [
  "database/migrations/0026_company_organization_team_foundation.up.sql",
  "database/migrations/0026_company_organization_team_foundation.down.sql",
  "database/migrations/0027_company_organization_team_hardening.up.sql",
  "database/migrations/0027_company_organization_team_hardening.down.sql",
  "src/lib/company/company-organization-domain.ts",
  "src/lib/company/company-organization-repository.ts",
  "src/lib/company/company-team-service.ts",
  "src/app/company/(portal)/organization/page.tsx",
  "src/app/company/(portal)/organization/actions.ts",
  "src/app/company/(portal)/team/page.tsx",
  "src/app/company/(portal)/team/actions.ts",
  "src/components/company/company-organization-workspace.tsx",
  "src/components/company/company-team-workspace.tsx",
  "scripts/run-company-organization-team-tests.mjs",
  "tests/platform/company-organization-team.test.mjs",
  "tests/platform/company-organization-team-migration-stack.test.mjs",
  "docs/engineering/M1_09_REGRESSIONS.md"
];
for (const path of required) {
  if (!existsSync(resolve(path))) fail(`M1.09 implementation is missing ${path}`);
}

const foundation = read("database/migrations/0026_company_organization_team_foundation.up.sql");
for (const marker of [
  "company_sites",
  "company_departments",
  "company_team_invitation_bindings",
  "company_team_invitation_permissions",
  "company_team_unit_assignments",
  "hse_validate_company_team_invitation_binding",
  "hse_activate_company_team_membership",
  "auth_mfa_factors",
  "factor_status = 'active'",
  "hse_archive_company_unit_assignments",
  "company_sites_archive_assignments",
  "company_departments_archive_assignments",
  "Archived Company site cannot receive active assignment",
  "Archived Company department cannot receive active assignment"
]) requireMarker(foundation, marker, "M1.09 migration 0026");

const hardening = read("database/migrations/0027_company_organization_team_hardening.up.sql");
for (const marker of [
  "hse_guard_company_team_owner_continuity",
  "A Company must retain at least one active owner.",
  "hse_end_company_team_assignments_on_deactivation",
  "Membership suspended",
  "Membership revoked",
  "hse_reject_company_team_invitation_history_mutation",
  "Company Team invitation binding history is immutable.",
  "company_organization.created",
  "company_organization.updated",
  "company_organization.archived",
  "company_organization.restored",
  "company_team.invitation.created",
  "company_team.invitation.revoked",
  "company_team.membership.updated",
  "company_team.membership.suspended",
  "company_team.membership.reactivated",
  "company_team.membership.revoked"
]) requireMarker(hardening, marker, "M1.09 migration 0027");
forbidMarker(
  read("database/migrations/0027_company_organization_team_hardening.down.sql"),
  "DROP TABLE",
  "M1.09 monotonic hardening rollback"
);

const auditDomain = read("src/lib/audit/audit-domain.ts");
for (const marker of [
  "company_organization.created",
  "company_organization.archived",
  "company_team.invitation.created",
  "company_team.membership.updated",
  "company_team.membership.revoked"
]) requireMarker(auditDomain, marker, "M1.09 audit domain");

const organizationRepository = read("src/lib/company/company-organization-repository.ts");
for (const marker of [
  "runTenantScopedCommand",
  "WHERE tenant_id=$1",
  "DatabaseAuditRepository(Promise.resolve(input.database))",
  "bindTrustedAuditActor(input.principal)",
  "appendAudit({ database, principal",
  "company_organization.created",
  "company_organization.updated",
  "company_organization.archived",
  "company_organization.restored",
  "revision=revision+1"
]) requireMarker(organizationRepository, marker, "Company organization repository");
for (const forbidden of ["clientTenantId", "requestedTenantId", "tenantId: input", "actorAccountId:"])
  forbidMarker(organizationRepository, forbidden, "Company organization repository");

const teamService = read("src/lib/company/company-team-service.ts");
for (const marker of [
  "AuthAccessRepository",
  "runTenantScopedCommand",
  "liveActor(database, scope)",
  "livePermissions(database, scope.membershipId",
  "canGrantTenantRole",
  "tenantPermissionsForRole",
  "scope.membershipId === membershipId",
  "assertOwnerContinuity",
  "company_team_invitation_bindings",
  "company_team_invitation_permissions",
  "auth_staff_invitations",
  "auth_staff_enrollment_flows",
  "DatabaseAuditRepository(Promise.resolve(database))",
  "company_team.invitation.created",
  "company_team.invitation.revoked",
  "company_team.membership.updated",
  "company_team.membership.suspended",
  "company_team.membership.reactivated",
  "company_team.membership.revoked",
  "A Company must retain at least one active owner."
]) requireMarker(teamService, marker, "Company Team service");
for (const forbidden of [
  "clientTenantId",
  "requestedTenantId",
  "clientActorId",
  "reviewerId",
  "verifierId",
  "paymentProvider",
  "workerInvitationCode"
]) forbidMarker(teamService, forbidden, "Company Team service");

const organizationActions = read("src/app/company/(portal)/organization/actions.ts");
const teamActions = read("src/app/company/(portal)/team/actions.ts");
const organizationWorkspace = read("src/components/company/company-organization-workspace.tsx");
const teamWorkspace = read("src/components/company/company-team-workspace.tsx");
for (const [label, source] of [
  ["Organization actions", organizationActions],
  ["Team actions", teamActions],
  ["Organization workspace", organizationWorkspace],
  ["Team workspace", teamWorkspace]
]) {
  if (/\bencType=/.test(source)) fail(`${label} must not override React Server Action encoding.`);
  for (const forbidden of ["tenantId", "actorAccountId", "authorizedTenantPermission"]) {
    if (new RegExp(`formData\\.get\\([\"']${forbidden}[\"']\\)`).test(source)) {
      fail(`${label} accepts forbidden browser authority selector ${forbidden}.`);
    }
  }
}
for (const marker of [
  "ConfirmDialog",
  "Archive is reversible for the unit record",
  "hiddenFields",
  "Assignment history will be retained"
]) requireMarker(organizationWorkspace, marker, "Company organization workspace");
for (const marker of [
  "Durable invitation history",
  "cancelCompanyTeamInvitationAction",
  "updateCompanyTeamMemberAction",
  "changeCompanyTeamMemberStatusAction",
  "Self role, permission and status changes are blocked",
  "ConfirmDialog",
  "Reactivate"
]) requireMarker(teamWorkspace, marker, "Company Team workspace");

const runtimeTest = read("tests/platform/company-organization-team.test.mjs");
for (const marker of [
  "MFA activation",
  "company_organization.archived",
  "company_team.membership.suspended",
  "live-permission-denial",
  "retain at least one active owner",
  "activeAfterReactivation",
  "Company admin cannot grant admin/owner authority"
]) requireMarker(runtimeTest, marker, "M1.09 runtime regressions");
const migrationTest = read("tests/platform/company-organization-team-migration-stack.test.mjs");
for (const marker of [
  "survives restart",
  "rollbackLatestMigration",
  "migrationStatus",
  "invitation binding history is immutable",
  "retain at least one active owner",
  "m1-09-migration-reapply"
]) requireMarker(migrationTest, marker, "M1.09 migration/restart regressions");

const regressions = read("docs/engineering/M1_09_REGRESSIONS.md");
for (const id of ["REG-086", "REG-087", "REG-088", "REG-089", "REG-090", "REG-091"])
  requireMarker(regressions, id, "M1.09 regression register");

const packageDocument = JSON.parse(read("package.json"));
const scripts = packageDocument.scripts ?? {};
if (scripts["check:m1-09"] !== "node scripts/check-company-organization-team.mjs") {
  fail("package.json must expose the permanent M1.09 source guard.");
}
if (scripts["test:m1-09"] !== "node scripts/run-company-organization-team-tests.mjs") {
  fail("package.json must expose the permanent M1.09 runtime/migration suite.");
}
for (const aggregate of ["verify:quick", "check"]) {
  requireMarker(scripts[aggregate] ?? "", "npm run check:m1-09", `${aggregate} M1.09 gate wiring`);
}
for (const aggregate of ["test:integration", "check"]) {
  requireMarker(scripts[aggregate] ?? "", "npm run test:m1-09", `${aggregate} M1.09 runtime wiring`);
}

// Permanent state ownership: M1.09 protects accepted behavior/history while
// legitimate later bricks advance. Historical release evidence belongs to the
// permanent milestone record; NEXT_BUILD_UNIT owns only the current boundary.
const milestonePath = read("docs/bookmarks/MILESTONE_PATH.md");
requireMarker(milestonePath, "| M1.09 | Sites, departments and Company Team | **IMPLEMENTATION MERGED — ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED** |", "M1.09 permanent build history");
requireMarker(milestonePath, "32130f82b661b86d7ad08f5dad7a368346cfe13d", "M1.09 exact-head evidence");
requireMarker(milestonePath, "31569523799", "M1.09 exact-head evidence");
requireMarker(milestonePath, "1fe96b412db3cfa4e370a2d60cd13ce00aa3e3bf", "M1.09 merged-main evidence");
requireMarker(milestonePath, "31569898065", "M1.09 merged-main evidence");

const currentState = read("docs/NEXT_BUILD_UNIT.md");
requireMarker(currentState, "M1.09 Sites, Departments and Company Team — **IMPLEMENTATION MERGED — ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED", "Current build state");
requireMarker(currentState, "M1.10 Worker Invitations and Company Codes — **IMPLEMENTATION MERGED — ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED", "Current build state");
requireMarker(currentState, "M1.11 Employment, Experience, Qualification, Skill and Leaving Records — **IMPLEMENTATION MERGED — ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED", "Current build state");
requireMarker(currentState, "# M1.12 — PUBLIC VERIFICATION FOUNDATION — IN PROGRESS", "Current build state");

console.log(
  "Permanent M1.09 Company organization/team tenant scope, immutable audit/history, MFA-bound invitation reuse, live grant ceilings, owner continuity, destructive confirmation and restart/migration contracts remain protected while M1.12 advances."
);