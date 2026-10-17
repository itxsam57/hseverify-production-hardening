import {createHash} from "node:crypto";
import assert from "node:assert/strict";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "./migration-ceiling.mjs";

import {loadWorkerRegistrationTs,setWorkerRegistrationRuntimeEnvironment} from "./worker-registration-runtime-loader.mjs";
setWorkerRegistrationRuntimeEnvironment({appEnvironment:"test"});
const {DatabaseWorkerIdentityRepository}=loadWorkerRegistrationTs("src/lib/identity/worker-identity-repository.ts");
const {DatabaseWorkerIdentityDraftRepository}=loadWorkerRegistrationTs("src/lib/identity/worker-identity-draft-repository.ts");
const {DatabaseWorkerIdentityEvidenceRepository}=loadWorkerRegistrationTs("src/lib/identity/worker-identity-evidence-repository.ts");
const {DatabaseWorkerIdentityCheckRepository}=loadWorkerRegistrationTs("src/lib/identity/worker-identity-check-repository.ts");
const {WorkerIdentityCheckService}=loadWorkerRegistrationTs("src/lib/identity/worker-identity-check-service.ts");
const {WorkerIdentityAutomatedCheckHandler}=loadWorkerRegistrationTs("src/lib/identity/worker-identity-check-handler.ts");
const {DatabaseWorkerIdentityEligibilityRepository}=loadWorkerRegistrationTs("src/lib/identity/worker-identity-eligibility-repository.ts");
const {WorkerIdentityEligibilityService}=loadWorkerRegistrationTs("src/lib/identity/worker-identity-eligibility-service.ts");
const {createTrustedOutboxWorker}=loadWorkerRegistrationTs("src/lib/outbox/outbox-domain.ts");
const {DatabaseOutboxRepository}=loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const OWNED_MIGRATION = "0120_review_recovery_notifications";
const NOW = "2026-08-10T17:20:00.000Z";
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
let principalCounter = 0;
let fileCounter = 5000;

