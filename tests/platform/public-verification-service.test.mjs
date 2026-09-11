import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const runtime = process.env.HSE_PUBLIC_VERIFICATION_RUNTIME_DIST;
assert.ok(runtime, "HSE_PUBLIC_VERIFICATION_RUNTIME_DIST is required");

const requestModule = await import(
  pathToFileURL(
    join(runtime, "public-verification", "public-verification-request.js")
  ).href
);
const serviceModule = await import(
  pathToFileURL(
    join(runtime, "public-verification", "public-verification-service.js")
  ).href
);

const {
  publicVerificationIdentifierBucketKey,
  publicVerificationRequestFingerprint
} = requestModule;
const { PublicVerificationService } = serviceModule;

const SECRET = "m1-12-public-service-secret-with-more-than-thirty-two-characters";
const NOW = new Date("2026-08-17T14:00:00.000Z");
const WORKER_ID = `worker_id_${"W".repeat(24)}`;
const UNKNOWN_WORKER_ID = `worker_id_${"U".repeat(24)}`;
const CREDENTIAL_ID = `credential_id_${"C".repeat(24)}`;
const REQUEST_FINGERPRINT = "a".repeat(64);

function plusMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

function tamper(value) {
  const index = Math.max(1, Math.floor(value.length / 2));
  const replacement = value[index] === "A" ? "B" : "A";
  return `${value.slice(0, index)}${replacement}${value.slice(index + 1)}`;
}

function workerSource(lifecycleStatus = "verified") {
  return {
    permanentWorkerId: WORKER_ID,
    lifecycleStatus,
    legalFirstName: "Public",
    legalLastName: "Worker",
    issuedAt: "2026-08-11T09:00:00.000Z"
  };
}

class SpyRepository {
  constructor() {
    this.rateLimitCalls = [];
    this.workerLookupCalls = [];
    this.rateLimitResponder = () => 1;
    this.workerRow = null;
  }

  async consumeRateLimit(input) {
    this.rateLimitCalls.push({ ...input });
    return this.rateLimitResponder(input, this.rateLimitCalls.length);
  }

  async findPublicWorkerByPermanentId(workerId) {
    this.workerLookupCalls.push(workerId);
    if (workerId !== WORKER_ID) return null;
    return this.workerRow;
  }
}

test("M1.12 request and identifier bucket keys are opaque, deterministic and purpose-separated", () => {
  const request = publicVerificationRequestFingerprint(
    { ipAddress: "203.0.113.7", userAgent: "Public Verification Test Browser" },
    SECRET
  );
  const requestReplay = publicVerificationRequestFingerprint(
    { ipAddress: "203.0.113.7", userAgent: "Public Verification Test Browser" },
    SECRET
  );
  const requestDifferentIp = publicVerificationRequestFingerprint(
    { ipAddress: "203.0.113.8", userAgent: "Public Verification Test Browser" },
    SECRET
  );
  const identifier = publicVerificationIdentifierBucketKey(WORKER_ID, SECRET);

  assert.match(request, /^[a-f0-9]{64}$/);
  assert.equal(requestReplay, request);
  assert.notEqual(requestDifferentIp, request);
  assert.match(identifier, /^[a-f0-9]{64}$/);
  assert.notEqual(identifier, request);
  assert.ok(!request.includes("203.0.113.7"));
  assert.ok(!request.includes("Public Verification Test Browser"));
  assert.ok(!identifier.includes(WORKER_ID));

  assert.throws(() =>
    publicVerificationRequestFingerprint(
      { ipAddress: "x".repeat(129), userAgent: null },
      SECRET
    )
  );
  assert.throws(() =>
    publicVerificationRequestFingerprint(
      { ipAddress: null, userAgent: "x".repeat(513) },
      SECRET
    )
  );
});

test("M1.12 malformed, unknown, unsupported and private lifecycle lookups converge on one neutral miss", async () => {
  const repository = new SpyRepository();
  const service = new PublicVerificationService(repository, SECRET);

  assert.deepEqual(
    await service.lookupPublicVerification({
      rawIdentifier: "not-an-id",
      requestFingerprint: REQUEST_FINGERPRINT,
      now: NOW
    }),
    { kind: "status", status: "not_found_or_invalid" }
  );
  assert.equal(repository.workerLookupCalls.length, 0);
  assert.equal(repository.rateLimitCalls.length, 1);
  assert.equal(repository.rateLimitCalls[0].action, "lookup");
  assert.equal(repository.rateLimitCalls[0].bucketKey, REQUEST_FINGERPRINT);

  repository.rateLimitCalls.length = 0;
  assert.deepEqual(
    await service.lookupPublicVerification({
      rawIdentifier: UNKNOWN_WORKER_ID,
      requestFingerprint: REQUEST_FINGERPRINT,
      now: NOW
    }),
    { kind: "status", status: "not_found_or_invalid" }
  );
  assert.deepEqual(repository.workerLookupCalls, [UNKNOWN_WORKER_ID]);
  assert.equal(repository.rateLimitCalls.length, 2);
  assert.equal(repository.rateLimitCalls[0].bucketKey, REQUEST_FINGERPRINT);
  assert.equal(
    repository.rateLimitCalls[1].bucketKey,
    publicVerificationIdentifierBucketKey(UNKNOWN_WORKER_ID, SECRET)
  );

  repository.rateLimitCalls.length = 0;
  repository.workerLookupCalls.length = 0;
  assert.deepEqual(
    await service.lookupPublicVerification({
      rawIdentifier: CREDENTIAL_ID,
      requestFingerprint: REQUEST_FINGERPRINT,
      now: NOW
    }),
    { kind: "status", status: "not_found_or_invalid" }
  );
  assert.equal(repository.workerLookupCalls.length, 0);
  assert.equal(repository.rateLimitCalls.length, 2);

  repository.rateLimitCalls.length = 0;
  repository.workerRow = workerSource("manual_review");
  assert.deepEqual(
    await service.lookupPublicVerification({
      rawIdentifier: WORKER_ID,
      requestFingerprint: REQUEST_FINGERPRINT,
      now: NOW
    }),
    { kind: "status", status: "not_found_or_invalid" }
  );
  assert.deepEqual(repository.workerLookupCalls, [WORKER_ID]);
});

