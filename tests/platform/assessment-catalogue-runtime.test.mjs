import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_ASSESSMENT_CATALOGUE_RUNTIME_DIST;
assert.ok(runtime, "HSE_ASSESSMENT_CATALOGUE_RUNTIME_DIST is required");
const domain = await import(
  pathToFileURL(join(runtime, "assessment-catalogue", "assessment-catalogue-domain.js")).href
);
const serviceModule = await import(
  pathToFileURL(join(runtime, "assessment-catalogue", "assessment-catalogue-service.js")).href
);
const {
  AssessmentCatalogueAccessError,
  AssessmentCatalogueConflictError,
  AssessmentCatalogueInputError
} = domain;
const { AssessmentCatalogueService } = serviceModule;

const NOW_DATE = new Date("2026-08-18T10:45:00.000Z");
const NOW = NOW_DATE.toISOString();
const FUTURE = "2099-01-01T00:00:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-06-catalogue-runtime",
  sessionSecret: "m2-06-catalogue-runtime-session-secret-more-than-thirty-two-characters",
  authPepper: "m2-06-catalogue-runtime-auth-pepper-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const oid = (prefix, c) => `${prefix}_${c.repeat(24)}`;

async function db() {
  const database = await openScriptDatabase(ENV);
  await applyMigrationsThrough(database, ENV.releaseSha, "0040_assessment_catalogue_eligibility");
  return database;
}

