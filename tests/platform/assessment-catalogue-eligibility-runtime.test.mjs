import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_ASSESSMENT_CATALOGUE_ELIGIBILITY_RUNTIME_DIST;
assert.ok(runtime, "HSE_ASSESSMENT_CATALOGUE_ELIGIBILITY_RUNTIME_DIST is required");
const eligibilityModule = await import(
  pathToFileURL(join(runtime, "assessment-catalogue", "assessment-catalogue-eligibility-service.js")).href
);
const { AssessmentCatalogueEligibilityService, AssessmentCatalogueEligibilityAccessError } = eligibilityModule;

const NOW_DATE = new Date("2026-08-18T10:55:00.000Z");
const NOW = NOW_DATE.toISOString();
const FUTURE = "2099-01-01T00:00:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-06-eligibility-runtime",
  sessionSecret: "m2-06-eligibility-session-secret-more-than-thirty-two-characters",
  authPepper: "m2-06-eligibility-auth-pepper-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const oid = (prefix, c) => `${prefix}_${c.repeat(24)}`;
const evidenceId = (prefix, c) => `${prefix}_${c.repeat(32)}`;

async function db() {
  const database = await openScriptDatabase(ENV);
  await applyMigrationsThrough(database, ENV.releaseSha, "0040_assessment_catalogue_eligibility");
  return database;
}

