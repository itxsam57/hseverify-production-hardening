import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const NOW = "2026-08-31T16:20:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-06-catalogue-rollback-runtime",
  sessionSecret: "m2-06-catalogue-rollback-session-secret-more-than-thirty-two-characters",
  authPepper: "m2-06-catalogue-rollback-auth-pepper-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const oid = (prefix, character) => `${prefix}_${character.repeat(24)}`;

async function database() {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(db, ENV.releaseSha, "0040_assessment_catalogue_eligibility");
  return db;
}

async function seedCatalogueHistory(db) {
  const frameworkId = oid("framework", "r");
  const blueprintId = oid("assessment_blueprint", "r");
  const blueprintVersionId = oid("blueprint_version", "r");
  const catalogueEntryId = oid("assessment_catalogue", "r");
  const catalogueVersionId = oid("catalogue_version", "r");
  const actor = "account_m206_rollback_seed";

  await db.query(
    `INSERT INTO assurance_frameworks(
       framework_id,framework_reference,title,framework_status,
       created_by_account_id,created_at,updated_at
     ) VALUES($1,'M206-ROLLBACK-FRAMEWORK','M2.06 rollback framework','ACTIVE',$2,$3,$3)`,
    [frameworkId, actor, NOW]
  );
  await db.query(
    `INSERT INTO assessment_blueprints(
       blueprint_id,blueprint_reference,blueprint_status,current_version_id,
       created_by_account_id,created_at,updated_at
     ) VALUES($1,'M206-ROLLBACK-BLUEPRINT','INACTIVE',NULL,$2,$3,$3)`,
    [blueprintId, actor, NOW]
  );
  await db.query(
    `INSERT INTO assessment_blueprint_versions(
       blueprint_version_id,blueprint_id,version_no,framework_id,title,
       selectors_json,created_by_account_id,created_at
     ) VALUES($1,$2,1,$3,'M2.06 rollback blueprint version','[{"count":1}]'::jsonb,$4,$5)`,
    [blueprintVersionId, blueprintId, frameworkId, actor, NOW]
  );
  await db.query(
    `UPDATE assessment_blueprints
     SET current_version_id=$2,blueprint_status='ACTIVE',updated_at=$3
     WHERE blueprint_id=$1`,
    [blueprintId, blueprintVersionId, NOW]
  );

  await db.query(
    `INSERT INTO assessment_catalogue_entries(
       catalogue_entry_id,catalogue_reference,catalogue_status,current_version_id,
       created_by_account_id,created_at,updated_at
     ) VALUES($1,'M206-ROLLBACK-CATALOGUE','INACTIVE',NULL,$2,$3,$3)`,
    [catalogueEntryId, actor, NOW]
  );
  await db.query(
    `INSERT INTO assessment_catalogue_versions(
       catalogue_version_id,catalogue_entry_id,version_no,title,description,
       framework_id,blueprint_version_id,minimum_verified_qualifications,
       created_by_account_id,created_at
     ) VALUES($1,$2,1,'M2.06 rollback catalogue','Persistent immutable catalogue history',$3,$4,1,$5,$6)`,
    [catalogueVersionId, catalogueEntryId, frameworkId, blueprintVersionId, actor, NOW]
  );
  await db.query(
    `UPDATE assessment_catalogue_entries
     SET current_version_id=$2,catalogue_status='ACTIVE',updated_at=$3
     WHERE catalogue_entry_id=$1`,
    [catalogueEntryId, catalogueVersionId, NOW]
  );

  return { catalogueEntryId, catalogueVersionId, frameworkId, blueprintVersionId, actor };
}

test("M2.06 history-preserving down/reapply retains catalogue rows and restores immutable guards", async () => {
  const db = await database();
  try {
    const seeded = await seedCatalogueHistory(db);
    const down = await readFile(
      resolve("database/migrations/0040_assessment_catalogue_eligibility.down.sql"),
      "utf8"
    );
    const up = await readFile(
      resolve("database/migrations/0040_assessment_catalogue_eligibility.up.sql"),
      "utf8"
    );

    await db.execute(down);
    const afterDown = await db.query(
      `SELECT e.catalogue_entry_id,e.current_version_id,e.catalogue_status,
              v.catalogue_version_id,v.framework_id,v.blueprint_version_id,v.version_no
       FROM assessment_catalogue_entries e
       JOIN assessment_catalogue_versions v
         ON v.catalogue_entry_id=e.catalogue_entry_id
       WHERE e.catalogue_entry_id=$1`,
      [seeded.catalogueEntryId]
    );
    assert.equal(afterDown.rows.length, 1);
    assert.equal(afterDown.rows[0].catalogue_version_id, seeded.catalogueVersionId);
    assert.equal(afterDown.rows[0].current_version_id, seeded.catalogueVersionId);
    assert.equal(afterDown.rows[0].catalogue_status, "ACTIVE");

    await db.execute(up);
    const afterReapply = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM assessment_catalogue_versions
       WHERE catalogue_entry_id=$1 AND catalogue_version_id=$2`,
      [seeded.catalogueEntryId, seeded.catalogueVersionId]
    );
    assert.equal(afterReapply.rows[0].count, 1);

    await assert.rejects(
      db.query(
        `UPDATE assessment_catalogue_versions SET title='tampered after reapply'
         WHERE catalogue_version_id=$1`,
        [seeded.catalogueVersionId]
      ),
      /append-only/i
    );

    await assert.rejects(
      db.query(
        `INSERT INTO assessment_catalogue_versions(
           catalogue_version_id,catalogue_entry_id,version_no,title,description,
           framework_id,blueprint_version_id,minimum_verified_qualifications,
           created_by_account_id,created_at
         ) VALUES($1,$2,1,'Duplicate version',NULL,$3,$4,0,$5,$6)`,
        [
          oid("catalogue_version", "s"),
          seeded.catalogueEntryId,
          seeded.frameworkId,
          seeded.blueprintVersionId,
          seeded.actor,
          NOW
        ]
      ),
      /duplicate|unique/i
    );
  } finally {
    await db.close();
  }
});
