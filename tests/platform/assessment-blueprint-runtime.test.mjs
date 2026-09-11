import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_ASSESSMENT_BLUEPRINT_RUNTIME_DIST;
assert.ok(runtime, "HSE_ASSESSMENT_BLUEPRINT_RUNTIME_DIST is required");
const domain = await import(
  pathToFileURL(join(runtime, "assessment-generation", "assessment-blueprint-domain.js")).href
);
const serviceModule = await import(
  pathToFileURL(join(runtime, "assessment-generation", "assessment-blueprint-service.js")).href
);
const {
  AssessmentBlueprintAccessError,
  AssessmentBlueprintConflictError,
  AssessmentBlueprintInputError
} = domain;
const { AssessmentBlueprintService } = serviceModule;

const NOW_DATE = new Date("2026-08-18T07:20:00.000Z");
const NOW = NOW_DATE.toISOString();
const FUTURE = "2099-01-01T00:00:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-05-blueprint-runtime",
  sessionSecret: "m2-05-blueprint-runtime-session-secret-more-than-thirty-two-characters",
  authPepper: "m2-05-blueprint-runtime-auth-pepper-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const oid = (prefix, c) => `${prefix}_${c.repeat(24)}`;

async function db() {
  const database = await openScriptDatabase(ENV);
  await applyMigrationsThrough(database, ENV.releaseSha, "0039_randomized_assessment_forms");
  return database;
}