async function seedAccount(database, c, role = "worker", { revoked = false, status = "active" } = {}) {
  const accountId = `account_m206_eligibility_${role}_${c}`;
  const sessionId = `session_m206_eligibility_${role}_${c}`;
  await database.query(
    `INSERT INTO auth_accounts(
       account_id,email_normalized,display_name,account_status,password_hash,
       email_verified_at,password_set_at,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$6,$6,$6,$6)`,
    [accountId, `${role}-${c}@example.com`, `Eligibility ${role} ${c}`, status, "scrypt$16384$8$1$salt$hash", NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,$2,$3)`,
    [accountId, role, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions(
       session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,
       expires_at,revoked_at,revocation_reason
     ) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9)`,
    [
      sessionId,
      accountId,
      role,
      `token-${role}-${c}`,
      `csrf-${role}-${c}`,
      NOW,
      FUTURE,
      revoked ? NOW : null,
      revoked ? "eligibility_fixture_revoked" : null
    ]
  );
  return Object.freeze({
    accountId,
    sessionId,
    activeRole: role,
    accountStatus: status,
    email: `${role}-${c}@example.com`,
    displayName: `Eligibility ${role} ${c}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FUTURE,
    tenantMembership: null
  });
}

async function seedFrameworkBlueprintCatalogue(
  database,
  c,
  { minimum = 0, catalogueStatus = "ACTIVE", blueprintStatus = "ACTIVE" } = {}
) {
  const frameworkId = oid("framework", c);
  const blueprintId = oid("assessment_blueprint", c);
  const blueprintVersionId = oid("blueprint_version", c);
  const catalogueEntryId = oid("assessment_catalogue", c);
  const catalogueVersionId = oid("catalogue_version", c);
  await database.query(
    `INSERT INTO assurance_frameworks(
       framework_id,framework_reference,title,framework_status,created_by_account_id,created_at,updated_at
     ) VALUES($1,$2,$3,'ACTIVE',$4,$5,$5)`,
    [frameworkId, `ELIG-FRAME-${c.toUpperCase()}`, `Eligibility Framework ${c}`, `account_seed_${c}`, NOW]
  );
  await database.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO assessment_blueprints(
         blueprint_id,blueprint_reference,blueprint_status,current_version_id,
         created_by_account_id,created_at,updated_at
       ) VALUES($1,$2,'INACTIVE',NULL,$3,$4,$4)`,
      [blueprintId, `ELIG-BP-${c.toUpperCase()}`, `account_seed_${c}`, NOW]
    );
    await transaction.query(
      `INSERT INTO assessment_blueprint_versions(
         blueprint_version_id,blueprint_id,version_no,framework_id,title,
         selectors_json,created_by_account_id,created_at
       ) VALUES($1,$2,1,$3,$4,'[{"count":1}]'::jsonb,$5,$6)`,
      [blueprintVersionId, blueprintId, frameworkId, `Eligibility Blueprint ${c}`, `account_seed_${c}`, NOW]
    );
    await transaction.query(
      `UPDATE assessment_blueprints
       SET current_version_id=$2,blueprint_status=$3,updated_at=$4 WHERE blueprint_id=$1`,
      [blueprintId, blueprintVersionId, blueprintStatus, NOW]
    );
  });
  await database.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO assessment_catalogue_entries(
         catalogue_entry_id,catalogue_reference,catalogue_status,current_version_id,
         created_by_account_id,created_at,updated_at
       ) VALUES($1,$2,'INACTIVE',NULL,$3,$4,$4)`,
      [catalogueEntryId, `ELIG-CAT-${c.toUpperCase()}`, `account_seed_${c}`, NOW]
    );
    await transaction.query(
      `INSERT INTO assessment_catalogue_versions(
         catalogue_version_id,catalogue_entry_id,version_no,title,description,framework_id,
         blueprint_version_id,minimum_verified_qualifications,created_by_account_id,created_at
       ) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9)`,
      [
        catalogueVersionId,
        catalogueEntryId,
        `Eligibility Catalogue ${c}`,
        `Worker-safe eligibility offering ${c}.`,
        frameworkId,
        blueprintVersionId,
        minimum,
        `account_seed_${c}`,
        NOW
      ]
    );
    await transaction.query(
      `UPDATE assessment_catalogue_entries
       SET current_version_id=$2,catalogue_status=$3,updated_at=$4 WHERE catalogue_entry_id=$1`,
      [catalogueEntryId, catalogueVersionId, catalogueStatus, NOW]
    );
  });
  return { frameworkId, blueprintId, blueprintVersionId, catalogueEntryId, catalogueVersionId };
}

async function seedCase(database, c, workerAccountId, frameworkId, { status = "Assessment pending", snapshot = true } = {}) {
  const tenantId = oid("tenant", c);
  const orderId = oid("assurance_order", c);
  const targetId = oid("assurance_target", c);
  const caseId = oid("assurance_case", c);
  await database.query(
    `INSERT INTO assurance_orders(
       order_id,tenant_id,created_by_membership_id,order_name,order_reference,
       requested_identity_checks,requested_evidence_checks,assessment_framework_references,
       interview_required,order_status,validation_errors,scope_version,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,FALSE,'DRAFT','[]'::jsonb,1,$6,$6)`,
    [orderId, tenantId, `membership_${c.repeat(16)}`, `Eligibility Order ${c}`, `ELIG-ORDER-${c}`, NOW]
  );
  await database.query(
    `INSERT INTO assurance_order_workers(
       target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,
       target_status,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,'company','eligible',$6,$6)`,
    [targetId, orderId, tenantId, `worker_link_${c.repeat(16)}`, workerAccountId, NOW]
  );
  await database.query(
    `INSERT INTO assurance_cases(
       case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,
       case_status,owner_kind,next_action,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,'worker','View available assessments',$8,$8)`,
    [caseId, orderId, targetId, tenantId, `worker_link_${c.repeat(16)}`, workerAccountId, status, NOW]
  );
  if (snapshot) {
    await database.query(
      `INSERT INTO assurance_case_policy_snapshots(
         snapshot_id,case_id,tenant_id,framework_id,policy_id,global_policy_version_id,
         tenant_override_id,policy_source,effective_value_json,reference_time,resolved_at,
         created_by_account_id
       ) VALUES($1,$2,$3,$4,$5,$6,NULL,'GLOBAL','{}'::jsonb,$7,$7,NULL)`,
      [
        oid("policy_snapshot", c),
        caseId,
        tenantId,
        frameworkId,
        oid("policy", c),
        oid("policy_version", c),
        NOW
      ]
    );
  }
  return { caseId, tenantId };
}

async function seedSubmittedQualification(database, c, workerAccountId) {
  const recordId = evidenceId("evidence_record", c);
  const versionId = evidenceId("evidence_version", c);
  await database.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO worker_evidence_records(
         record_id,worker_account_id,record_kind,lifecycle_status,current_version_id,created_at,updated_at
       ) VALUES($1,$2,'qualification','active',NULL,$3,$3)`,
      [recordId, workerAccountId, NOW]
    );
    await transaction.query(
      `INSERT INTO worker_evidence_versions(
         version_id,record_id,version_number,revision,version_status,
         supersedes_version_id,created_at,updated_at,submitted_at
       ) VALUES($1,$2,1,1,'submitted',NULL,$3,$3,$3)`,
      [versionId, recordId, NOW]
    );
    await transaction.query(
      `INSERT INTO worker_qualification_versions(version_id,declaration_accepted)
       VALUES($1,TRUE)`,
      [versionId]
    );
    await transaction.query(
      `UPDATE worker_evidence_records SET current_version_id=$2,updated_at=$3 WHERE record_id=$1`,
      [recordId, versionId, NOW]
    );
  });
  return { recordId, versionId };
}

