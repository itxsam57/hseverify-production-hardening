import assert from "node:assert/strict";
import test from "node:test";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";

const { StaffProvisioningService } = loadWorkerRegistrationTs("src/lib/auth/staff-provisioning-service.ts");
const { AuthAccessRepository } = loadWorkerRegistrationTs("src/lib/auth/auth-access-repository.ts");
const ENV = {
  appEnvironment: "test", databaseDriver: "pglite", databaseUrl: null,
  pgliteDataDir: "memory://", releaseSha: "staff-revocation-runtime",
  sessionSecret: "worker-registration-policy-session-secret-more-than-32",
  authPepper: "worker-registration-policy-pepper-more-than-32",
  authSandboxEnabled: true, authSandboxAccessKey: "worker-policy-test-sandbox-key",
  demoAuthEnabled: false, demoDataEnabled: false
};
const {createTotpCode, totpCounter} = loadWorkerRegistrationTs("src/lib/auth/auth-domain.ts");
const NOW = "2026-10-05T01:00:00.000Z";
async function fixture(role = "root") {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(db, ENV.releaseSha, "0080_staff_invitation_revocation_audit");
  const repo = new AuthAccessRepository(db);
  const actor = { inviterAccountId: "revocation-root", inviterRole: role, inviterSessionId: "revocation-session" };
  await repo.authentication.insertAccount({accountId: actor.inviterAccountId, email: "issuer.revocation@example.test", phone: null, displayName: "Revocation Issuer", status: "pending_email", passwordHash: null, workerReference: null, now: NOW});
  await repo.authentication.updateAccountAfterEmailVerification(actor.inviterAccountId, NOW);
  await repo.authentication.addRole(actor.inviterAccountId, role, NOW);
  await repo.authentication.insertSession({sessionId: actor.inviterSessionId, accountId: actor.inviterAccountId, activeRole: role, tokenHash: "revocation-session-hash", csrfTokenHash: "revocation-csrf-hash", userAgentHash: null, ipAddressHash: null, createdAt: NOW, lastSeenAt: NOW, expiresAt: "2026-10-06T01:00:00.000Z"});
  const service = new StaffProvisioningService(repo, {pepper: ENV.authPepper, sandboxEnabled: true, sandboxAccessKey: ENV.authSandboxAccessKey}, () => new Date(NOW));
  const invitation = await service.createInvitation({...actor, email: "recipient.revocation@example.test", role: "verifier", requestFingerprint: "revocation-fixture"});
  return {db, repo, service, actor, invitation};
}
test("Issuer revocation denies fresh and already-open enrollment and is idempotent", async () => {
  const {db, service, actor, invitation} = await fixture();
  try {
    const enrollment = await service.beginEnrollment(invitation.token);
    await service.revokeInvitation({...actor, invitationId: invitation.invitation.invitationId});
    await assert.rejects(service.beginEnrollment(invitation.token), e => e.code === "invitation_unavailable");
    assert.equal(await service.readEnrollmentState(enrollment.token), null);
    await assert.rejects(service.completeProfile({combinedToken: enrollment.token, displayName: "Revoked Recipient", password: "RevokedRecipient!2026"}), e => ["invitation_unavailable", "flow_missing"].includes(e.code));
    await service.revokeInvitation({...actor, invitationId: invitation.invitation.invitationId});
    const row = (await db.query("SELECT invitation_status, revoked_at FROM auth_staff_invitations WHERE invitation_id=$1", [invitation.invitation.invitationId])).rows[0];
    assert.equal(row.invitation_status, "revoked");
    assert.equal(new Date(row.revoked_at).toISOString(), NOW);
    assert.equal((await db.query("SELECT current_step FROM auth_staff_enrollment_flows WHERE invitation_id=$1", [invitation.invitation.invitationId])).rows[0].current_step, "cancelled");
    assert.equal((await db.query("SELECT account_id FROM auth_accounts WHERE email_normalized=$1", [invitation.invitation.email])).rows.length, 0);
    const audit = (await db.query("SELECT actor_account_id, actor_role, target_reference FROM platform_audit_events WHERE action_key='authentication.invitation.revoked'")).rows;
    assert.equal(audit.length, 1); assert.equal(audit[0].actor_account_id, actor.inviterAccountId); assert.equal(audit[0].actor_role, "root"); assert.equal(audit[0].target_reference, invitation.invitation.invitationId);
  } finally { await db.close(); }
});