function environment(releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: "memory://",
    releaseSha,
    sessionSecret: "worker-identity-eligibility-session-secret-32-characters",
    authPepper: "worker-identity-eligibility-auth-pepper-32-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

function token24(value) {
  return value.replace(/[^A-Za-z0-9_-]/g, "x").padEnd(24, "x").slice(0, 24);
}

function hex64(value) {
  return value.toString(16).padStart(64, "0").slice(-64);
}

async function seedPrincipal(database, suffix, role = "worker") {
  principalCounter += 1;
  const accountId = `account_identity_elig_${suffix}`;
  const sessionId = `session_identity_elig_${suffix}`;
  const email = `identity-elig-${suffix}-${principalCounter}@example.com`;
  const phone = `+9667${String(principalCounter).padStart(8, "0")}`;
  await database.query(
    `INSERT INTO auth_accounts (
       account_id, email_normalized, phone_e164, display_name, account_status,
       email_verified_at, phone_verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'active', $5, $5, $5, $5)`,
    [accountId, email, phone, `Identity Eligibility ${suffix}`, NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles (account_id, role, created_at)
     VALUES ($1, $2, $3)`,
    [accountId, role, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions (
       session_id, account_id, active_role, token_hash, csrf_token_hash,
       created_at, last_seen_at, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
    [
      sessionId,
      accountId,
      role,
      `identity_elig_token_${suffix}_${principalCounter}`,
      `identity_elig_csrf_${suffix}_${principalCounter}`,
      NOW,
      FAR_FUTURE
    ]
  );
  return {
    accountId,
    sessionId,
    activeRole: role,
    tenantMembership: null,
    accountStatus: "active",
    email,
    displayName: `Identity Eligibility ${suffix}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FAR_FUTURE
  };
}

async function drainFixtureScanJob(outbox) {
  const claimed = await outbox.claimNext(createTrustedOutboxWorker());
  assert.ok(claimed, "fixture scan job must be claimable");
  assert.equal(claimed.job.jobType, "secure_file.scan");
  const succeeded = await outbox.succeed(claimed.lease);
  assert.equal(succeeded.status, "succeeded");
}

async function seedAvailableFile(database, outbox, principal, label, mime, storage=null) {
  fileCounter += 1;
  const fileId = `secure_file_${token24(`${label}${fileCounter}`)}`;
  const extension = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
  const scanJobId = `job_${token24(`elig-scan-${fileCounter}`)}`;
  const objectKey="secure-files/"+createHash("sha256").update("hse-secure-file-object-v1\u0000"+fileId).digest("hex");
  let bytes=null;
  if(storage&&mime==="application/pdf"){
    const {default:PDFDocument}=await import("pdfkit");bytes=await new Promise((resolve,reject)=>{const document=new PDFDocument(),chunks=[];document.on("data",chunk=>chunks.push(chunk));document.on("error",reject);document.on("end",()=>resolve(Buffer.concat(chunks)));document.text("Synthetic identity source for authorized duplicate review: "+label);document.end();});await storage.put(objectKey,bytes);
  }


  await database.query(
    `INSERT INTO platform_secure_files (
       file_id, schema_version, reservation_key,
       owner_account_id, owner_role, tenant_id, membership_id,
       storage_adapter_key, object_key, display_filename
     ) VALUES ($1, 1, $2, $3, 'worker', NULL, NULL, 'local_test', $4, $5)`,
    [
      fileId,
      hex64(fileCounter * 10 + 1),
      principal.accountId,
      objectKey,
      `${label}.${extension}`
    ]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'quarantined',
         file_extension = $2,
         declared_mime = $3,
         detected_mime = $3,
         byte_size = $5,
         content_sha256 = $4
     WHERE file_id = $1`,
    [fileId, extension, mime, bytes?createHash("sha256").update(bytes).digest("hex"):hex64(fileCounter * 10 + 3),bytes?.byteLength??256]
  );
  await database.query(
    `INSERT INTO platform_outbox_jobs (
       job_id, job_type, schema_version, idempotency_key, payload,
       enqueued_by_account_id, enqueued_by_role, tenant_id, membership_id
     ) VALUES ($1, 'secure_file.scan', 1, $2, $3::jsonb,
               $4, 'worker', NULL, NULL)`,
    [
      scanJobId,
      hex64(fileCounter * 10 + 4),
      JSON.stringify({ fileRef: fileId, generation: 1 }),
      principal.accountId
    ]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'scan_pending', scan_generation = 1, scan_job_id = $2
     WHERE file_id = $1`,
    [fileId, scanJobId]
  );
  await database.query(
    `UPDATE platform_secure_files
     SET lifecycle_status = 'available', scan_result_code = 'clean'
     WHERE file_id = $1`,
    [fileId]
  );
  await drainFixtureScanJob(outbox);
  return fileId;
}

function completeDraft(overrides = {}) {
  return {
    legalFirstName: "Sam",
    legalLastName: "Khan",
    previousLegalName: null,
    dateOfBirth: "1995-02-03",
    nationality: "Pakistani",
    countryOfResidence: "Saudi Arabia",
    ...overrides
  };
}

function documentInput(fileId, documentNumber) {
  return {
    purpose: "identity_document",
    secureFileId: fileId,
    documentType: "passport",
    documentNumber,
    issueDate: "2025-01-01",
    expiryDate: "2035-01-01"
  };
}

function imageInput(purpose, fileId) {
  return {
    purpose,
    secureFileId: fileId,
    documentType: null,
    documentNumber: null,
    issueDate: null,
    expiryDate: null
  };
}

function repositories(database) {
  const outbox = new DatabaseOutboxRepository(Promise.resolve(database));
  const identity = new DatabaseWorkerIdentityRepository(Promise.resolve(database));
  const draft = new DatabaseWorkerIdentityDraftRepository(Promise.resolve(database));
  const evidence = new DatabaseWorkerIdentityEvidenceRepository(Promise.resolve(database));
  const checks = new DatabaseWorkerIdentityCheckRepository(Promise.resolve(database), outbox);
  const checkService = new WorkerIdentityCheckService(checks);
  const checkHandler = new WorkerIdentityAutomatedCheckHandler(checks, () => "test");
  const eligibility = new DatabaseWorkerIdentityEligibilityRepository(Promise.resolve(database));
  const eligibilityService = new WorkerIdentityEligibilityService(eligibility);
  return {
    outbox,
    identity,
    draft,
    evidence,
    checks,
    checkService,
    checkHandler,
    eligibility,
    eligibilityService
  };
}

async function prepareSubmittedWorker(database, suffix, options = {}) {
  const worker = await seedPrincipal(database, suffix);
  const repos = repositories(database);
  const initial = await repos.identity.ensureOwnDraft(worker);
  await repos.draft.saveOwn(worker, completeDraft(options.draft), null);
  const documentFile = await seedAvailableFile(database, repos.outbox, worker, `${suffix}-doc`, "application/pdf",options.storage);
  const photoFile = await seedAvailableFile(database, repos.outbox, worker, `${suffix}-photo`, "image/jpeg");
  const selfieFile = await seedAvailableFile(database, repos.outbox, worker, `${suffix}-selfie`, "image/png");
  await repos.evidence.bindOwn(worker, documentInput(documentFile, options.documentNumber ?? `S5-${suffix}-DOC`), null);
  await repos.evidence.bindOwn(worker, imageInput("profile_photo", photoFile), null);
  await repos.evidence.bindOwn(worker, imageInput("selfie", selfieFile), null);
  const submitted = await repos.identity.submitOwn(worker, initial.identity.lockVersion);
  return { worker, submitted, ...repos };
}

async function advanceThroughAutomatedChecks(prepared) {
  await prepared.checkService.scheduleOwn(prepared.worker);
  const claimed = await prepared.outbox.claimNext(createTrustedOutboxWorker());
  assert.ok(claimed, "identity automated-check job must be claimable");
  assert.equal(claimed.job.jobType, "worker_identity.automated_checks");
  const result = await prepared.checkHandler.handle(claimed.job, claimed.lease);
  assert.deepEqual(result, { kind: "succeeded" });
  const succeeded = await prepared.outbox.succeed(claimed.lease);
  assert.equal(succeeded.status, "succeeded");
}

async function markVerified(database, identityId) {
  const result = await database.query(
    `UPDATE worker_identities
     SET lifecycle_status = 'verified', lock_version = lock_version + 1
     WHERE identity_id = $1 AND lifecycle_status = 'manual_review'
     RETURNING identity_id`,
    [identityId]
  );
  assert.equal(result.rows.length, 1, "fixture identity must move manual_review -> verified");
}

async function setupTest(releaseSha) {
  const env = environment(releaseSha);
  const database = await openScriptDatabase(env);
  await applyMigrationsThrough(database, releaseSha, OWNED_MIGRATION);
  return database;
}


export {setupTest,prepareSubmittedWorker,advanceThroughAutomatedChecks,markVerified,seedPrincipal};
