import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_PUBLIC_VERIFICATION_RUNTIME_DIST;
assert.ok(runtime, "HSE_PUBLIC_VERIFICATION_RUNTIME_DIST is required");

const serviceModule = await import(
  pathToFileURL(
    join(runtime, "public-verification", "public-verification-service.js")
  ).href
);
const repositoryModule = await import(
  pathToFileURL(
    join(runtime, "public-verification", "public-verification-repository.js")
  ).href
);

const { PublicVerificationService } = serviceModule;
const { PublicVerificationRepository } = repositoryModule;

const OWNED_MIGRATION = "0031_public_verification_foundation";
const SECRET = "m1-12-concern-service-secret-with-more-than-thirty-two-characters";
const NOW = new Date("2026-08-17T14:30:00.000Z");
const WORKER_ID = `worker_id_${"Q".repeat(24)}`;
const REQUEST_FINGERPRINT = "c".repeat(64);
const IDEMPOTENCY_NONCE = "concern_nonce_ABCDEFGHIJKLMNOPQRSTUVWX";

function plusMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

function tamper(value) {
  const index = Math.max(1, Math.floor(value.length / 2));
  const replacement = value[index] === "A" ? "B" : "A";
  return `${value.slice(0, index)}${replacement}${value.slice(index + 1)}`;
}

function workerSource() {
  return {
    permanentWorkerId: WORKER_ID,
    lifecycleStatus: "verified",
    legalFirstName: "Public",
    legalLastName: "Concern Worker",
    issuedAt: "2026-08-11T09:00:00.000Z"
  };
}

class ConcernSpyRepository {
  constructor() {
    this.rateLimitCalls = [];
    this.workerLookupCalls = [];
    this.concernCalls = [];
    this.workerRow = workerSource();
  }

  async consumeRateLimit(input) {
    this.rateLimitCalls.push({ ...input });
    return 1;
  }

  async findPublicWorkerByPermanentId(workerId) {
    this.workerLookupCalls.push(workerId);
    return workerId === WORKER_ID ? this.workerRow : null;
  }

  async createConcernWithAudit(input) {
    this.concernCalls.push(structuredClone(input));
    return {
      concernId: `public_concern_${"R".repeat(24)}`,
      created: true
    };
  }
}

async function createPublicResultToken(repository) {
  const service = new PublicVerificationService(repository, SECRET);
  const lookup = await service.lookupPublicVerification({
    rawIdentifier: WORKER_ID,
    requestFingerprint: REQUEST_FINGERPRINT,
    now: NOW
  });
  assert.equal(lookup.kind, "redirect");
  return { service, publicToken: lookup.publicToken };
}

function validConcern(publicToken, overrides = {}) {
  return {
    publicToken,
    requestFingerprint: REQUEST_FINGERPRINT,
    category: "suspected_fraud",
    description: "  The public verification result appears copied or altered.  ",
    contactName: "  Concern Reporter  ",
    contactEmail: "  Reporter@Example.COM  ",
    contactPhone: "  +923001234567  ",
    idempotencyNonce: IDEMPOTENCY_NONCE,
    now: plusMinutes(NOW, 1),
    accountId: "browser_must_not_select_account",
    identityId: "browser_must_not_select_identity",
    tenantId: "browser_must_not_select_tenant",
    secureFileId: "browser_must_not_select_file",
    ...overrides
  };
}

test("M1.12 concern submission derives subject authority only from the opaque public result token", async () => {
  const repository = new ConcernSpyRepository();
  const { service, publicToken } = await createPublicResultToken(repository);
  repository.rateLimitCalls.length = 0;
  repository.workerLookupCalls.length = 0;

  const result = await service.submitPublicVerificationConcern(
    validConcern(publicToken)
  );
  assert.deepEqual(result, {
    kind: "accepted",
    concernReference: `public_concern_${"R".repeat(24)}`
  });
  assert.equal(repository.concernCalls.length, 1);
  assert.deepEqual(repository.workerLookupCalls, [WORKER_ID]);
  assert.equal(repository.rateLimitCalls[0]?.action, "concern");
  assert.equal(repository.rateLimitCalls[0]?.bucketKey, REQUEST_FINGERPRINT);

  const persistedInput = repository.concernCalls[0];
  assert.match(persistedInput.concernId, /^public_concern_[A-Za-z0-9_-]{24}$/);
  assert.match(persistedInput.subjectReferenceHash, /^[a-f0-9]{64}$/);
  assert.match(persistedInput.idempotencyKey, /^[a-f0-9]{64}$/);
  assert.equal(persistedInput.category, "suspected_fraud");
  assert.equal(
    persistedInput.description,
    "The public verification result appears copied or altered."
  );
  assert.equal(persistedInput.contactName, "Concern Reporter");
  assert.equal(persistedInput.contactEmail, "reporter@example.com");
  assert.equal(persistedInput.contactPhone, "+923001234567");
  assert.equal(persistedInput.requestFingerprintHash, REQUEST_FINGERPRINT);

  const serialized = JSON.stringify(persistedInput);
  for (const forbidden of [
    WORKER_ID,
    "browser_must_not_select_account",
    "browser_must_not_select_identity",
    "browser_must_not_select_tenant",
    "browser_must_not_select_file"
  ]) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
});