test("Revocation enforces live issuer ownership, portal role and terminal state", async () => {
  const {db, service, actor, invitation} = await fixture();
  try {
    for (const override of [{inviterRole: "worker"}, {inviterRole: "admin"}, {inviterAccountId: "other"}, {inviterSessionId: "other"}]) {
      await assert.rejects(service.revokeInvitation({...actor, invitationId: invitation.invitation.invitationId, ...override}), e => e.code === "invitation_unavailable");
    }
    await db.query("UPDATE auth_sessions SET revoked_at=$1, revocation_reason='test' WHERE session_id=$2", [NOW, actor.inviterSessionId]);
    await assert.rejects(service.revokeInvitation({...actor, invitationId: invitation.invitation.invitationId}), e => e.code === "invitation_unavailable");
    assert.equal((await db.query("SELECT invitation_status FROM auth_staff_invitations WHERE invitation_id=$1", [invitation.invitation.invitationId])).rows[0].invitation_status, "pending");
    assert.equal((await db.query("SELECT audit_event_id FROM platform_audit_events WHERE action_key='authentication.invitation.revoked'")).rows.length, 0);
  } finally {await db.close();}
});
test("Revocation cleans an unfinished MFA account but preserves immutable history", async () => {
  const {db, service, actor, invitation} = await fixture();
  try {
    const enrollment = await service.beginEnrollment(invitation.token);
    const profile = await service.completeProfile({combinedToken: enrollment.token, displayName: "Pending Staff", password: "PendingStaff!Password2026"});
    assert.equal(profile.step, "totp");
    await service.revokeInvitation({...actor, invitationId: invitation.invitation.invitationId});
    assert.equal((await db.query("SELECT account_id FROM auth_accounts WHERE email_normalized=$1", [invitation.invitation.email])).rows.length, 0);
    await assert.rejects(service.verifyEnrollmentTotp({combinedToken: enrollment.token, code: "000000"}), e => e.code === "invitation_unavailable");
    assert.equal((await db.query("SELECT audit_event_id FROM platform_audit_events WHERE action_key='authentication.password.created' AND actor_role='verifier'")).rows.length, 1);
  } finally {await db.close();}
});
test("Audit failure rolls back invitation, enrollment cancellation and unfinished-account deletion", async () => {
  const {db, service, actor, invitation} = await fixture();
  try {
    const enrollment = await service.beginEnrollment(invitation.token);
    await service.completeProfile({combinedToken: enrollment.token, displayName: "Pending Staff", password: "PendingStaff!Password2026"});
    await db.query(`CREATE FUNCTION reject_staff_revocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action_key='authentication.invitation.revoked' THEN RAISE EXCEPTION 'Synthetic revocation audit failure'; END IF; RETURN NEW; END; $$`);
    await db.query("CREATE TRIGGER reject_staff_revocation BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION reject_staff_revocation()");
    await assert.rejects(service.revokeInvitation({...actor, invitationId: invitation.invitation.invitationId}), /revocation audit failure/);
    assert.equal((await db.query("SELECT invitation_status FROM auth_staff_invitations WHERE invitation_id=$1", [invitation.invitation.invitationId])).rows[0].invitation_status, "pending");
    assert.equal((await db.query("SELECT current_step FROM auth_staff_enrollment_flows WHERE invitation_id=$1", [invitation.invitation.invitationId])).rows[0].current_step, "totp");
    assert.equal((await db.query("SELECT account_id FROM auth_accounts WHERE email_normalized=$1", [invitation.invitation.email])).rows.length, 1);
    assert.equal((await service.readEnrollmentState(enrollment.token)).step, "totp");
  } finally {await db.close();}
});

