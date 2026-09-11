import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const requiredFiles = [
  "src/app/error.tsx",
  "src/app/global-error.tsx",
  "src/app/access-denied/page.tsx",
  "src/app/auth/actions.ts",
  "src/app/auth/recover/page.tsx",
  "src/app/auth/recover/verify/page.tsx",
  "src/app/auth/sandbox/bootstrap-root/page.tsx",
  "src/app/account/sessions/page.tsx",
  "src/app/account/sessions/actions.ts",
  "src/app/staff/actions.ts",
  "src/app/staff/invite/[token]/route.ts",
  "src/app/staff/invite/accept/page.tsx",
  "src/app/worker/login/page.tsx",
  "src/app/worker/register/page.tsx",
  "src/app/worker/register/verify/page.tsx",
  "src/app/worker/register/sandbox/page.tsx",
  "src/app/worker/(portal)/layout.tsx",
  "src/app/worker/(portal)/dashboard/page.tsx",
  "src/app/worker/(portal)/profile/page.tsx",
  "src/app/worker/(portal)/onboarding/page.tsx",
  "src/app/company/login/page.tsx",
  "src/app/company/(portal)/layout.tsx",
  "src/app/company/(portal)/dashboard/page.tsx",
  "src/app/assessor/login/page.tsx",
  "src/app/assessor/(portal)/layout.tsx",
  "src/app/assessor/(portal)/dashboard/page.tsx",
  "src/app/verifier/login/page.tsx",
  "src/app/verifier/(portal)/layout.tsx",
  "src/app/verifier/(portal)/dashboard/page.tsx",
  "src/app/admin/login/page.tsx",
  "src/app/admin/(portal)/layout.tsx",
  "src/app/admin/(portal)/dashboard/page.tsx",
  "src/app/admin/(portal)/staff/page.tsx",
  "src/app/root/login/page.tsx",
  "src/app/root/(portal)/layout.tsx",
  "src/app/root/(portal)/dashboard/page.tsx",
  "src/app/root/(portal)/staff/page.tsx",
  "src/components/auth/role-login-form.tsx",
  "src/components/auth/role-login-page.tsx",
  "src/components/auth/role-portal-shell.tsx",
  "src/components/auth/staff-invitation-form.tsx",
  "src/components/worker/profile-forms.tsx",
  "src/lib/config/environment.ts",
  "src/lib/database/database.ts",
  "src/lib/database/pglite-path.mjs",
  "src/lib/auth/auth-domain.ts",
  "src/lib/auth/auth-repository.ts",
  "src/lib/auth/auth-access-repository.ts",
  "src/lib/auth/auth-login-service.ts",
  "src/lib/auth/auth-recovery-service.ts",
  "src/lib/auth/auth-session-cookie.ts",
  "src/lib/auth/auth-session-service.ts",
  "src/lib/auth/auth-sandbox-service.ts",
  "src/lib/auth/staff-provisioning-service.ts",
  "src/lib/auth/worker-registration-repository.ts",
  "src/lib/auth/worker-registration-service.ts",
  "src/lib/auth/worker-registration-cookie.ts",
  "src/lib/auth/worker-session.ts",
  "src/lib/worker/profile-domain.ts",
  "src/lib/worker/profile-repository.ts",
  "src/lib/worker/profile-service.ts",
  "database/migrations/0001_platform_foundation.up.sql",
  "database/migrations/0001_platform_foundation.down.sql",
  "database/migrations/0002_authentication_foundation.up.sql",
  "database/migrations/0002_authentication_foundation.down.sql",
  "database/migrations/0003_worker_registration_otp.up.sql",
  "database/migrations/0003_worker_registration_otp.down.sql",
  "database/migrations/0004_authentication_completion.up.sql",
  "database/migrations/0004_authentication_completion.down.sql",
  "src/app/verify/worker/[workerId]/page.tsx",
  "tests/auth/auth-domain.test.mjs",
  "tests/platform/authentication-foundation.test.mjs",
  "tests/platform/worker-registration-foundation.test.mjs",
  "tests/platform/authentication-completion.test.mjs",
  "tests/platform/authentication-portal-isolation.test.mjs",
  "tsconfig.auth-tests.json"
];

const missing = requiredFiles.filter((path) => !existsSync(resolve(path)));
if (missing.length > 0) {
  console.error(`Missing required platform files:\n${missing.join("\n")}`);
  process.exit(1);
}

