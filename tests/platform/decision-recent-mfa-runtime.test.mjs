import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";

function load(file, mocks = {}, cache = new Map()) {
  file = resolve(file);
  if (cache.has(file)) return cache.get(file);
  const loadedModule = { exports: {} };
  cache.set(file, loadedModule.exports);
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const require = (name) => {
    if (name in mocks) return mocks[name];
    if (name === "server-only") return {};
    if (name.startsWith(".")) return load(resolve(dirname(file), name + ".ts"), mocks, cache);
    throw new Error("Unmocked dependency " + name);
  };
  new Function("require", "module", "exports", source)(require, loadedModule, loadedModule.exports);
  cache.set(file, loadedModule.exports);
  return loadedModule.exports;
}

test("actual session MFA SQL distinguishes completed login MFA from enrollment, other sessions, expiry and replay", async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE auth_accounts(account_id text,account_status text);
    CREATE TABLE auth_account_roles(account_id text,role text);
    INSERT INTO auth_accounts VALUES ('admin-a','active');
    INSERT INTO auth_account_roles VALUES ('admin-a','admin');
    CREATE TABLE auth_sessions(session_id text, account_id text, active_role text, revoked_at timestamptz, expires_at timestamptz);
    CREATE TABLE auth_security_events(event_id text, account_id text, active_role text, event_type text, occurred_at timestamptz, metadata jsonb);
    INSERT INTO auth_sessions VALUES ('session-a','admin-a','admin',NULL,'2026-10-11T12:00:00Z'),('session-b','admin-a','admin',NULL,'2026-10-11T12:00:00Z');
    INSERT INTO auth_security_events VALUES
      ('mfa-a','admin-a','admin','mfa_succeeded','2026-10-11T10:00:00Z','{}'),
      ('enrollment','admin-a','admin','mfa_enrolled','2026-10-11T10:00:00Z','{}'),
      ('login-a','admin-a','admin','login_succeeded','2026-10-11T10:00:01Z','{"sessionId":"session-a","mfaEventId":"mfa-a"}'),
      ('login-b','admin-a','admin','login_succeeded','2026-10-11T10:00:01Z','{"sessionId":"session-b","mfaEventId":"enrollment"}');
  `);
  const query = async (sql, values) => {
    const r = await db.query(sql, values);
    return { rows: r.rows, affectedRows: r.affectedRows };
  };
  const { AuthAccessRepository } = load("src/lib/auth/auth-access-repository.ts", {
    "./registration-delivery-repository": {},
    "@/lib/auth/auth-repository": { AuthenticationRepository: class {} },
    "@/lib/database/database": {},
  });
  const repo = new AuthAccessRepository({ query });
  const principal = {sessionId:"session-a",accountId:"admin-a",activeRole:"admin"};
  const { requireRecentSessionMfa } = load("src/lib/auth/recent-mfa-service.ts", {
    "./auth-access-repository": { getAuthAccessRepository: async () => repo }
  });
  assert.equal(await requireRecentSessionMfa(principal, repo, new Date("2026-10-11T10:04:00Z")), "2026-10-11T10:00:00.000Z");
  for (const p of [undefined, {...principal,sessionId:"session-b"}, {...principal,accountId:"other"}, {...principal,activeRole:"worker"}]) {
    await assert.rejects(requireRecentSessionMfa(p, repo, new Date("2026-10-11T10:04:00Z")), /MFA/);
  }
  await db.exec("UPDATE auth_accounts SET account_status='disabled' WHERE account_id='admin-a'");
  await assert.rejects(requireRecentSessionMfa(principal, repo, new Date("2026-10-11T10:04:00Z")), /MFA/);
  await db.exec("UPDATE auth_accounts SET account_status='active'; DELETE FROM auth_account_roles");
  await assert.rejects(requireRecentSessionMfa(principal, repo, new Date("2026-10-11T10:04:00Z")), /MFA/);
  await db.exec("INSERT INTO auth_account_roles VALUES ('admin-a','admin')");
  await assert.rejects(requireRecentSessionMfa(principal, repo, new Date("2026-10-11T10:05:00.001Z")), /MFA/);
  await assert.rejects(requireRecentSessionMfa(principal, repo, new Date("2026-10-11T09:59:00Z")), /MFA/);
  await assert.rejects(repo.requireUnboundMfaEvent({eventId:"mfa-a",accountId:"admin-a",role:"admin",now:"2026-10-11T10:04:00Z"}), /already bound/);
  await assert.rejects(repo.requireUnboundMfaEvent({eventId:"enrollment",accountId:"admin-a",role:"admin",now:"2026-10-11T10:04:00Z"}), /Completed MFA/);
  await db.exec("UPDATE auth_sessions SET revoked_at='2026-10-11T10:03:00Z' WHERE session_id='session-a'");
  await assert.rejects(requireRecentSessionMfa(principal, repo, new Date("2026-10-11T10:04:00Z")), /MFA/);
  await db.exec("UPDATE auth_sessions SET revoked_at=NULL,expires_at='2026-10-11T10:03:00Z' WHERE session_id='session-a'");
  await assert.rejects(requireRecentSessionMfa(principal, repo, new Date("2026-10-11T10:04:00Z")), /MFA/);
  await db.close();
});

test("actual override service denies stale or missing MFA before any decision, Living Record, notification or audit mutation", async () => {
  let verifiedAt = null;
  let reads = 0, writes = 0, audits = 0;
  const { DecisionEngineService } = load("src/lib/decision/decision-engine-service.ts", {
    "../auth/auth-access-repository": { getAuthAccessRepository: async () => ({findSessionMfaVerification: async () => verifiedAt}) },
    "../auth/recent-mfa-service": load("src/lib/auth/recent-mfa-service.ts", {
      "./auth-access-repository": {getAuthAccessRepository: async () => ({findSessionMfaVerification: async () => verifiedAt})}
    }),
    "./decision-engine-domain": {},
    "../audit/audit-domain": {bindTrustedSystemAuditActor: () => ({})},
    "../audit/audit-repository": {},
    "./decision-engine-repository": {}
  });
  let saved;
  const service = new DecisionEngineService({append: async () => {audits++;}}, {
    findDecision: async () => {reads++;return {state:"HOLD",decisionId:"decision-a"};},
    persistOverride: async (override) => {writes++;saved=override;}
  });
  const override = {decisionId:"decision-a",tenantId:"tenant-a",previousState:"HOLD",newState:"APPROVED",actorReference:"admin-a",mfaVerifiedAt:new Date().toISOString()};
  const principal = {sessionId:"session-a",accountId:"admin-a",activeRole:"admin"};
  await assert.rejects(service.recordOverride(override, principal), /MFA/);
  verifiedAt = "2001-01-01T00:00:00Z";
  await assert.rejects(service.recordOverride(override, principal), /MFA/);
  await assert.rejects(service.recordOverride(override), /MFA/);
  assert.deepEqual([reads,writes,audits],[0,0,0]);
  verifiedAt = new Date(Date.now()-60000).toISOString();
  await service.recordOverride(override, principal);
  assert.deepEqual([reads,writes,audits],[1,1,1]);
  assert.equal(saved.mfaVerifiedAt,verifiedAt);
  await assert.rejects(service.recordOverride({...override,actorReference:"other"},principal), /actor/);
  assert.deepEqual([reads,writes,audits],[1,1,1]);
});

test("browser form cannot supply recent MFA or an authentication event", () => {
  const action=readFileSync("src/app/admin/(portal)/decisions/actions.ts","utf8");
  assert.doesNotMatch(action,/text\(formData, "mfaVerifiedAt"\)/);
  const auth=readFileSync("src/app/auth/actions.ts","utf8");
  assert.match(auth,/mfaEventId: authenticated\.mfaEventId/);
  assert.doesNotMatch(auth,/formText\(formData, "mfaEventId"\)/);
});