test("Accepted MFA account survives revocation attempts and used-token reuse", async () => {
  const {db, repo, service, actor, invitation} = await fixture();
  try {
    const enrollment = await service.beginEnrollment(invitation.token);
    const profile = await service.completeProfile({combinedToken: enrollment.token, displayName: "Accepted Staff", password: "AcceptedStaff!Password2026"});
    const result = await service.verifyEnrollmentTotp({combinedToken: enrollment.token, code: createTotpCode(profile.totpSecret, totpCounter(new Date(NOW)))});
    assert.equal(result.role, "verifier");
    const recipientId = (await db.query("SELECT account_id FROM auth_accounts WHERE email_normalized=$1", [invitation.invitation.email])).rows[0].account_id;
    await repo.authentication.insertSession({sessionId: "accepted-recipient-session", accountId: recipientId, activeRole: "verifier", tokenHash: "accepted-session-hash", csrfTokenHash: "accepted-csrf-hash", userAgentHash: null, ipAddressHash: null, createdAt: NOW, lastSeenAt: NOW, expiresAt: "2026-10-06T01:00:00.000Z"});
    await assert.rejects(service.revokeInvitation({...actor, invitationId: invitation.invitation.invitationId}), e => e.code === "invitation_unavailable");
    await assert.rejects(service.beginEnrollment(invitation.token), e => e.code === "invitation_unavailable");
    assert.equal((await db.query("SELECT invitation_status FROM auth_staff_invitations WHERE invitation_id=$1", [invitation.invitation.invitationId])).rows[0].invitation_status, "accepted");
    const accounts = (await db.query("SELECT account_id FROM auth_accounts WHERE email_normalized=$1", [invitation.invitation.email])).rows;
    assert.equal(accounts.length, 1);
    assert.equal((await db.query("SELECT revoked_at FROM auth_sessions WHERE session_id='accepted-recipient-session'")).rows[0].revoked_at, null);
    assert.equal((await db.query("SELECT factor_status FROM auth_mfa_factors WHERE account_id=$1", [accounts[0].account_id])).rows[0].factor_status, "active");
    assert.equal((await db.query("SELECT current_step FROM auth_staff_enrollment_flows WHERE invitation_id=$1", [invitation.invitation.invitationId])).rows[0].current_step, "complete");
  } finally {await db.close();}
});
test("Expired and other-owner invitations are unavailable to a live issuer", async () => {
  const {db, service, actor, invitation} = await fixture();
  try {
    await db.query("UPDATE auth_staff_invitations SET invited_by_account_id=NULL WHERE invitation_id=$1", [invitation.invitation.invitationId]);
    await assert.rejects(service.revokeInvitation({...actor, invitationId: invitation.invitation.invitationId}), e => e.code === "invitation_unavailable");
    await db.query("UPDATE auth_staff_invitations SET invited_by_account_id=$2,created_at='2026-10-01T00:00:00Z',expires_at='2026-10-04T00:00:00Z' WHERE invitation_id=$1", [invitation.invitation.invitationId, actor.inviterAccountId]);
    await assert.rejects(service.revokeInvitation({...actor, invitationId: invitation.invitation.invitationId}), e => e.code === "invitation_unavailable");
    assert.equal((await db.query("SELECT invitation_status FROM auth_staff_invitations WHERE invitation_id=$1", [invitation.invitation.invitationId])).rows[0].invitation_status, "pending");
  } finally {await db.close();}
});

