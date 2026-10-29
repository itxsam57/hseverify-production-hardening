import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { PGlite } from "@electric-sql/pglite";
import { runDevelopmentServer } from "../../scripts/lib/development-server.mjs";

const SECOND = {
  accountId: "audit_second_company_account_20261029",
  email: "audit.second-company@example.test",
  tenantId: "tenant_" + "B".repeat(24),
  membershipId: "membership_" + "B".repeat(24),
  caseId: "company_verification_" + "B".repeat(24),
  versionId: "company_verification_version_" + "B".repeat(24)
};
const LINK_A = "company_worker_link_" + "A".repeat(24);
const LINK_B = "company_worker_link_" + "B".repeat(24);
const INV_A = "worker_invitation_" + "A".repeat(24);
const INV_B = "worker_invitation_" + "B".repeat(24);
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret.toUpperCase().replace(/=+$/g, "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const key = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest.at(-1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}
async function login(page, baseUrl, identity, role) {
  await page.goto(`${baseUrl}/${role}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email address").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  if (identity.totpSecret) await page.getByLabel("Authenticator code").fill(totp(identity.totpSecret));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(`**/${role}/dashboard`, { timeout: 20000 });
}
async function seedTwoCompanies(db, identities) {
  const now = new Date().toISOString();
  const expiry = new Date(Date.now() + 86400000).toISOString();
  const original = identities.company;
  const worker = identities.worker;
  await db.query(`INSERT INTO auth_accounts
    (account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
    SELECT $1,$2,'Second Independent Audit Company','active',password_hash,$3,$3,$3,$3 FROM auth_accounts WHERE account_id=$4`,
    [SECOND.accountId, SECOND.email, now, original.accountId]);
  await db.query("INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'company',$2)", [SECOND.accountId, now]);
  await db.query(`INSERT INTO auth_mfa_factors(factor_id,account_id,factor_type,encrypted_secret,factor_status,last_accepted_counter,created_at,activated_at)
    SELECT $1,$2,'totp',encrypted_secret,'active',NULL,$3,$3 FROM auth_mfa_factors WHERE account_id=$4 AND factor_type='totp'`,
    ["audit_second_company_totp_20261029", SECOND.accountId, now, original.accountId]);
  await db.query(`INSERT INTO platform_tenants(tenant_id,tenant_type,display_name,tenant_status,created_by_account_id,created_at,updated_at,activated_at)
    VALUES($1,'company','Second Independent Audit Company','active',$2,$3,$3,$3)`, [SECOND.tenantId, SECOND.accountId, now]);
  await db.query(`INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at)
    VALUES($1,$2,$3,'company','owner','active',$3,$4,$4,$4)`, [SECOND.membershipId, SECOND.tenantId, SECOND.accountId, now]);
  await db.query(`INSERT INTO company_verification_cases(case_id,tenant_id,owner_account_id,current_version_id,case_status,lock_version,created_at,updated_at,submitted_at,verified_at)
    VALUES($1,$2,$3,NULL,'verified',2,$4,$4,$4,$4)`, [SECOND.caseId, SECOND.tenantId, SECOND.accountId, now]);
  await db.query(`INSERT INTO company_verification_versions(
    version_id,case_id,version_number,parent_version_id,version_status,draft_revision,
    legal_name,trading_name,registration_number,country,industry,company_size,website,
    authorized_representative,business_email_normalized,business_phone_e164,
    terms_accepted_at,privacy_accepted_at,created_at,updated_at,submitted_at,terminal_at)
    VALUES($1,$2,1,NULL,'verified',0,'Second Independent Audit Company','Second Audit Trading',
    'SECOND-REG-2026','Pakistan','Construction','51-200','https://second-audit.example.test',
    'Second Company Owner',$3,'+923009876542',$4,$4,$4,$4,$4,$4)`, [SECOND.versionId, SECOND.caseId, SECOND.email, now]);
  await db.query("UPDATE company_verification_cases SET current_version_id=$2 WHERE case_id=$1", [SECOND.caseId, SECOND.versionId]);
  for (const [tenant, membership, invitation, link, suffix] of [
    [original.tenantId, original.membershipId, INV_A, LINK_A, "A"],
    [SECOND.tenantId, SECOND.membershipId, INV_B, LINK_B, "B"]
  ]) {
    await db.query(`INSERT INTO company_worker_invitations(
      invitation_id,tenant_id,email_normalized,token_hash,invitation_status,invited_by_membership_id,
      accepted_by_worker_account_id,resend_available_at,expires_at,accepted_at,created_at,updated_at)
      VALUES($1,$2,$3,$4,'accepted',$5,$6,$7,$8,$7,$7,$7)`,
    [invitation, tenant, worker.email.toLowerCase(), `dual-company-${suffix}-hash`, membership, worker.accountId, now, expiry]);
    await db.query(`INSERT INTO company_worker_links(
      link_id,tenant_id,worker_account_id,link_source,invitation_id,link_status,worker_accepted_at,activated_at,created_at,updated_at)
      VALUES($1,$2,$3,'invitation',$4,'active',$5,$5,$5,$5)`,
    [link, tenant, worker.accountId, invitation, now]);
  }
}

test("M1.10 dual-employer browser protects each tenant while preserving Worker history", { timeout: 230000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "hse-dual-company-browser-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = { ...process.env, HSE_APP_ENV: "development", HSE_DATABASE_DRIVER: "pglite",
    HSE_PGLITE_DATA_DIR: join(directory, "db"), HSE_RELEASE_SHA: "dual-company-browser",
    HSE_SESSION_SECRET: "dual-company-session-secret-at-least-32-characters",
    HSE_AUTH_PEPPER: "dual-company-password-pepper-at-least-32-characters",
    HSE_ENABLE_WORKER_DEMO_AUTH: "false", HSE_USE_WORKER_DEMO_DATA: "false",
    HSE_AUDIT_CREDENTIALS_PATH: join(directory, "credentials.json") };
  try {
    for (const script of ["scripts/db-migrate.mjs", "scripts/independent-audit-seed.mjs"]) {
      const command = spawnSync(process.execPath, [script], { cwd: process.cwd(), env, encoding: "utf8", timeout: 60000 });
      assert.equal(command.status, 0, `${script}: ${command.stderr || command.stdout}`);
    }
    const identities = JSON.parse(await readFile(env.HSE_AUDIT_CREDENTIALS_PATH, "utf8"));
    const db = await PGlite.create(env.HSE_PGLITE_DATA_DIR);
    try { await seedTwoCompanies(db, identities); } finally { await db.close(); }
    const company2 = { email: SECOND.email, password: identities.company.password, totpSecret: identities.company.totpSecret };
    const result = await runDevelopmentServer({ args: ["--hostname", "127.0.0.1", "--port", String(port)],
      probeUrl: `${baseUrl}/company/login`, projectRoot: process.cwd(), environment: env, probe: async () => {
        const browser = await chromium.launch({ headless: true });
        try {
          const first = await browser.newPage();
          const second = await browser.newPage();
          const worker = await browser.newPage();
          await login(first, baseUrl, identities.company, "company");
          await login(second, baseUrl, company2, "company");
          await login(worker, baseUrl, identities.worker, "worker");
          await worker.goto(`${baseUrl}/worker/company-access`, { waitUntil: "domcontentloaded" });
          const active = worker.locator('section[aria-labelledby="active-company-links-heading"]');
          await active.getByRole("heading", { name: "Independent Audit Company", exact: true }).waitFor();
          await active.getByRole("heading", { name: "Second Independent Audit Company", exact: true }).waitFor();
          assert.equal(await active.locator("article").count(), 2, "Both consented Company links must remain independently active");
          for (const [page, own, foreign] of [[first, LINK_A, LINK_B], [second, LINK_B, LINK_A]]) {
            await page.goto(`${baseUrl}/company/workers/${own}`, { waitUntil: "domcontentloaded" });
            await page.getByRole("heading", { name: identities.worker.displayName || "Independent Audit worker" }).waitFor();
            await page.getByRole("heading", { name: "End Company relationship" }).waitFor();
            const denied = await page.goto(`${baseUrl}/company/workers/${foreign}`, { waitUntil: "domcontentloaded" });
            assert.equal(denied.status(), 404, "Company could read another tenant's Worker link");
            assert.equal(await page.getByRole("heading", { name: "End Company relationship" }).count(), 0);
          }
          await second.goto(`${baseUrl}/company/workers/${LINK_B}`, { waitUntil: "domcontentloaded" });
          await second.getByLabel("Reason for ending relationship").fill("Second Company project ended; first employer must stay active.");
          await second.getByLabel("I confirm the Company relationship will end immediately.").check();
          await second.getByRole("button", { name: "End relationship", exact: true }).click();
          await second.getByText("This Company relationship has ended. The Worker identity and prior history remain intact.", { exact: true }).waitFor();
          await worker.goto(`${baseUrl}/worker/company-access`, { waitUntil: "domcontentloaded" });
          const stillActive = worker.locator('section[aria-labelledby="active-company-links-heading"]');
          const previous = worker.locator('section[aria-labelledby="historical-company-links-heading"]');
          await stillActive.getByRole("heading", { name: "Independent Audit Company", exact: true }).waitFor();
          assert.equal(await stillActive.locator("article").count(), 1);
          await previous.getByRole("heading", { name: "Second Independent Audit Company", exact: true }).waitFor();
          await previous.getByText("revoked", { exact: true }).waitFor();
          await first.goto(`${baseUrl}/company/workers/${LINK_A}`, { waitUntil: "domcontentloaded" });
          await first.getByRole("heading", { name: "End Company relationship" }).waitFor();
          console.log("ACTUAL_DUAL_COMPANY_BROWSER Worker sees two independent employers, each Company forbidden foreign case, Company B termination retains A active and B history");
        } finally { await browser.close(); }
      } });
    assert.equal(result.requestedSignal, "SMOKE_COMPLETE");
    const check = await PGlite.create(env.HSE_PGLITE_DATA_DIR);
    try {
      const rows = (await check.query("SELECT link_id,tenant_id,worker_account_id,link_status FROM company_worker_links WHERE link_id IN($1,$2) ORDER BY link_id", [LINK_A, LINK_B])).rows;
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map(row => row.link_status), ["active", "revoked"]);
      assert.equal(rows[0].worker_account_id, identities.worker.accountId);
      assert.equal(rows[1].worker_account_id, identities.worker.accountId);
      assert.equal(rows[0].tenant_id, identities.company.tenantId);
      assert.equal(rows[1].tenant_id, SECOND.tenantId);
      const audits = (await check.query("SELECT action_key,metadata FROM platform_audit_events WHERE target_reference=$1 AND action_key='company_workforce.link.revoked'", [LINK_B])).rows;
      assert.equal(audits.length, 1);
      const reason = typeof audits[0].metadata === "string" ? JSON.parse(audits[0].metadata) : audits[0].metadata;
      assert.equal(reason.tenantId, SECOND.tenantId);
      assert.equal(reason.reason, "Second Company project ended; first employer must stay active.");
      console.log("ACTUAL_DUAL_COMPANY_DB first tenant link active, second revoked, single tenant-bound audit, Worker identity not merged");
    } finally { await check.close(); }
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
});