async function seedAdmin(database, c, { revoked = false, accountStatus = "active" } = {}) {
  const accountId = `account_m206_catalogue_admin_${c}`;
  const sessionId = `session_m206_catalogue_admin_${c}`;
  const email = `admin-m206-${c.toLowerCase()}@example.com`;
  await database.query(
    `INSERT INTO auth_accounts(
       account_id,email_normalized,display_name,account_status,password_hash,
       email_verified_at,password_set_at,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$6,$6,$6,$6)`,
    [accountId, email, `M2.06 Admin ${c}`, accountStatus, "scrypt$16384$8$1$salt$hash", NOW]
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
    accountStatus,
    email,
    displayName: `M2.06 Admin ${c}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FUTURE,
    tenantMembership: null,
    authorizedPlatformPermission: "platform.operations.manage"
  });
}

async function seedFramework(database, c, status = "ACTIVE") {
  const frameworkId = oid("framework", c);
  const frameworkReference = `CAT-FRAME-${c.toUpperCase()}`;
  await database.query(
    `INSERT INTO assurance_frameworks(
       framework_id,framework_reference,title,framework_status,
       created_by_account_id,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$6,$6)`,
    [frameworkId, frameworkReference, `Catalogue Framework ${c}`, status, `account_seed_${c}`, NOW]
  );
  return { frameworkId, frameworkReference };
}

async function seedBlueprint(database, c, frameworkId, { status = "ACTIVE", withSecondVersion = false } = {}) {
  const blueprintId = oid("assessment_blueprint", c);
  const v1 = oid("blueprint_version", c);
  const v2 = withSecondVersion ? oid("blueprint_version", c.toUpperCase()) : null;
  await database.query(
    `INSERT INTO assessment_blueprints(
       blueprint_id,blueprint_reference,blueprint_status,current_version_id,
       created_by_account_id,created_at,updated_at
     ) VALUES($1,$2,'INACTIVE',NULL,$3,$4,$4)`,
    [blueprintId, `CAT-BP-${c.toUpperCase()}`, `account_seed_${c}`, NOW]
  );
  await database.query(
    `INSERT INTO assessment_blueprint_versions(
       blueprint_version_id,blueprint_id,version_no,framework_id,title,
       selectors_json,created_by_account_id,created_at
     ) VALUES($1,$2,1,$3,$4,'[{"count":1}]'::jsonb,$5,$6)`,
    [v1, blueprintId, frameworkId, `Catalogue Blueprint ${c} v1`, `account_seed_${c}`, NOW]
  );
  if (v2) {
    await database.query(
      `INSERT INTO assessment_blueprint_versions(
         blueprint_version_id,blueprint_id,version_no,framework_id,title,
         selectors_json,created_by_account_id,created_at
       ) VALUES($1,$2,2,$3,$4,'[{"count":1}]'::jsonb,$5,$6)`,
      [v2, blueprintId, frameworkId, `Catalogue Blueprint ${c} v2`, `account_seed_${c}`, NOW]
    );
  }
  await database.query(
    `UPDATE assessment_blueprints
     SET current_version_id=$2,blueprint_status=$3,updated_at=$4
     WHERE blueprint_id=$1`,
    [blueprintId, v2 ?? v1, status, NOW]
  );
  return { blueprintId, v1, v2, frameworkId };
}

const catalogueVersion = (frameworkReference, blueprintVersionId, suffix = "A", minimum = 1) => ({
  title: `Core Worker Safety ${suffix}`,
  description: `Catalogue version ${suffix} for verified Worker eligibility.`,
  frameworkReference,
  blueprintVersionId,
  minimumVerifiedQualifications: minimum
});

test("M2.06 creates an active catalogue entry with immutable version 1 and dedicated audit", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "A");
    const framework = await seedFramework(database, "a");
    const blueprint = await seedBlueprint(database, "a", framework.frameworkId);
    const service = new AssessmentCatalogueService(database);
    const made = await service.createEntry(
      admin,
      {
        catalogueReference: "CAT-CORE-A",
        version: catalogueVersion(framework.frameworkReference, blueprint.v1, "A", 1)
      },
      NOW_DATE
    );

    assert.equal(made.entry.catalogueReference, "CAT-CORE-A");
    assert.equal(made.entry.catalogueStatus, "ACTIVE");
    assert.equal(made.version.versionNo, 1);
    assert.equal(made.version.frameworkId, framework.frameworkId);
    assert.equal(made.version.blueprintVersionId, blueprint.v1);
    assert.equal(made.version.minimumVerifiedQualifications, 1);

    const listed = await service.listEntries(admin, NOW_DATE);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].entry.currentVersionId, made.version.catalogueVersionId);

    const audit = await database.query(
      `SELECT action_key,metadata FROM platform_audit_events
       WHERE target_reference=$1 ORDER BY audit_sequence`,
      [made.entry.catalogueEntryId]
    );
    assert.deepEqual(audit.rows.map((row) => row.action_key), ["assessment.catalogue.created"]);
    const serialized = JSON.stringify(audit.rows[0].metadata).toLowerCase();
    assert.equal(serialized.includes("answer"), false);
    assert.equal(serialized.includes("rubric"), false);
    assert.equal(serialized.includes("nonce"), false);
  } finally {
    await database.close();
  }
});

test("M2.06 validates live Admin, active framework, active stable blueprint and exact framework match", async () => {
  const database = await db();
  try {
    const live = await seedAdmin(database, "B");
    const revoked = await seedAdmin(database, "C", { revoked: true });
    const activeFramework = await seedFramework(database, "b");
    const otherFramework = await seedFramework(database, "c");
    const inactiveFramework = await seedFramework(database, "d", "INACTIVE");
    const activeBlueprint = await seedBlueprint(database, "b", activeFramework.frameworkId);
    const inactiveBlueprint = await seedBlueprint(database, "c", activeFramework.frameworkId, { status: "INACTIVE" });
    const service = new AssessmentCatalogueService(database);

    await assert.rejects(
      service.createEntry(
        revoked,
        { catalogueReference: "CAT-REVOKED", version: catalogueVersion(activeFramework.frameworkReference, activeBlueprint.v1) },
        NOW_DATE
      ),
      AssessmentCatalogueAccessError
    );
    await assert.rejects(
      service.createEntry(
        live,
        { catalogueReference: "CAT-FRAME-INACTIVE", version: catalogueVersion(inactiveFramework.frameworkReference, activeBlueprint.v1) },
        NOW_DATE
      ),
      AssessmentCatalogueInputError
    );
    await assert.rejects(
      service.createEntry(
        live,
        { catalogueReference: "CAT-BP-INACTIVE", version: catalogueVersion(activeFramework.frameworkReference, inactiveBlueprint.v1) },
        NOW_DATE
      ),
      AssessmentCatalogueInputError
    );
    await assert.rejects(
      service.createEntry(
        live,
        { catalogueReference: "CAT-FRAME-MISMATCH", version: catalogueVersion(otherFramework.frameworkReference, activeBlueprint.v1) },
        NOW_DATE
      ),
      AssessmentCatalogueInputError
    );
  } finally {
    await database.close();
  }
});

test("M2.06 may pin an older exact immutable blueprint version while the stable blueprint remains active", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "D");
    const framework = await seedFramework(database, "e");
    const blueprint = await seedBlueprint(database, "e", framework.frameworkId, { withSecondVersion: true });
    assert.ok(blueprint.v2);
    const service = new AssessmentCatalogueService(database);
    const made = await service.createEntry(
      admin,
      {
        catalogueReference: "CAT-PIN-OLD-BP",
        version: catalogueVersion(framework.frameworkReference, blueprint.v1, "Pinned v1", 0)
      },
      NOW_DATE
    );
    assert.equal(made.version.blueprintVersionId, blueprint.v1);
    assert.notEqual(made.version.blueprintVersionId, blueprint.v2);
  } finally {
    await database.close();
  }
});

test("M2.06 duplicate catalogue references fail with a domain-safe conflict", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "E");
    const framework = await seedFramework(database, "f");
    const blueprint = await seedBlueprint(database, "f", framework.frameworkId);
    const service = new AssessmentCatalogueService(database);
    const input = {
      catalogueReference: "CAT-DUPLICATE",
      version: catalogueVersion(framework.frameworkReference, blueprint.v1)
    };
    await service.createEntry(admin, input, NOW_DATE);
    await assert.rejects(
      service.createEntry(admin, input, NOW_DATE),
      (error) => {
        assert.ok(error instanceof AssessmentCatalogueConflictError);
        assert.equal(error.message.toLowerCase().includes("duplicate key"), false);
        assert.equal(error.message.toLowerCase().includes("constraint"), false);
        return true;
      }
    );
  } finally {
    await database.close();
  }
});

test("M2.06 eight-way stale catalogue revision race has exactly one winner", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "F");
    const framework = await seedFramework(database, "g");
    const blueprint = await seedBlueprint(database, "g", framework.frameworkId);
    const service = new AssessmentCatalogueService(database);
    const made = await service.createEntry(
      admin,
      {
        catalogueReference: "CAT-RACE",
        version: catalogueVersion(framework.frameworkReference, blueprint.v1, "Base")
      },
      NOW_DATE
    );

    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        service.reviseEntry(
          admin,
          {
            catalogueEntryId: made.entry.catalogueEntryId,
            expectedCurrentVersionId: made.entry.currentVersionId,
            version: catalogueVersion(framework.frameworkReference, blueprint.v1, `Revision ${index}`, index % 2)
          },
          NOW_DATE
        )
      )
    );
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 7);
    assert.ok(
      outcomes
        .filter((outcome) => outcome.status === "rejected")
        .every((outcome) => outcome.reason instanceof AssessmentCatalogueConflictError)
    );

    const versions = await database.query(
      `SELECT version_no FROM assessment_catalogue_versions
       WHERE catalogue_entry_id=$1 ORDER BY version_no`,
      [made.entry.catalogueEntryId]
    );
    assert.deepEqual(versions.rows.map((row) => Number(row.version_no)), [1, 2]);
  } finally {
    await database.close();
  }
});

test("M2.06 status changes leave versions immutable and history rejects tamper", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "G");
    const framework = await seedFramework(database, "h");
    const blueprint = await seedBlueprint(database, "h", framework.frameworkId);
    const service = new AssessmentCatalogueService(database);
    const made = await service.createEntry(
      admin,
      {
        catalogueReference: "CAT-TAMPER",
        version: catalogueVersion(framework.frameworkReference, blueprint.v1, "Tamper")
      },
      NOW_DATE
    );

    const inactive = await service.setStatus(admin, made.entry.catalogueEntryId, "INACTIVE", NOW_DATE);
    assert.equal(inactive.catalogueStatus, "INACTIVE");
    const active = await service.setStatus(admin, made.entry.catalogueEntryId, "ACTIVE", NOW_DATE);
    assert.equal(active.catalogueStatus, "ACTIVE");

    await assert.rejects(
      database.query(
        `UPDATE assessment_catalogue_versions SET title='tampered'
         WHERE catalogue_version_id=$1`,
        [made.version.catalogueVersionId]
      ),
      /append-only/i
    );
    await assert.rejects(
      database.query(
        `DELETE FROM assessment_catalogue_versions WHERE catalogue_version_id=$1`,
        [made.version.catalogueVersionId]
      ),
      /append-only/i
    );

    const versions = await database.query(
      `SELECT COUNT(*)::int AS count FROM assessment_catalogue_versions
       WHERE catalogue_entry_id=$1`,
      [made.entry.catalogueEntryId]
    );
    assert.equal(versions.rows[0].count, 1);
    const audits = await database.query(
      `SELECT action_key FROM platform_audit_events
       WHERE target_reference=$1 ORDER BY audit_sequence`,
      [made.entry.catalogueEntryId]
    );
    assert.deepEqual(audits.rows.map((row) => row.action_key), [
      "assessment.catalogue.created",
      "assessment.catalogue.status.changed",
      "assessment.catalogue.status.changed"
    ]);
  } finally {
    await database.close();
  }
});