function source(path) {
  return readFileSync(resolve(path), "utf8");
}

function requireMarkers(path, markers, label = path) {
  const content = source(path);
  for (const marker of markers) {
    if (!content.includes(marker)) {
      console.error(`${label} is missing: ${marker}`);
      process.exit(1);
    }
  }
  return content;
}

const workerShell = requireMarkers(
  "src/components/worker/worker-shell.tsx",
  ["Exit portal", "Sign out", "My profile", "Active sessions"]
);
if (workerShell.includes("session.workerId")) {
  console.error("Worker shell must not display the provisional registration reference as a permanent Worker ID.");
  process.exit(1);
}

const workerSession = requireMarkers("src/lib/auth/worker-session.ts", [
  'requireRoleSession("worker")',
  "account.workerReference",
  'role: "worker"'
]);
if (/workerId: session\.accountId|createHmac|hse_worker_session/.test(workerSession)) {
  console.error("Worker access must use the database session and never expose the account key.");
  process.exit(1);
}

requireMarkers("src/lib/auth/auth-domain.ts", [
  '"worker"',
  '"company"',
  '"assessor"',
  '"verifier"',
  '"admin"',
  '"root"',
  "hashPassword",
  "hashOtpCode",
  "verifyTotp",
  "encryptSecret",
  "ROLE_LOGIN_PATHS",
  "ROLE_HOME_PATHS"
]);

requireMarkers("src/lib/auth/auth-repository.ts", [
  "AuthenticationRepository",
  "auth_accounts",
  "auth_account_roles",
  "auth_otp_challenges",
  "auth_sessions",
  "FOR UPDATE",
  "consumed_at IS NULL",
  "revoked_at IS NULL",
  "$8, $9, $9"
]);

requireMarkers("src/lib/auth/auth-access-repository.ts", [
  "AuthAccessRepository",
  "auth_recovery_flows",
  "auth_staff_enrollment_flows",
  "auth_access_rate_limits",
  "revokeOwnedSession",
  "acceptMfaCounter",
  "FOR UPDATE"
]);

const loginService = requireMarkers("src/lib/auth/auth-login-service.ts", [
  "roleRequiresMfa",
  "recordLoginFailure",
  "consumeAccessRateLimit",
  "findActiveMfaFactorForUpdate",
  "acceptMfaCounter",
  "mfa_succeeded"
]);
if (/switchRole|changeRole|setActiveRole/.test(loginService)) {
  console.error("Authentication login service must not support in-session role switching.");
  process.exit(1);
}

requireMarkers("src/lib/auth/auth-recovery-service.ts", [
  "password_reset",
  "consumeOtpChallenge",
  "consumeRecoveryFlow",
  "revokeAllSessions",
  "password_reset_completed"
]);

requireMarkers("src/lib/auth/auth-session-cookie.ts", [
  "httpOnly: true",
  "__Host-hse_session",
  'sameSite: "lax"'
]);

const sessionService = requireMarkers("src/lib/auth/auth-session-service.ts", [
  "findActiveSessionByTokenHash",
  "requireRoleSession",
  "revokeCurrentAuthenticationSession",
  "revokeOwnSession",
  "access_denied",
  'redirect("/access-denied")'
]);
if (/switchRole|changeRole|setActiveRole/.test(sessionService)) {
  console.error("Authentication sessions must remain fixed to one portal role.");
  process.exit(1);
}

requireMarkers("src/lib/auth/staff-provisioning-service.ts", [
  "createRootBootstrapInvitation",
  'countRoleAssignments("root")',
  "createTotpSecret",
  "activateMfaFactor",
  "markInvitationAccepted",
  "allowedInvitationRoles"
]);

const authActions = requireMarkers("src/app/auth/actions.ts", [
  "signInWorkerAccount",
  "signInCompanyAccount",
  "signInAssessorAccount",
  "signInVerifierAccount",
  "signInAdminAccount",
  "signInRootAccount"
]);
if (/formText\(formData, "role"\)|switchRole|changeRole/.test(authActions)) {
  console.error("Login actions must bind fixed roles on the server.");
  process.exit(1);
}

for (const role of ["company", "assessor", "verifier", "admin", "root"]) {
  requireMarkers(`src/app/${role}/(portal)/layout.tsx`, [
    `requireRoleSession("${role}")`,
    "RolePortalShell"
  ]);
}

