import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_PUBLIC_VERIFICATION_RUNTIME_DIST;
assert.ok(runtime, "HSE_PUBLIC_VERIFICATION_RUNTIME_DIST is required");

const OWNED_MIGRATION = "0032_public_verification_concern_evidence";
const SYSTEM_ACCOUNT_ID = "account_public_concern_intake_system";
const evidenceFiles = Object.freeze({
  migrationUp: "database/migrations/0032_public_verification_concern_evidence.up.sql",
  migrationDown: "database/migrations/0032_public_verification_concern_evidence.down.sql",
  service: "src/lib/public-verification/public-concern-file-service.ts",
  secureFileDomain: "src/lib/secure-files/secure-file-domain.ts",
  contactActions: "src/app/contact/actions.ts",
  concernForm: "src/components/public-verification/public-concern-form.tsx"
});

function source(path) {
  return readFileSync(resolve(path), "utf8");
}

function sha(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function environment(releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: "memory://",
    releaseSha,
    sessionSecret: "m1-12-concern-evidence-session-secret-with-more-than-thirty-two-characters",
    authPepper: "m1-12-concern-evidence-auth-pepper-with-more-than-thirty-two-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

function listFilesRecursively(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursively(absolute));
    else files.push(absolute);
  }
  return files;
}

async function seedConcern(database) {
  const concernId = `public_concern_${"C".repeat(24)}`;
  await database.query(
    `INSERT INTO public_verification_concerns (
       concern_id, subject_reference_hash, category, description,
       contact_email, idempotency_key, created_at, updated_at
     ) VALUES ($1, $2, 'document_concern', $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      concernId,
      sha("concern-evidence-subject"),
      "The uploaded credential evidence appears inconsistent with the public result.",
      "evidence-reporter@example.com",
      sha("concern-evidence-idempotency")
    ]
  );
  return concernId;
}

async function seedSecureFile(database, input) {
  const fileId = `secure_file_${input.marker.repeat(24)}`;
  const jobId = `job_${input.jobMarker.repeat(24)}`;
  if (input.lifecycleStatus !== "reserved") {
    await database.query(
      `INSERT INTO platform_outbox_jobs (
         job_id, job_type, schema_version, idempotency_key, payload,
         enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
       ) VALUES ($1, 'secure_file.scan', 1, $2, $3::jsonb, $4, 'root', NULL, NULL)`,
      [
        jobId,
        sha(`job:${input.marker}`),
        JSON.stringify({ fileRef: fileId, generation: 1 }),
        SYSTEM_ACCOUNT_ID
      ]
    );
  }

  if (input.lifecycleStatus === "reserved") {
    await database.query(
      `INSERT INTO platform_secure_files (
         file_id, schema_version, reservation_key, owner_account_id, owner_role,
         storage_adapter_key, object_key, display_filename, lifecycle_status
       ) VALUES ($1, 1, $2, $3, 'root', 'local_test', $4, $5, 'reserved')`,
      [
        fileId,
        sha(`reservation:${input.marker}`),
        SYSTEM_ACCOUNT_ID,
        `secure-files/${sha(`object:${input.marker}`)}`,
        `pending-${input.marker}.pdf`
      ]
    );
    return fileId;
  }

  const available = input.lifecycleStatus === "available";
  await database.query(
    `INSERT INTO platform_secure_files (
       file_id, schema_version, reservation_key, owner_account_id, owner_role,
       storage_adapter_key, object_key, display_filename, lifecycle_status,
       file_extension, declared_mime, detected_mime, byte_size, content_sha256,
       quarantined_at, available_at, unsafe_at,
       scan_generation, scan_job_id, scan_result_code, scan_completed_at
     ) VALUES (
       $1, 1, $2, $3, 'root', 'local_test', $4, $5, $6,
       'pdf', 'application/pdf', 'application/pdf', 128, $7,
       CURRENT_TIMESTAMP,
       CASE WHEN $6 = 'available' THEN CURRENT_TIMESTAMP ELSE NULL END,
       CASE WHEN $6 = 'unsafe' THEN CURRENT_TIMESTAMP ELSE NULL END,
       1, $8, $9, CURRENT_TIMESTAMP
     )`,
    [
      fileId,
      sha(`reservation:${input.marker}`),
      SYSTEM_ACCOUNT_ID,
      `secure-files/${sha(`object:${input.marker}`)}`,
      `${input.lifecycleStatus}-${input.marker}.pdf`,
      input.lifecycleStatus,
      sha(`content:${input.marker}`),
      jobId,
      available ? "clean" : "eicar_test_signature"
    ]
  );
  return fileId;
}

test("M1.12 concern evidence adds an owned candidate layer and a disabled non-login storage principal", async () => {
  for (const path of [evidenceFiles.migrationUp, evidenceFiles.migrationDown]) {
    assert.equal(existsSync(resolve(path)), true, `${path} must exist`);
  }

  const migration = source(evidenceFiles.migrationUp);
  assert.match(migration, /public_verification_concern_evidence_candidates/);
  assert.match(migration, /public_verification_concerns/);
  assert.match(migration, /platform_secure_files/);
  assert.match(migration, /ON DELETE RESTRICT/i);
  assert.match(migration, /pending/);
  assert.match(migration, /bound/);
  assert.match(migration, /rejected/);
  assert.match(migration, /account_public_concern_intake_system/);
  assert.match(migration, /disabled/);
  assert.match(migration, /cannot authenticate/i);
  assert.ok(!/ON DELETE CASCADE/i.test(migration));

  const database = await openScriptDatabase(environment("m1-12-concern-evidence-schema"));
  try {
    await applyMigrationsThrough(database, "m1-12-concern-evidence-schema", OWNED_MIGRATION);
    const columns = await database.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_name='public_verification_concern_evidence_candidates'
        ORDER BY ordinal_position`,
      []
    );
    const names = columns.rows.map((row) => row.column_name);
    for (const required of [
      "candidate_id",
      "concern_id",
      "secure_file_id",
      "candidate_status",
      "created_at"
    ]) {
      assert.ok(names.includes(required), required);
    }

    const system = await database.query(
      `SELECT account_status, password_hash
         FROM auth_accounts
        WHERE account_id=$1`,
      [SYSTEM_ACCOUNT_ID]
    );
    assert.equal(system.rows[0]?.account_status, "disabled");
    assert.equal(system.rows[0]?.password_hash, null);

    await assert.rejects(
      database.query(
        `INSERT INTO auth_sessions (
           session_id, account_id, active_role, token_hash, csrf_token_hash,
           created_at, last_seen_at, expires_at
         ) VALUES ($1,$2,'root',$3,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP + INTERVAL '1 hour')`,
        [
          `session_${"s".repeat(24)}`,
          SYSTEM_ACCOUNT_ID,
          sha("public-concern-system-session-token"),
          sha("public-concern-system-session-csrf")
        ]
      ),
      /cannot authenticate/i
    );
  } finally {
    await database.close();
  }
});