test("A second valid live issuer cannot revoke another issuer's invitation", async () => {
  const {db, repo, service, actor, invitation} = await fixture();
  try {
    const other = {inviterAccountId: "other-live-root", inviterSessionId: "other-live-session", inviterRole: "root"};
    await repo.authentication.insertAccount({accountId: other.inviterAccountId, email: "other.issuer@example.test", phone: null, displayName: "Other Issuer", status: "pending_email", passwordHash: null, workerReference: null, now: NOW});
    await repo.authentication.updateAccountAfterEmailVerification(other.inviterAccountId, NOW);
    await repo.authentication.addRole(other.inviterAccountId, "root", NOW);
    await repo.authentication.insertSession({sessionId: other.inviterSessionId, accountId: other.inviterAccountId, activeRole: "root", tokenHash: "other-session-hash", csrfTokenHash: "other-csrf-hash", userAgentHash: null, ipAddressHash: null, createdAt: NOW, lastSeenAt: NOW, expiresAt: "2026-10-06T01:00:00.000Z"});
    assert.equal(await repo.hasLiveStaffIssuerSession({accountId: other.inviterAccountId, sessionId: other.inviterSessionId, role: "root", now: NOW}), true);
    await assert.rejects(service.revokeInvitation({...other, invitationId: invitation.invitation.invitationId}), e => e.code === "invitation_unavailable");
    assert.equal((await db.query("SELECT invitation_status FROM auth_staff_invitations WHERE invitation_id=$1", [invitation.invitation.invitationId])).rows[0].invitation_status, "pending");
    assert.equal((await db.query("SELECT audit_event_id FROM platform_audit_events WHERE action_key='authentication.invitation.revoked'")).rows.length, 0);
    await service.revokeInvitation({...actor, invitationId: invitation.invitation.invitationId});
  } finally {await db.close();}
});
test("Expired session, disabled issuer and removed portal assignment fail without effects", async () => {
  const {db, service, actor, invitation} = await fixture();
  try {
    const deny = () => assert.rejects(service.revokeInvitation({...actor, invitationId: invitation.invitation.invitationId}), e => e.code === "invitation_unavailable");
    await db.query("UPDATE auth_sessions SET created_at='2026-10-01T00:00:00Z',last_seen_at='2026-10-01T00:00:00Z',expires_at='2026-10-04T00:00:00Z' WHERE session_id=$1", [actor.inviterSessionId]);
    await deny();
    await db.query("UPDATE auth_sessions SET expires_at='2026-10-06T01:00:00Z' WHERE session_id=$1", [actor.inviterSessionId]);
    await db.query("UPDATE auth_accounts SET account_status='disabled' WHERE account_id=$1", [actor.inviterAccountId]);
    await deny();
    await db.query("UPDATE auth_accounts SET account_status='active' WHERE account_id=$1", [actor.inviterAccountId]);
    await db.query("DELETE FROM auth_account_roles WHERE account_id=$1 AND role='root'", [actor.inviterAccountId]);
    await deny();
    assert.equal((await db.query("SELECT invitation_status FROM auth_staff_invitations WHERE invitation_id=$1", [invitation.invitation.invitationId])).rows[0].invitation_status, "pending");
    assert.equal((await db.query("SELECT audit_event_id FROM platform_audit_events WHERE action_key='authentication.invitation.revoked'")).rows.length, 0);
  } finally {await db.close();}
});

test("Admin can revoke its own allowed-role invitation", async () => {
  const {db, service, actor, invitation} = await fixture("admin");
  try {
    await service.revokeInvitation({...actor, invitationId: invitation.invitation.invitationId});
    assert.equal((await db.query("SELECT invitation_status FROM auth_staff_invitations WHERE invitation_id=$1", [invitation.invitation.invitationId])).rows[0].invitation_status, "revoked");
    assert.equal((await db.query("SELECT actor_role FROM platform_audit_events WHERE action_key='authentication.invitation.revoked'")).rows[0].actor_role, "admin");
  } finally {await db.close();}
});