test("M1.12 concern validation is bounded and fails before durable intake", async () => {
  const repository = new ConcernSpyRepository();
  const { service, publicToken } = await createPublicResultToken(repository);
  repository.concernCalls.length = 0;

  const invalidCases = [
    validConcern(publicToken, { category: "custom_browser_category" }),
    validConcern(publicToken, { description: "short" }),
    validConcern(publicToken, { description: "x".repeat(4001) }),
    validConcern(publicToken, { contactEmail: "not-an-email", contactPhone: "" }),
    validConcern(publicToken, { contactEmail: "", contactPhone: "" }),
    validConcern(publicToken, { idempotencyNonce: "tiny" })
  ];

  for (const input of invalidCases) {
    const result = await service.submitPublicVerificationConcern(input);
    assert.equal(result.kind, "validation_error");
  }
  assert.equal(repository.concernCalls.length, 0);

  const sanitized = await service.submitPublicVerificationConcern(
    validConcern(publicToken, {
      description: "This concern includes\u0000 hidden\n control data but remains meaningful."
    })
  );
  assert.equal(sanitized.kind, "accepted");
  assert.equal(
    repository.concernCalls.at(-1)?.description,
    "This concern includes hidden control data but remains meaningful."
  );
});

test("M1.12 tampered or expired public result authority cannot create a concern", async () => {
  const repository = new ConcernSpyRepository();
  const { service, publicToken } = await createPublicResultToken(repository);
  repository.concernCalls.length = 0;
  repository.workerLookupCalls.length = 0;
  repository.rateLimitCalls.length = 0;

  assert.deepEqual(
    await service.submitPublicVerificationConcern(
      validConcern(tamper(publicToken))
    ),
    { kind: "status", status: "not_found_or_invalid" }
  );
  assert.equal(repository.workerLookupCalls.length, 0);
  assert.equal(repository.concernCalls.length, 0);

  assert.deepEqual(
    await service.submitPublicVerificationConcern(
      validConcern(publicToken, { now: plusMinutes(NOW, 11) })
    ),
    { kind: "status", status: "not_found_or_invalid" }
  );
  assert.equal(repository.concernCalls.length, 0);
});

function environment(releaseSha) {
  return {
    appEnvironment: "test",
    databaseDriver: "pglite",
    databaseUrl: null,
    pgliteDataDir: "memory://",
    releaseSha,
    sessionSecret: "m1-12-concern-database-session-secret-with-more-than-thirty-two-characters",
    authPepper: "m1-12-concern-database-auth-pepper-with-more-than-thirty-two-characters",
    authSandboxEnabled: false,
    authSandboxAccessKey: null,
    demoAuthEnabled: false,
    demoDataEnabled: false
  };
}

test("M1.12 duplicate concern retries create one immutable concern and one centralized audit event", async () => {
  const database = await openScriptDatabase(environment("m1-12-concern-idempotency"));
  try {
    await applyMigrationsThrough(
      database,
      "m1-12-concern-idempotency",
      OWNED_MIGRATION
    );
    const repository = new PublicVerificationRepository(database);
    const subjectReferenceHash = "d".repeat(64);
    const idempotencyKey = "e".repeat(64);
    const requestFingerprintHash = "f".repeat(64);

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        repository.createConcernWithAudit({
          concernId: `public_concern_${String(index).padStart(24, "A")}`,
          subjectReferenceHash,
          category: "suspected_fraud",
          description: "The public verification result appears copied or altered.",
          contactName: "Concern Reporter",
          contactEmail: "reporter@example.com",
          contactPhone: null,
          idempotencyKey,
          requestFingerprintHash
        })
      )
    );

    assert.equal(new Set(results.map((result) => result.concernId)).size, 1);
    assert.equal(results.filter((result) => result.created).length, 1);

    const concerns = await database.query(
      `SELECT concern_id, subject_reference_hash, category, description,
              contact_name, contact_email, contact_phone,
              intake_status, idempotency_key
         FROM public_verification_concerns
        WHERE idempotency_key=$1`,
      [idempotencyKey]
    );
    assert.equal(concerns.rows.length, 1);
    assert.equal(concerns.rows[0].subject_reference_hash, subjectReferenceHash);
    assert.equal(concerns.rows[0].intake_status, "received");

    const audits = await database.query(
      `SELECT actor_account_id, actor_role, actor_tenant_id, actor_membership_id,
              action_key, outcome, target_type, target_reference,
              request_fingerprint_hash, metadata
         FROM platform_audit_events
        WHERE action_key='public_verification.concern.received'`,
      []
    );
    assert.equal(audits.rows.length, 1);
    assert.equal(audits.rows[0].actor_account_id, null);
    assert.equal(audits.rows[0].actor_role, null);
    assert.equal(audits.rows[0].actor_tenant_id, null);
    assert.equal(audits.rows[0].actor_membership_id, null);
    assert.equal(audits.rows[0].outcome, "succeeded");
    assert.equal(audits.rows[0].target_type, "resource");
    assert.equal(audits.rows[0].target_reference, concerns.rows[0].concern_id);
    assert.equal(audits.rows[0].request_fingerprint_hash, requestFingerprintHash);

    const metadata = typeof audits.rows[0].metadata === "string"
      ? JSON.parse(audits.rows[0].metadata)
      : audits.rows[0].metadata;
    assert.deepEqual(metadata, {
      category: "suspected_fraud",
      systemComponent: "public-verification-intake"
    });
    const auditSerialized = JSON.stringify(metadata);
    for (const privateValue of [
      "reporter@example.com",
      "Concern Reporter",
      subjectReferenceHash,
      "The public verification result appears copied or altered."
    ]) {
      assert.ok(!auditSerialized.includes(privateValue), privateValue);
    }
  } finally {
    await database.close();
  }
});