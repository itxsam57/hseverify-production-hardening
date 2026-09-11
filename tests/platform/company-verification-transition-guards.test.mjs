import assert from "node:assert/strict";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const OWNED_MIGRATION = "0024_company_verification_transition_guards";
const NOW = "2026-08-11T04:00:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";

function environment(releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: "memory://",
    releaseSha,
    sessionSecret: "company-transition-test-session-secret-with-32-characters",
    authPepper: "company-transition-test-pepper-with-more-than-thirty-two-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

async function seedDraftCase(database, suffix) {
  const token = suffix.padEnd(24, "x").slice(0, 24);
  const accountId = `account_${token}`;
  const tenantId = `tenant_${token}`;
  const membershipId = `membership_${token}`;
  const caseId = `company_verification_${token}`;
  const versionId = `company_verification_version_${token}`;

  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, display_name, account_status,
       email_verified_at, created_at, updated_at
     ) VALUES ($1, $2, 'Transition Company Owner', 'active', $3, $3, $3)`,
    [accountId, `${suffix}@example.com`, NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, 'company', $2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO platform_tenants (
       tenant_id, tenant_type, display_name, tenant_status, created_at, updated_at
     ) VALUES ($1, 'company', 'Transition Company', 'pending', $2, $2)`,
    [tenantId, NOW]
  );
  await database.query(
    `INSERT INTO auth_tenant_memberships (
       membership_id, tenant_id, account_id, portal_role,
       membership_role, membership_status, created_at, updated_at
     ) VALUES ($1, $2, $3, 'company', 'owner', 'invited', $4, $4)`,
    [membershipId, tenantId, accountId, NOW]
  );
  await database.query(
    `INSERT INTO company_verification_cases (
       case_id, tenant_id, owner_account_id, case_status, created_at, updated_at
     ) VALUES ($1, $2, $3, 'draft', $4, $4)`,
    [caseId, tenantId, accountId, NOW]
  );
  await database.query(
    `INSERT INTO company_verification_versions (
       version_id, case_id, version_number, version_status, draft_revision,
       legal_name, trading_name, registration_number, country, industry,
       company_size, website, authorized_representative,
       business_email_normalized, business_phone_e164,
       terms_accepted_at, privacy_accepted_at, created_at, updated_at
     ) VALUES (
       $1, $2, 1, 'draft', 0,
       'Transition Company', 'Transition Trading', 'TRANS-001', 'Pakistan', 'Construction',
       '11-50', 'https://transition.example.com/', 'Transition Owner',
       $3, '+923001234567',
       $4, $4, $4, $4
     )`,
    [versionId, caseId, `${suffix}@example.com`, NOW]
  );
  await database.query(
    `UPDATE company_verification_cases
     SET current_version_id = $2
     WHERE case_id = $1`,
    [caseId, versionId]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, 'company', $3, $4, $5, $5, $6)`,
    [
      `session_${token}`,
      accountId,
      `transition_token_${suffix}`,
      `transition_csrf_${suffix}`,
      NOW,
      FAR_FUTURE
    ]
  );
  return { caseId, versionId };
}

test("M1.08 SQL guards reject impossible Company case and version transitions", async () => {
  const env = environment("m1-08-transition-guard");
  const database = await openScriptDatabase(env);
  try {
    await applyMigrationsThrough(database, env.releaseSha, OWNED_MIGRATION);
    const record = await seedDraftCase(database, "transition-guard");

    await assert.rejects(
      () =>
        database.query(
          `UPDATE company_verification_cases
           SET case_status = 'verified', verified_at = CURRENT_TIMESTAMP
           WHERE case_id = $1`,
          [record.caseId]
        ),
      /Invalid Company verification case transition/i
    );
    await assert.rejects(
      () =>
        database.query(
          `UPDATE company_verification_versions
           SET version_status = 'verified', submitted_at = CURRENT_TIMESTAMP, terminal_at = CURRENT_TIMESTAMP
           WHERE version_id = $1`,
          [record.versionId]
        ),
      /Invalid Company verification version transition/i
    );

    await database.query(
      `UPDATE company_verification_versions
       SET version_status = 'submitted', submitted_at = CURRENT_TIMESTAMP
       WHERE version_id = $1`,
      [record.versionId]
    );
    await database.query(
      `UPDATE company_verification_cases
       SET case_status = 'submitted', submitted_at = CURRENT_TIMESTAMP
       WHERE case_id = $1`,
      [record.caseId]
    );
    await database.query(
      `UPDATE company_verification_versions
       SET version_status = 'withdrawn', terminal_at = CURRENT_TIMESTAMP
       WHERE version_id = $1`,
      [record.versionId]
    );
    await database.query(
      `UPDATE company_verification_cases
       SET case_status = 'withdrawn', withdrawn_at = CURRENT_TIMESTAMP
       WHERE case_id = $1`,
      [record.caseId]
    );

    await assert.rejects(
      () =>
        database.query(
          `UPDATE company_verification_cases
           SET case_status = 'draft'
           WHERE case_id = $1`,
          [record.caseId]
        ),
      /Terminal Company verification case state is immutable/i
    );
    await assert.rejects(
      () =>
        database.query(
          `UPDATE company_verification_versions
           SET version_status = 'submitted'
           WHERE version_id = $1`,
          [record.versionId]
        ),
      /Terminal Company verification version state is immutable/i
    );
  } finally {
    await database.close();
  }
});