test("M1.12 concern evidence cannot bind before M1.06 availability and a rejected terminal candidate does not lock a clean retry", async () => {
  const database = await openScriptDatabase(environment("m1-12-concern-evidence-lifecycle"));
  try {
    await applyMigrationsThrough(database, "m1-12-concern-evidence-lifecycle", OWNED_MIGRATION);
    const concernId = await seedConcern(database);

    const pendingFileId = await seedSecureFile(database, {
      marker: "P",
      jobMarker: "p",
      lifecycleStatus: "reserved"
    });
    await database.query(
      `INSERT INTO public_verification_concern_evidence_candidates (
         candidate_id, concern_id, secure_file_id, candidate_status
       ) VALUES ($1, $2, $3, 'pending')`,
      [`public_concern_evidence_${"P".repeat(24)}`, concernId, pendingFileId]
    );
    await assert.rejects(
      database.query(
        `UPDATE public_verification_concern_evidence_candidates
            SET candidate_status='bound', finalized_at=CURRENT_TIMESTAMP
          WHERE candidate_id=$1`,
        [`public_concern_evidence_${"P".repeat(24)}`]
      ),
      /not available/i
    );

    const unsafeFileId = await seedSecureFile(database, {
      marker: "U",
      jobMarker: "u",
      lifecycleStatus: "unsafe"
    });
    await database.query(
      `INSERT INTO public_verification_concern_evidence_candidates (
         candidate_id, concern_id, secure_file_id, candidate_status
       ) VALUES ($1, $2, $3, 'pending')`,
      [`public_concern_evidence_${"U".repeat(24)}`, concernId, unsafeFileId]
    );
    await database.query(
      `UPDATE public_verification_concern_evidence_candidates
          SET candidate_status='rejected', finalized_at=CURRENT_TIMESTAMP
        WHERE candidate_id=$1`,
      [`public_concern_evidence_${"U".repeat(24)}`]
    );

    const cleanFileId = await seedSecureFile(database, {
      marker: "A",
      jobMarker: "a",
      lifecycleStatus: "available"
    });
    await database.query(
      `INSERT INTO public_verification_concern_evidence_candidates (
         candidate_id, concern_id, secure_file_id, candidate_status
       ) VALUES ($1, $2, $3, 'pending')`,
      [`public_concern_evidence_${"A".repeat(24)}`, concernId, cleanFileId]
    );
    await database.query(
      `UPDATE public_verification_concern_evidence_candidates
          SET candidate_status='bound', finalized_at=CURRENT_TIMESTAMP
        WHERE candidate_id=$1`,
      [`public_concern_evidence_${"A".repeat(24)}`]
    );

    const history = await database.query(
      `SELECT candidate_status
         FROM public_verification_concern_evidence_candidates
        WHERE concern_id=$1
        ORDER BY candidate_id`,
      [concernId]
    );
    assert.deepEqual(
      history.rows.map((row) => row.candidate_status).sort(),
      ["bound", "pending", "rejected"].sort()
    );
  } finally {
    await database.close();
  }
});

