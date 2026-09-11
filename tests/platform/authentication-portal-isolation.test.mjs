import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function source(path) {
  return readFile(resolve(path), "utf8");
}

const ROLE_CASES = [
  ["worker", "signInWorkerAccount"],
  ["company", "signInCompanyAccount"],
  ["assessor", "signInAssessorAccount"],
  ["verifier", "signInVerifierAccount"],
  ["admin", "signInAdminAccount"],
  ["root", "signInRootAccount"]
];

test("every login page binds one fixed role to one server action", async () => {
  const actions = await source("src/app/auth/actions.ts");
  assert.doesNotMatch(actions, /formText\(formData, "role"\)/);
  assert.doesNotMatch(actions, /switchRole|changeRole|setActiveRole/);

  for (const [role, action] of ROLE_CASES) {
    const page = await source(`src/app/${role}/login/page.tsx`);
    assert.match(page, new RegExp(action));
    assert.match(page, new RegExp(`role: "${role}"`));
    assert.match(actions, new RegExp(`function ${action}|${action}\\(`));
  }
});

test("session creation and login audit commit before the opaque cookie is written", async () => {
  const [actions, sessionService] = await Promise.all([
    source("src/app/auth/actions.ts"),
    source("src/lib/auth/auth-session-service.ts")
  ]);
  const recordSection = sessionService.slice(
    sessionService.indexOf("async function recordSessionCreation"),
    sessionService.indexOf("export async function createAuthenticationSession")
  );
  const createSection = sessionService.slice(
    sessionService.indexOf("export async function createAuthenticationSession"),
    sessionService.indexOf("export async function establishAuthenticationSession")
  );
  const establishSection = sessionService.slice(
    sessionService.indexOf("export async function establishAuthenticationSession"),
    sessionService.indexOf("export async function readAuthenticatedSession")
  );

  assert.match(createSection, /repository\.transaction\(\(transaction\) =>/);
  assert.match(createSection, /recordSessionCreation/);
  assert.doesNotMatch(createSection, /writeAuthSessionToken/);
  assert.match(recordSection, /insertSession/);
  assert.match(recordSection, /eventType: "login_succeeded"/);
  assert.ok(
    recordSection.indexOf("insertSession") <
      recordSection.indexOf('eventType: "login_succeeded"')
  );
  assert.ok(
    establishSection.indexOf("createAuthenticationSession") <
      establishSection.indexOf("writeAuthSessionToken")
  );
  assert.doesNotMatch(actions, /insertSecurityEvent|getAuthAccessRepository/);
  assert.match(actions, /requestFingerprint: metadata\.fingerprint/);
});

test("locked-account messaging is available only after password and role proof", async () => {
  const loginService = await source("src/lib/auth/auth-login-service.ts");
  assert.match(
    loginService,
    /return passwordStillMatches && hasRole\s+\? \(\{ locked: true \} as const\)\s+: null/
  );
  assert.match(loginService, /if \(!result\) throw genericInvalidCredentials\(\)/);
});

test("password reset limits invalid-token compute before scrypt hashing", async () => {
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
  assert.doesNotMatch(recoveryService, /requestFingerprintHash: "recovery-resend"/);
});

test("every protected portal layout enforces its exact role", async () => {
  for (const role of ["company", "assessor", "verifier", "admin", "root"]) {
    const layout = await source(`src/app/${role}/(portal)/layout.tsx`);
    assert.match(layout, new RegExp(`requireRoleSession\\("${role}"\\)`));
    assert.match(layout, /RolePortalShell/);
  }

  const workerLayout = await source("src/app/worker/(portal)/layout.tsx");
  const workerSession = await source("src/lib/auth/worker-session.ts");
  assert.match(workerLayout, /requireWorkerSession/);
  assert.match(workerSession, /requireRoleSession\("worker"\)/);
});

test("copied URLs and role mismatch resolve through the central access-denied boundary", async () => {
  const [sessionService, authorizationService, contextDomain, denialPage] =
    await Promise.all([
      source("src/lib/auth/auth-session-service.ts"),
      source("src/lib/authorization/authorization-service.ts"),
      source("src/lib/authorization/authorization-context-domain.ts"),
      source("src/app/access-denied/page.tsx")
    ]);
  assert.match(sessionService, /requirePortalAuthorization\(expectedRole\)/);
  assert.match(authorizationService, /authorizePortalEntry/);
  assert.match(authorizationService, /eventType: "access_denied"/);
  assert.match(contextDomain, /"role_mismatch"/);
  assert.match(authorizationService, /redirect\("\/access-denied"\)/);
  assert.doesNotMatch(sessionService, /switchRole|changeRole|setActiveRole/);
  assert.match(denialPage, /session is fixed to one role/);
  assert.match(denialPage, /Sign out to use another portal/);
});

test("staff invitation actions require administrator or root sessions", async () => {
  const [actions, adminPage, rootPage] = await Promise.all([
    source("src/app/staff/actions.ts"),
    source("src/app/admin/(portal)/staff/page.tsx"),
    source("src/app/root/(portal)/staff/page.tsx")
  ]);
  assert.match(actions, /requireRoleSession\(inviterRole\)/);
  assert.match(actions, /inviterRole: "admin" \| "root"/);
  assert.match(actions, /createRootBootstrapInvitation/);
  assert.match(adminPage, /requireRoleSession\("admin"\)/);
  assert.match(rootPage, /requireRoleSession\("root"\)/);
});

test("root bootstrap and sandbox code retrieval disappear outside the sandbox", async () => {
  const [bootstrapPage, sandboxPage, environment] = await Promise.all([
    source("src/app/auth/sandbox/bootstrap-root/page.tsx"),
    source("src/app/worker/register/sandbox/page.tsx"),
    source("src/lib/config/environment.ts")
  ]);
  assert.match(bootstrapPage, /if \(!getServerEnvironment\(\)\.authSandboxEnabled\) notFound\(\)/);
  assert.match(sandboxPage, /if \(!environment\.authSandboxEnabled\)/);
  assert.match(sandboxPage, /notFound\(\)/);
  assert.match(environment, /HSE_ENABLE_AUTH_SANDBOX/);
  assert.match(environment, /restricted to development and test environments/);
});

test("session management revokes only owned sessions and current-session revocation clears the cookie", async () => {
  const [repository, action, sessionService] = await Promise.all([
    source("src/lib/auth/auth-access-repository.ts"),
    source("src/app/account/sessions/actions.ts"),
    source("src/lib/auth/auth-session-service.ts")
  ]);
  assert.match(repository, /WHERE account_id = \$1\s+AND session_id = \$2/);
  assert.match(action, /targetSessionId === session\.sessionId/);
  assert.match(action, /clearAuthSessionToken/);
  assert.match(sessionService, /listOwnActiveSessions/);
  assert.match(sessionService, /revokeOwnSession/);
  assert.match(sessionService, /repository\.transaction\(async \(transaction\) =>/);
});

test("Worker UI treats the registration reference as provisional, not a permanent Worker ID", async () => {
  const [workerSession, copyControl, workerShell] = await Promise.all([
    source("src/lib/auth/worker-session.ts"),
    source("src/components/worker/copy-worker-id.tsx"),
    source("src/components/worker/worker-shell.tsx")
  ]);
  assert.match(workerSession, /account\.workerReference/);
  assert.doesNotMatch(workerSession, /workerId: session\.accountId/);
  assert.match(copyControl, /HSE-REG references are provisional/);
  assert.match(copyControl, /Worker ID not issued/);
  assert.doesNotMatch(workerShell, /session\.workerId/);
});
