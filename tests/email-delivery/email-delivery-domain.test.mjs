import assert from "node:assert/strict";
import test from "node:test";

const email = await import(
  "../../.email-delivery-test-dist/email-delivery/email-delivery-domain.js"
);
const outbox = await import(
  "../../.email-delivery-test-dist/outbox/outbox-domain.js"
);

test("email delivery vocabulary is fixed and wildcard-free", () => {
  assert.deepEqual(email.EMAIL_DELIVERY_TYPES, ["platform.foundation.email"]);
  assert.deepEqual(email.EMAIL_DELIVERY_STATUSES, [
    "queued",
    "processing",
    "retry_wait",
    "delivered",
    "terminal_failed"
  ]);
  assert.deepEqual(email.EMAIL_ADAPTER_KEYS, ["local_test"]);
  assert.equal(new Set(email.EMAIL_ATTEMPT_OUTCOMES).size, email.EMAIL_ATTEMPT_OUTCOMES.length);
  for (const value of [
    ...email.EMAIL_DELIVERY_TYPES,
    ...email.EMAIL_DELIVERY_STATUSES,
    ...email.EMAIL_ATTEMPT_OUTCOMES,
    ...email.EMAIL_ADAPTER_KEYS
  ]) {
    assert.doesNotMatch(value, /\*/);
  }
});

test("trusted recipient addresses are fingerprinted instead of persisted by the domain", () => {
  const first = email.hashEmailRecipientAddress("Worker@Example.com");
  const repeated = email.hashEmailRecipientAddress(" worker@example.com ");
  const other = email.hashEmailRecipientAddress("other@example.com");
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, repeated);
  assert.notEqual(first, other);
  assert.equal(first.includes("worker@example.com"), false);
  assert.throws(
    () => email.hashEmailRecipientAddress("not-an-email"),
    email.EmailDeliveryContractError
  );
});

test("delivery and dispatch keys are deterministic opaque boundaries", () => {
  const job = {
    sequence: 1,
    jobId: `job_${"A".repeat(24)}`,
    jobType: "email.delivery.foundation",
    schemaVersion: 1,
    idempotencyKey: "b".repeat(64),
    payload: { fixtureRef: "email.foundation.success.A" },
    enqueuedByAccountId: "account_A",
    enqueuedByRole: "worker",
    tenantId: null,
    membershipId: null,
    status: "pending",
    attemptCount: 0,
    maxAttempts: 5,
    nextAttemptAt: "2026-08-09T00:00:00.000Z",
    leaseId: null,
    workerId: null,
    leaseExpiresAt: null,
    succeededAt: null,
    terminalFailedAt: null,
    lastErrorCode: null,
    lastErrorSummary: null,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z"
  };
  const typedJob = email.assertEmailDeliveryJob(job);
  const deliveryKey = email.deriveEmailDeliveryKey(typedJob);
  assert.match(deliveryKey, /^[a-f0-9]{64}$/);
  assert.equal(deliveryKey, email.deriveEmailDeliveryKey(typedJob));

  const worker = outbox.createTrustedOutboxWorker();
  const lease = outbox.createTrustedOutboxLease({
    jobId: job.jobId,
    attemptId: `attempt_${"B".repeat(24)}`,
    attemptNumber: 1,
    workerId: worker.workerId,
    leaseId: `lease_${"C".repeat(24)}`,
    leaseExpiresAt: "2099-01-01T00:00:00.000Z"
  });
  const dispatchKey = email.deriveEmailDispatchKey(
    `email_delivery_${"D".repeat(24)}`,
    lease
  );
  assert.match(dispatchKey, /^[a-f0-9]{64}$/);
  assert.equal(
    dispatchKey,
    email.deriveEmailDispatchKey(`email_delivery_${"D".repeat(24)}`, lease)
  );
});

test("provider results are bounded and credentials cannot enter persisted summaries", () => {
  assert.deepEqual(
    email.normalizeEmailAdapterResult({
      kind: "delivered",
      code: "local_accepted",
      summary: "The local adapter accepted the delivery.",
      providerReference: "local:reference-A"
    }),
    {
      kind: "delivered",
      code: "local_accepted",
      summary: "The local adapter accepted the delivery.",
      providerReference: "local:reference-A"
    }
  );
  assert.throws(
    () => email.normalizeEmailAdapterResult({
      kind: "terminal",
      code: "bad",
      summary: "provider token leaked here"
    }),
    email.EmailDeliveryContractError
  );
  const fingerprint = email.hashProviderReference("local:reference-A");
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(fingerprint.includes("reference-A"), false);
});

test("retry terminal boundary is exactly the inherited fifth outbox attempt", () => {
  assert.equal(email.isFinalEmailAttempt(1), false);
  assert.equal(email.isFinalEmailAttempt(4), false);
  assert.equal(email.isFinalEmailAttempt(5), true);
  assert.throws(() => email.isFinalEmailAttempt(0));
  assert.throws(() => email.isFinalEmailAttempt(6));
});

test("email outbox payload remains fixed and contains no address or provider authority", () => {
  assert.deepEqual(
    outbox.normalizeOutboxPayload("email.delivery.foundation", {
      fixtureRef: "email.foundation.success.A"
    }),
    { fixtureRef: "email.foundation.success.A" }
  );
  for (const payload of [
    { fixtureRef: "email.foundation.success.A", email: "worker@example.com" },
    { fixtureRef: "email.foundation.success.A", provider: "smtp" },
    { fixtureRef: "email.foundation.success.A", token: "secret" },
    { recipientAddress: "worker@example.com" }
  ]) {
    assert.throws(
      () => outbox.normalizeOutboxPayload("email.delivery.foundation", payload),
      outbox.OutboxContractError
    );
  }
});