async function seedAdmin(database, c, { revoked = false } = {}) {
  const accountId = `account_m205_blueprint_admin_${c}`;
  const sessionId = `session_m205_blueprint_admin_${c}`;
  const email = `admin-m205-${c.toLowerCase()}@example.com`;
  await database.query(
    `INSERT INTO auth_accounts(
       account_id,email_normalized,display_name,account_status,password_hash,
       email_verified_at,password_set_at,created_at,updated_at
     ) VALUES($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [accountId, email, `Admin ${c}`, "scrypt$16384$8$1$salt$hash", NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions(
       session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,
       last_seen_at,expires_at,revoked_at,revocation_reason
     ) VALUES($1,$2,'admin',$3,$4,$5,$5,$6,$7,$8)`,
    [
      sessionId,
      accountId,
      `token-${c}`,
      `csrf-${c}`,
      NOW,
      FUTURE,
      revoked ? NOW : null,
      revoked ? "runtime_fixture_revoked" : null
    ]
  );
  return Object.freeze({
    accountId,
    sessionId,
    activeRole: "admin",
    accountStatus: "active",
    email,
    displayName: `Admin ${c}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FUTURE,
    tenantMembership: null,
    authorizedPlatformPermission: "platform.operations.manage"
  });
}

async function seedFramework(database, c, status = "ACTIVE") {
  const frameworkId = oid("framework", c);
  const frameworkReference = `FRAME-${c}`;
  await database.query(
    `INSERT INTO assurance_frameworks(
       framework_id,framework_reference,title,framework_status,
       created_by_account_id,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$6,$6)`,
    [frameworkId, frameworkReference, `Framework ${c}`, status, `account_seed_${c}`, NOW]
  );
  return { frameworkId, frameworkReference };
}

const version = (frameworkReference, suffix = "A") => ({
  title: `Core Safety Assessment ${suffix}`,
  frameworkReference,
  selectors: [
    {
      count: 3,
      questionType: "MULTIPLE_CHOICE",
      difficulty: "MEDIUM",
      domainReference: "Hazard Control",
      tagsAll: ["core", "hazards"]
    },
    { count: 2, questionType: "LONG_TEXT", tagsAll: [] }
  ]
});

test("M2.05 creates an active blueprint with immutable version 1 and dedicated audit", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "A");
    const framework = await seedFramework(database, "A");
    const service = new AssessmentBlueprintService(database);
    const made = await service.createBlueprint(
      admin,
      { blueprintReference: "BP-CORE-A", version: version(framework.frameworkReference) },
      NOW_DATE
    );
    assert.equal(made.blueprint.blueprintReference, "BP-CORE-A");
    assert.equal(made.blueprint.blueprintStatus, "ACTIVE");
    assert.equal(made.version.versionNo, 1);
    assert.equal(made.version.frameworkId, framework.frameworkId);
    assert.equal(made.version.totalCount, 5);
    assert.equal(made.version.selectors.length, 2);

    const listed = await service.listBlueprints(admin);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].blueprint.currentVersionId, made.version.blueprintVersionId);

    const audit = await database.query(
      `SELECT action_key FROM platform_audit_events WHERE target_reference=$1 ORDER BY audit_sequence`,
      [made.blueprint.blueprintId]
    );
    assert.deepEqual(audit.rows.map((row) => row.action_key), ["assessment.blueprint.created"]);
  } finally {
    await database.close();
  }
});

test("M2.05 rejects revoked Admin and inactive framework", async () => {
  const database = await db();
  try {
    const live = await seedAdmin(database, "B");
    const revoked = await seedAdmin(database, "C", { revoked: true });
    const activeFramework = await seedFramework(database, "B");
    const inactiveFramework = await seedFramework(database, "C", "INACTIVE");
    const service = new AssessmentBlueprintService(database);

    await assert.rejects(
      service.createBlueprint(
        revoked,
        { blueprintReference: "BP-REVOKED", version: version(activeFramework.frameworkReference) },
        NOW_DATE
      ),
      AssessmentBlueprintAccessError
    );
    await assert.rejects(
      service.createBlueprint(
        live,
        { blueprintReference: "BP-INACTIVE", version: version(inactiveFramework.frameworkReference) },
        NOW_DATE
      ),
      AssessmentBlueprintInputError
    );
  } finally {
    await database.close();
  }
});

test("M2.05 eight-way stale blueprint revision race has one winner", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "D");
    const framework = await seedFramework(database, "D");
    const service = new AssessmentBlueprintService(database);
    const made = await service.createBlueprint(
      admin,
      { blueprintReference: "BP-RACE", version: version(framework.frameworkReference) },
      NOW_DATE
    );

    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        service.reviseBlueprint(
          admin,
          {
            blueprintId: made.blueprint.blueprintId,
            expectedCurrentVersionId: made.blueprint.currentVersionId,
            version: version(framework.frameworkReference, `Revision ${index}`)
          },
          NOW_DATE
        )
      )
    );
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 7);
    assert.ok(
      attempts
        .filter((attempt) => attempt.status === "rejected")
        .every((attempt) => attempt.reason instanceof AssessmentBlueprintConflictError)
    );

    const versions = await database.query(
      `SELECT version_no FROM assessment_blueprint_versions WHERE blueprint_id=$1 ORDER BY version_no`,
      [made.blueprint.blueprintId]
    );
    assert.deepEqual(versions.rows.map((row) => Number(row.version_no)), [1, 2]);
    const audits = await database.query(
      `SELECT action_key FROM platform_audit_events WHERE target_reference=$1 ORDER BY audit_sequence`,
      [made.blueprint.blueprintId]
    );
    assert.deepEqual(audits.rows.map((row) => row.action_key), [
      "assessment.blueprint.created",
      "assessment.blueprint.revised"
    ]);
  } finally {
    await database.close();
  }
});

test("M2.05 status changes do not mutate versions and version history rejects tamper", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "E");
    const framework = await seedFramework(database, "E");
    const service = new AssessmentBlueprintService(database);
    const made = await service.createBlueprint(
      admin,
      { blueprintReference: "BP-TAMPER", version: version(framework.frameworkReference) },
      NOW_DATE
    );
    const inactive = await service.setStatus(
      admin,
      made.blueprint.blueprintId,
      "INACTIVE",
      NOW_DATE
    );
    assert.equal(inactive.blueprintStatus, "INACTIVE");
    const active = await service.setStatus(
      admin,
      made.blueprint.blueprintId,
      "ACTIVE",
      NOW_DATE
    );
    assert.equal(active.blueprintStatus, "ACTIVE");

    await assert.rejects(
      database.query(
        `UPDATE assessment_blueprint_versions SET title='tampered' WHERE blueprint_version_id=$1`,
        [made.version.blueprintVersionId]
      ),
      /append-only/i
    );
    await assert.rejects(
      database.query(
        `DELETE FROM assessment_blueprint_versions WHERE blueprint_version_id=$1`,
        [made.version.blueprintVersionId]
      ),
      /append-only/i
    );
    const versions = await database.query(
      `SELECT COUNT(*)::int AS count FROM assessment_blueprint_versions WHERE blueprint_id=$1`,
      [made.blueprint.blueprintId]
    );
    assert.equal(versions.rows[0].count, 1);
    const audits = await database.query(
      `SELECT action_key FROM platform_audit_events WHERE target_reference=$1 ORDER BY audit_sequence`,
      [made.blueprint.blueprintId]
    );
    assert.deepEqual(audits.rows.map((row) => row.action_key), [
      "assessment.blueprint.created",
      "assessment.blueprint.status.changed",
      "assessment.blueprint.status.changed"
    ]);
  } finally {
    await database.close();
  }
});