test("M1.12 request and identifier abuse limits execute before identifying Worker lookup", async () => {
  const requestLimitedRepository = new SpyRepository();
  requestLimitedRepository.workerRow = workerSource();
  requestLimitedRepository.rateLimitResponder = (_input, callNumber) =>
    callNumber === 1 ? 31 : 1;
  const requestLimitedService = new PublicVerificationService(
    requestLimitedRepository,
    SECRET
  );

  assert.deepEqual(
    await requestLimitedService.lookupPublicVerification({
      rawIdentifier: WORKER_ID,
      requestFingerprint: REQUEST_FINGERPRINT,
      now: NOW
    }),
    { kind: "status", status: "temporarily_unavailable" }
  );
  assert.equal(requestLimitedRepository.workerLookupCalls.length, 0);
  assert.equal(requestLimitedRepository.rateLimitCalls.length, 1);
  assert.equal(
    requestLimitedRepository.rateLimitCalls[0].bucketKey,
    REQUEST_FINGERPRINT
  );

  const identifierLimitedRepository = new SpyRepository();
  identifierLimitedRepository.workerRow = workerSource();
  identifierLimitedRepository.rateLimitResponder = (_input, callNumber) =>
    callNumber === 2 ? 11 : 1;
  const identifierLimitedService = new PublicVerificationService(
    identifierLimitedRepository,
    SECRET
  );

  assert.deepEqual(
    await identifierLimitedService.lookupPublicVerification({
      rawIdentifier: WORKER_ID,
      requestFingerprint: REQUEST_FINGERPRINT,
      now: NOW
    }),
    { kind: "status", status: "temporarily_unavailable" }
  );
  assert.equal(identifierLimitedRepository.workerLookupCalls.length, 0);
  assert.equal(identifierLimitedRepository.rateLimitCalls.length, 2);
  assert.equal(
    identifierLimitedRepository.rateLimitCalls[1].bucketKey,
    publicVerificationIdentifierBucketKey(WORKER_ID, SECRET)
  );
});

test("M1.12 result capability re-queries live public state and never trusts stale status", async () => {
  const repository = new SpyRepository();
  repository.workerRow = workerSource("verified");
  const service = new PublicVerificationService(repository, SECRET);

  const lookup = await service.lookupPublicVerification({
    rawIdentifier: WORKER_ID,
    requestFingerprint: REQUEST_FINGERPRINT,
    now: NOW
  });
  assert.equal(lookup.kind, "redirect");
  assert.ok(!lookup.publicToken.includes(WORKER_ID));

  repository.rateLimitCalls.length = 0;
  repository.workerLookupCalls.length = 0;
  repository.workerRow = workerSource("suspended");
  const resolved = await service.resolvePublicVerificationCapability({
    publicToken: lookup.publicToken,
    requestFingerprint: REQUEST_FINGERPRINT,
    now: plusMinutes(NOW, 5)
  });
  assert.equal(resolved.kind, "projection");
  assert.equal(resolved.projection.status, "suspended");
  assert.equal(resolved.projection.publicIdentifier, WORKER_ID);
  assert.equal(resolved.projection.displayName, "Public Worker");
  assert.deepEqual(repository.workerLookupCalls, [WORKER_ID]);
  assert.equal(repository.rateLimitCalls.length, 1);
  assert.equal(repository.rateLimitCalls[0].action, "result");
  assert.equal(repository.rateLimitCalls[0].bucketKey, REQUEST_FINGERPRINT);

  const replay = await service.resolvePublicVerificationCapability({
    publicToken: lookup.publicToken,
    requestFingerprint: REQUEST_FINGERPRINT,
    now: plusMinutes(NOW, 6)
  });
  assert.equal(replay.kind, "projection");
  assert.equal(replay.projection.status, "suspended");
});

test("M1.12 tampered and expired result capabilities fail neutrally before Worker lookup", async () => {
  const repository = new SpyRepository();
  repository.workerRow = workerSource();
  const service = new PublicVerificationService(repository, SECRET);
  const lookup = await service.lookupPublicVerification({
    rawIdentifier: WORKER_ID,
    requestFingerprint: REQUEST_FINGERPRINT,
    now: NOW
  });
  assert.equal(lookup.kind, "redirect");

  repository.workerLookupCalls.length = 0;
  repository.rateLimitCalls.length = 0;
  assert.deepEqual(
    await service.resolvePublicVerificationCapability({
      publicToken: tamper(lookup.publicToken),
      requestFingerprint: REQUEST_FINGERPRINT,
      now: plusMinutes(NOW, 1)
    }),
    { kind: "status", status: "not_found_or_invalid" }
  );
  assert.equal(repository.workerLookupCalls.length, 0);
  assert.equal(repository.rateLimitCalls.length, 1);

  repository.workerLookupCalls.length = 0;
  repository.rateLimitCalls.length = 0;
  assert.deepEqual(
    await service.resolvePublicVerificationCapability({
      publicToken: lookup.publicToken,
      requestFingerprint: REQUEST_FINGERPRINT,
      now: plusMinutes(NOW, 11)
    }),
    { kind: "status", status: "not_found_or_invalid" }
  );
  assert.equal(repository.workerLookupCalls.length, 0);
  assert.equal(repository.rateLimitCalls.length, 1);
});