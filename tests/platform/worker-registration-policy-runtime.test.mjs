import assert from "node:assert/strict";
import test from "node:test";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";

const { WorkerRegistrationService } = loadWorkerRegistrationTs("src/lib/auth/worker-registration-service.ts");
const { WorkerRegistrationRepository } = loadWorkerRegistrationTs("src/lib/auth/worker-registration-repository.ts");
const ENV = {
  appEnvironment: "test", databaseDriver: "pglite", databaseUrl: null,
  pgliteDataDir: "memory://", releaseSha: "worker-registration-policy-runtime",
  sessionSecret: "worker-registration-policy-session-secret-more-than-32",
  authPepper: "worker-registration-policy-pepper-more-than-32",
  authSandboxEnabled: true, authSandboxAccessKey: "worker-policy-test-sandbox-key",
  demoAuthEnabled: false, demoDataEnabled: false
};
const NOW = "2026-10-04T12:00:00.000Z";
const INPUT = {
  displayName: "Policy Boundary Worker", email: "policy.boundary@example.test",
  phone: "+923008881101", password: "PolicyBoundary!Password2026",
  country: "Pakistan", termsAccepted: true, privacyAccepted: true,
  requestFingerprint: "synthetic-policy-boundary"
};
const signupBaselines = new WeakMap();
async function fixture() {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(db, ENV.releaseSha, "0079_scoped_consent_withdrawal_reconciliation");
  const baseline = {};
  for (const table of ["auth_accounts", "auth_registration_flows", "auth_otp_challenges"]) {
    const result = await db.query("SELECT count(*)::int AS count FROM " + table);
    baseline[table] = result.rows[0].count;
  }
  signupBaselines.set(db, baseline);
  const service = new WorkerRegistrationService(new WorkerRegistrationRepository(db), {
    pepper: ENV.authPepper, sandboxEnabled: true, sandboxAccessKey: ENV.authSandboxAccessKey
  }, () => new Date(NOW));
  return { db, service };
}
async function noSignup(db) {
  for (const table of ["auth_accounts", "auth_registration_flows", "auth_otp_challenges"]) {
    const result = await db.query("SELECT count(*)::int AS count FROM " + table);
    assert.equal(result.rows[0].count, signupBaselines.get(db)[table], table + " changed after denied signup.");
  }
}

test("Worker registration rejects missing acceptance or country before creating any signup records", async () => {
  const { db, service } = await fixture();
  try {
    for (const override of [
      { termsAccepted: false }, { privacyAccepted: false },
      { termsAccepted: undefined }, { privacyAccepted: undefined },
      { termsAccepted: "true" }, { privacyAccepted: "false" },
      { country: "" }, { country: "x" }, { country: "x".repeat(101) }
    ]) {
      await assert.rejects(service.start({ ...INPUT, ...override }), error => error.code === "invalid_input");
      await noSignup(db);
    }
  } finally { await db.close(); }
});

test("Accepted Worker signup records immutable server-dated policy history through pending resume and cancellation", async () => {
  const { db, service } = await fixture();
  try {
    const first = await service.start(INPUT);
    assert.equal(first.state.step, "pending_email");
    const second = await service.start({ ...INPUT, country: "Pakistan " });
    assert.equal(second.state.step, "pending_email");
    const accounts = await db.query("SELECT account_id,account_status FROM auth_accounts WHERE email_normalized=$1", [INPUT.email]);
    assert.equal(accounts.rows.length, 1);
    assert.equal(accounts.rows[0].account_status, "pending_email");
    const accountId = accounts.rows[0].account_id;
    const history = await db.query("SELECT audit_event_id,actor_account_id,actor_role,occurred_at,metadata FROM platform_audit_events WHERE metadata->>'stage'='policy_acceptance' ORDER BY recorded_at,audit_event_id");
    assert.equal(history.rows.length, 2);
    assert.equal(new Set(history.rows.map(row => row.metadata.flowId)).size, 2);
    for (const row of history.rows) {
      assert.equal(row.actor_account_id, accountId);
      assert.equal(row.actor_role, "worker");
      assert.equal(new Date(row.occurred_at).toISOString(), NOW);
      assert.equal(row.metadata.actorAccountId, accountId);
      assert.equal(row.metadata.country, "Pakistan");
      assert.deepEqual(row.metadata.terms, { accepted: true, version: "worker-registration-terms-v1" });
      assert.deepEqual(row.metadata.privacy, { accepted: true, version: "worker-registration-privacy-v1" });
    }
    await assert.rejects(db.query("UPDATE platform_audit_events SET metadata='{}'::jsonb WHERE audit_event_id=$1", [history.rows[0].audit_event_id]), /append-only/i);
    await assert.rejects(db.query("DELETE FROM platform_audit_events WHERE audit_event_id=$1", [history.rows[0].audit_event_id]), /append-only/i);
    await service.cancel(second.token);
    await noSignup(db);
    const retained = await db.query("SELECT metadata FROM platform_audit_events WHERE metadata->>'stage'='policy_acceptance'");
    assert.equal(retained.rows.length, 2);
    assert.ok(retained.rows.every(row => row.metadata.actorAccountId === accountId));
  } finally { await db.close(); }
});

test("Failure to persist acceptance rolls back the Worker account, flow and OTP", async () => {
  const { db, service } = await fixture();
  try {
    await db.query(`CREATE FUNCTION reject_policy_acceptance() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.metadata->>'stage'='policy_acceptance' THEN RAISE EXCEPTION 'Synthetic acceptance persistence failure'; END IF; RETURN NEW; END; $$`);
    await db.query("CREATE TRIGGER reject_policy_acceptance BEFORE INSERT ON platform_audit_events FOR EACH ROW EXECUTE FUNCTION reject_policy_acceptance()");
    await assert.rejects(service.start(INPUT), /acceptance persistence failure/);
    await noSignup(db);
    const history = await db.query("SELECT audit_event_id FROM platform_audit_events WHERE metadata->>'stage'='policy_acceptance'");
    assert.equal(history.rows.length, 0);
    const security = await db.query("SELECT event_id FROM auth_security_events WHERE metadata->>'stage'='policy_acceptance'");
    assert.equal(security.rows.length, 0);
  } finally { await db.close(); }
});