async function approveQualification(database, c, workerAccountId, caseId, tenantId, evidence, outcome = "APPROVED") {
  const taskId = oid("evidence_review", c);
  const verifier = `verifier_account_${c.repeat(16)}`;
  await database.query(
    `INSERT INTO evidence_review_tasks(
       task_id,tenant_id,case_id,worker_account_id,evidence_kind,source_record_id,
       source_version_id,secure_file_id,evidence_label,task_status,
       assigned_verifier_account_id,claimed_at,decided_at,created_at,updated_at
     ) VALUES($1,$2,$3,$4,'qualification',$5,$6,NULL,$7,$8,$9,$10,$10,$10,$10)`,
    [
      taskId,
      tenantId,
      caseId,
      workerAccountId,
      evidence.recordId,
      evidence.versionId,
      `Qualification ${c}`,
      outcome,
      verifier,
      NOW
    ]
  );
  await database.query(
    `INSERT INTO evidence_review_decisions(
       decision_id,task_id,source_version_id,verifier_account_id,outcome,reason,decided_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [oid("review_decision", c), taskId, evidence.versionId, verifier, outcome, `Eligibility review ${outcome.toLowerCase()}`, NOW]
  );
  return taskId;
}

async function replaceCurrentSubmittedVersion(database, c, evidence) {
  const nextVersionId = evidenceId("evidence_version", c.toUpperCase());
  await database.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO worker_evidence_versions(
         version_id,record_id,version_number,revision,version_status,
         supersedes_version_id,created_at,updated_at,submitted_at
       ) VALUES($1,$2,2,1,'submitted',$3,$4,$4,$4)`,
      [nextVersionId, evidence.recordId, evidence.versionId, NOW]
    );
    await transaction.query(
      `INSERT INTO worker_qualification_versions(version_id,declaration_accepted)
       VALUES($1,TRUE)`,
      [nextVersionId]
    );
    await transaction.query(
      `UPDATE worker_evidence_records SET current_version_id=$2,updated_at=$3 WHERE record_id=$1`,
      [evidence.recordId, nextVersionId, NOW]
    );
  });
  return nextVersionId;
}

test("M2.06 zero-prerequisite catalogue is available only for the authenticated Worker's owned pending case", async () => {
  const database = await db();
  try {
    const worker = await seedAccount(database, "a");
    const other = await seedAccount(database, "b");
    const offering = await seedFrameworkBlueprintCatalogue(database, "a", { minimum: 0 });
    const owned = await seedCase(database, "a", worker.accountId, offering.frameworkId);
    const copied = await seedCase(database, "b", other.accountId, offering.frameworkId);
    const service = new AssessmentCatalogueEligibilityService(database);

    const available = await service.listAvailableForWorker(worker, NOW_DATE);
    assert.equal(available.length, 1);
    assert.equal(available[0].caseId, owned.caseId);
    assert.equal(available[0].catalogueEntryId, offering.catalogueEntryId);
    assert.equal(available[0].minimumVerifiedQualifications, 0);
    assert.equal(available[0].verifiedQualificationCount, 0);

    const ownedCase = await service.findAvailableForCase(worker, owned.caseId, NOW_DATE);
    assert.equal(ownedCase.length, 1);
    assert.deepEqual(await service.findAvailableForCase(worker, copied.caseId, NOW_DATE), []);
    assert.deepEqual(await service.findAvailableForCase(worker, "not-a-case-id", NOW_DATE), []);
  } finally {
    await database.close();
  }
});

test("M2.06 Worker availability requires a live active Worker session and Worker-only permission", async () => {
  const database = await db();
  try {
    const worker = await seedAccount(database, "c");
    const revoked = await seedAccount(database, "d", "worker", { revoked: true });
    const admin = await seedAccount(database, "e", "admin");
    const service = new AssessmentCatalogueEligibilityService(database);

    assert.deepEqual(await service.listAvailableForWorker(worker, NOW_DATE), []);
    await assert.rejects(service.listAvailableForWorker(revoked, NOW_DATE), AssessmentCatalogueEligibilityAccessError);
    await assert.rejects(service.listAvailableForWorker(admin, NOW_DATE), AssessmentCatalogueEligibilityAccessError);
  } finally {
    await database.close();
  }
});

test("M2.06 case snapshot, framework, catalogue status and stable blueprint status all fail closed", async () => {
  const database = await db();
  try {
    const worker = await seedAccount(database, "f");
    const active = await seedFrameworkBlueprintCatalogue(database, "f", { minimum: 0 });
    const inactiveCatalogue = await seedFrameworkBlueprintCatalogue(database, "g", { minimum: 0, catalogueStatus: "INACTIVE" });
    const inactiveBlueprint = await seedFrameworkBlueprintCatalogue(database, "h", { minimum: 0, blueprintStatus: "INACTIVE" });
    await seedCase(database, "f", worker.accountId, active.frameworkId, { snapshot: false });
    await seedCase(database, "g", worker.accountId, inactiveCatalogue.frameworkId);
    await seedCase(database, "h", worker.accountId, inactiveBlueprint.frameworkId);
    await seedCase(database, "i", worker.accountId, active.frameworkId, { status: "Evidence pending" });
    const service = new AssessmentCatalogueEligibilityService(database);
    assert.deepEqual(await service.listAvailableForWorker(worker, NOW_DATE), []);
  } finally {
    await database.close();
  }
});