const registrationRepository = requireMarkers(
  "src/lib/auth/worker-registration-repository.ts",
  [
    "WorkerRegistrationRepository",
    "auth_registration_flows",
    "auth_sandbox_deliveries",
    "findFlowForUpdate",
    "findLatestActiveChallengeForUpdate",
    "FOR UPDATE",
    "current_step IN ('pending_email', 'pending_phone')"
  ]
);
if (!registrationRepository.includes("deleteUnactivatedAccount")) {
  console.error("Worker registration cancellation boundary is missing.");
  process.exit(1);
}

const registrationService = requireMarkers(
  "src/lib/auth/worker-registration-service.ts",
  [
    "WorkerRegistrationService",
    "hashPassword",
    "hashOtpCode",
    "verifyOtpCode",
    "encryptSecret",
    "consumeOtpChallenge",
    "updateAccountAfterEmailVerification",
    "updateAccountAfterPhoneVerification",
    "registration_started",
    "otp_issued",
    "otp_failed",
    "otp_verified"
  ]
);
if (/createWorkerSession|console\./.test(registrationService)) {
  console.error("Worker registration must not create a login session or log OTP data.");
  process.exit(1);
}

requireMarkers("src/lib/auth/worker-registration-cookie.ts", [
  "httpOnly: true",
  'sameSite: "lax"',
  'path: "/worker/register"'
]);

requireMarkers("src/app/worker/profile/actions.ts", [
  "requireWorkerSession",
  "expectedVersion",
  "revalidatePath"
]);
requireMarkers("src/lib/worker/profile-repository.ts", [
  "DatabaseWorkerProfileRepository",
  "ProfileVersionConflictError",
  "worker_profiles",
  "RETURNING version"
]);
requireMarkers("src/lib/database/database.ts", [
  "normalizePgliteDataDirectory",
  "PGlite.create(dataDirectory)",
  "transaction<T>",
  "this.owner.transaction",
  "this.sql.begin"
]);

const nextConfig = source("next.config.ts");
if (!nextConfig.includes('serverExternalPackages: ["@electric-sql/pglite"]')) {
  console.error("PGlite must remain external to the Next.js server bundle.");
  process.exit(1);
}
if (nextConfig.includes('transpilePackages: ["@electric-sql/pglite"]')) {
  console.error("PGlite must not be transpiled into the Turbopack server bundle.");
  process.exit(1);
}

if (/<html\b|<body\b/i.test(source("src/app/error.tsx"))) {
  console.error("app/error.tsx must render inside the existing root document.");
  process.exit(1);
}
requireMarkers("src/app/global-error.tsx", ["<html", "<body"]);

requireMarkers("database/migrations/0001_platform_foundation.up.sql", [
  "hse_schema_migrations",
  "worker_profiles",
  "deployment_releases"
]);
requireMarkers("database/migrations/0002_authentication_foundation.up.sql", [
  "auth_accounts",
  "auth_account_roles",
  "auth_otp_challenges",
  "auth_sessions",
  "auth_staff_invitations",
  "auth_mfa_factors",
  "auth_security_events"
]);
requireMarkers("database/migrations/0003_worker_registration_otp.up.sql", [
  "auth_registration_flows",
  "auth_sandbox_deliveries",
  "auth_active_registration_account_idx",
  "auth_registration_flow_completion_check"
]);
requireMarkers("database/migrations/0004_authentication_completion.up.sql", [
  "auth_recovery_flows",
  "auth_staff_enrollment_flows",
  "auth_access_rate_limits",
  "auth_pending_staff_invitation_idx",
  "auth_single_pending_root_bootstrap_idx"
]);

requireMarkers("src/lib/config/environment.ts", [
  "HSE_APP_ENV",
  "HSE_DATABASE_DRIVER",
  "DATABASE_URL",
  "HSE_RELEASE_SHA",
  "HSE_AUTH_PEPPER",
  "HSE_ENABLE_AUTH_SANDBOX",
  "HSE_AUTH_SANDBOX_ACCESS_KEY"
]);

requireMarkers("src/lib/worker/dashboard-repository.ts", ["getWorkerProfileView"]);

console.log(
  "Worker registration, password recovery, opaque sessions, mandatory staff MFA, six fixed-role portals, cross-role denial, native PGlite runtime and four-layer M1.03 migration manifest passed."
);