test("M1.12 concern evidence authority is server-branded and browser fields cannot select concern/file/storage ownership", () => {
  assert.equal(existsSync(resolve(evidenceFiles.service)), true, `${evidenceFiles.service} must exist`);
  const service = source(evidenceFiles.service);
  const secureFileDomain = source(evidenceFiles.secureFileDomain);
  const actions = source(evidenceFiles.contactActions);

  assert.match(service, /PublicConcernUploadAuthority/);
  assert.match(service, /uploadConcernEvidence/);
  assert.match(service, /finalizeConcernEvidenceCandidate/);
  assert.match(secureFileDomain, /public_concern/);

  for (const forbiddenField of [
    "concernId",
    "secureFileId",
    "fileId",
    "reservationKey",
    "objectKey",
    "ownerAccountId",
    "ownerRole"
  ]) {
    assert.ok(
      !new RegExp(`formData\\.get\\([\"']${forbiddenField}[\"']\\)`).test(actions),
      forbiddenField
    );
  }
});

test("M1.12 optional concern evidence reuses M1.06 validation, private storage and scan scheduling before binding", async () => {
  assert.equal(existsSync(resolve(evidenceFiles.service)), true, `${evidenceFiles.service} must exist`);
  const service = source(evidenceFiles.service);
  const form = source(evidenceFiles.concernForm);

  assert.match(service, /validateSecureFileUpload|createDefaultSecureFileUploadPolicy/);
  assert.match(service, /PrivateObjectStorage|private-object-storage/);
  assert.match(service, /scan|schedule/i);
  assert.match(service, /available/);
  assert.match(service, /unsafe|scan_failed/);

  assert.match(form, /name=["']evidence["']/);
  assert.match(form, /application\/pdf/);
  assert.match(form, /image\/png/);
  assert.match(form, /image\/jpeg/);
  assert.ok(!/encType=/.test(form), "React Server Action form encoding must remain framework-owned");

  const runtimeModulePath = resolve(
    runtime,
    "public-verification",
    "public-concern-file-service.js"
  );
  assert.equal(existsSync(runtimeModulePath), true, "compiled concern file service must exist");
  const runtimeModule = await import(pathToFileURL(runtimeModulePath).href);
  assert.equal(typeof runtimeModule.PublicConcernFileService, "function");
});

test("M1.12 public routes expose no concern-evidence preview or download authority", () => {
  const publicRoots = [resolve("src/app/contact"), resolve("src/app/verify")];
  const files = publicRoots.flatMap(listFilesRecursively);
  for (const file of files) {
    const relative = file.replace(resolve("."), "").replaceAll("\\", "/");
    const body = readFileSync(file, "utf8");
    assert.ok(!/signed.*(?:preview|download)|(?:preview|download).*signed/i.test(body), relative);
    assert.ok(!/secure-file-access|createSecureFileAccess|authorizeSecureFileAccess/.test(body), relative);
  }
});