test("M2.06 minimum one requires exact-current submitted APPROVED qualification lineage", async () => {
  const database = await db();
  try {
    const worker = await seedAccount(database, "j");
    const offering = await seedFrameworkBlueprintCatalogue(database, "j", { minimum: 1 });
    const owned = await seedCase(database, "j", worker.accountId, offering.frameworkId);
    const service = new AssessmentCatalogueEligibilityService(database);

    assert.deepEqual(await service.listAvailableForWorker(worker, NOW_DATE), []);
    const evidence = await seedSubmittedQualification(database, "j", worker.accountId);
    assert.deepEqual(await service.listAvailableForWorker(worker, NOW_DATE), []);
    await approveQualification(database, "j", worker.accountId, owned.caseId, owned.tenantId, evidence, "APPROVED");

    const approved = await service.listAvailableForWorker(worker, NOW_DATE);
    assert.equal(approved.length, 1);
    assert.equal(approved[0].verifiedQualificationCount, 1);

    await replaceCurrentSubmittedVersion(database, "j", evidence);
    assert.deepEqual(await service.listAvailableForWorker(worker, NOW_DATE), []);
  } finally {
    await database.close();
  }
});

test("M2.06 rejected, changes-requested and another Worker's qualification never qualify", async () => {
  const database = await db();
  try {
    const worker = await seedAccount(database, "k");
    const other = await seedAccount(database, "l");
    const offering = await seedFrameworkBlueprintCatalogue(database, "k", { minimum: 1 });
    const owned = await seedCase(database, "k", worker.accountId, offering.frameworkId);
    const otherCase = await seedCase(database, "l", other.accountId, offering.frameworkId);
    const rejected = await seedSubmittedQualification(database, "k", worker.accountId);
    await approveQualification(database, "k", worker.accountId, owned.caseId, owned.tenantId, rejected, "REJECTED");
    const changes = await seedSubmittedQualification(database, "m", worker.accountId);
    await approveQualification(database, "m", worker.accountId, owned.caseId, owned.tenantId, changes, "CHANGES_REQUESTED");
    const otherEvidence = await seedSubmittedQualification(database, "l", other.accountId);
    await approveQualification(database, "l", other.accountId, otherCase.caseId, otherCase.tenantId, otherEvidence, "APPROVED");

    const service = new AssessmentCatalogueEligibilityService(database);
    assert.deepEqual(await service.listAvailableForWorker(worker, NOW_DATE), []);
  } finally {
    await database.close();
  }
});

test("M2.06 availability DTO is secret-safe and reads create no forms or case mutations", async () => {
  const database = await db();
  try {
    const worker = await seedAccount(database, "n");
    const offering = await seedFrameworkBlueprintCatalogue(database, "n", { minimum: 0 });
    const owned = await seedCase(database, "n", worker.accountId, offering.frameworkId);
    const beforeForms = await database.query(`SELECT COUNT(*)::int AS count FROM generated_assessment_forms`);
    const beforeCase = await database.query(`SELECT case_status,updated_at FROM assurance_cases WHERE case_id=$1`, [owned.caseId]);
    const service = new AssessmentCatalogueEligibilityService(database);
    const available = await service.listAvailableForWorker(worker, NOW_DATE);
    const afterForms = await database.query(`SELECT COUNT(*)::int AS count FROM generated_assessment_forms`);
    const afterCase = await database.query(`SELECT case_status,updated_at FROM assurance_cases WHERE case_id=$1`, [owned.caseId]);

    assert.equal(available.length, 1);
    assert.equal(beforeForms.rows[0].count, afterForms.rows[0].count);
    assert.deepEqual(afterCase.rows[0], beforeCase.rows[0]);
    const serialized = JSON.stringify(available).toLowerCase();
    for (const forbidden of [
      "verifier",
      "reason",
      "evidence",
      "filename",
      "answer",
      "rubric",
      "nonce",
      "workeraccountid",
      "worker_account_id"
    ]) {
      assert.equal(serialized.includes(forbidden), false, `eligibility DTO leaked ${forbidden}`);
    }
  } finally {
    await database.close();
  }
});
