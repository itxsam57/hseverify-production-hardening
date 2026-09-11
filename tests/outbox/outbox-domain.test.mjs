import assert from "node:assert/strict";
import test from "node:test";

const audit = await import(
  "../../.outbox-test-dist/audit/audit-domain.js"
);
const outbox = await import(
  "../../.outbox-test-dist/outbox/outbox-domain.js"
);
const transactionDomain = await import(
  "../../.outbox-test-dist/outbox/outbox-transaction-domain.js"
);

function workerPrincipal() {
  return {
    sessionId: "session_outbox_worker",
    accountId: "account_outbox_worker",
    activeRole: "worker",
    accountStatus: "active",
    email: "worker@example.com",
    displayName: "Worker",
    createdAt: "2026-08-06T00:00:00.000Z",
    lastSeenAt: "2026-08-06T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    tenantMembership: null
  };
}

test("outbox vocabulary is explicit, fixed and wildcard-free", () => {
  assert.deepEqual(outbox.OUTBOX_JOB_TYPES, [
    "platform.foundation.noop",
    "notification.portal.foundation",
    "email.delivery.foundation",
    "secure_file.scan",
    "worker_identity.automated_checks"
  ]);
  assert.deepEqual(outbox.OUTBOX_JOB_STATUSES, [
    "pending",
    "leased",
    "retry_wait",
    "succeeded",
    "terminal_failed"
  ]);
  assert.equal(
    new Set(outbox.OUTBOX_ATTEMPT_OUTCOMES).size,
    outbox.OUTBOX_ATTEMPT_OUTCOMES.length
  );
  for (const value of [
    ...outbox.OUTBOX_JOB_TYPES,
    ...outbox.OUTBOX_JOB_STATUSES,
    ...outbox.OUTBOX_ATTEMPT_OUTCOMES
  ]) {
    assert.doesNotMatch(value, /\*/);
  }
});

test("idempotency keys are deterministic, opaque and type-scoped", () => {
  const first = outbox.deriveOutboxIdempotencyKey(
    "platform.foundation.noop",
    "resource_A",
    "account:account_A"
  );
  const repeated = outbox.deriveOutboxIdempotencyKey(
    "platform.foundation.noop",
    "resource_A",
    "account:account_A"
  );
  const different = outbox.deriveOutboxIdempotencyKey(
    "platform.foundation.noop",
    "resource_B",
    "account:account_A"
  );
  const otherScope = outbox.deriveOutboxIdempotencyKey(
    "platform.foundation.noop",
    "resource_A",
    "account:account_B"
  );
  const otherType = outbox.deriveOutboxIdempotencyKey(
    "notification.portal.foundation",
    "resource_A",
    "account:account_A"
  );
  const emailType = outbox.deriveOutboxIdempotencyKey(
    "email.delivery.foundation",
    "resource_A",
    "account:account_A"
  );
  const scanType = outbox.deriveOutboxIdempotencyKey(
    "secure_file.scan",
    "resource_A",
    "account:account_A"
  );
  const identityCheckType = outbox.deriveOutboxIdempotencyKey(
    "worker_identity.automated_checks",
    "resource_A",
    "account:account_A"
  );
  assert.equal(first, repeated);
  assert.notEqual(first, different);
  assert.notEqual(first, otherScope);
  assert.notEqual(first, otherType);
  assert.notEqual(first, emailType);
  assert.notEqual(first, scanType);
  assert.notEqual(first, identityCheckType);
  assert.notEqual(otherType, emailType);
  assert.notEqual(emailType, scanType);
  assert.notEqual(otherType, scanType);
  assert.notEqual(identityCheckType, scanType);
  assert.notEqual(identityCheckType, emailType);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.match(scanType, /^[a-f0-9]{64}$/);
  assert.match(identityCheckType, /^[a-f0-9]{64}$/);
  assert.equal(first.includes("resource_A"), false);
  assert.equal(scanType.includes("resource_A"), false);
  assert.equal(identityCheckType.includes("resource_A"), false);
  assert.throws(
    () => outbox.deriveOutboxIdempotencyKey(
      "unknown",
      "resource_A",
      "account:account_A"
    ),
    outbox.OutboxContractError
  );
});

test("fixed payload schemas reject secrets, personal data and arbitrary fields", () => {
  const fileRef = `secure_file_${"S".repeat(24)}`;
  const identityRef = `worker_identity_${"I".repeat(24)}`;
  const versionRef = `identity_version_${"V".repeat(24)}`;
  assert.deepEqual(
    outbox.normalizeOutboxPayload("platform.foundation.noop", {
      probeRef: "probe_A"
    }),
    { probeRef: "probe_A" }
  );
  assert.deepEqual(
    outbox.normalizeOutboxPayload("notification.portal.foundation", {
      fixtureRef: "owner-test"
    }),
    { fixtureRef: "owner-test" }
  );
  assert.deepEqual(
    outbox.normalizeOutboxPayload("email.delivery.foundation", {
      fixtureRef: "email.foundation.success.A"
    }),
    { fixtureRef: "email.foundation.success.A" }
  );
  assert.deepEqual(
    outbox.normalizeOutboxPayload("secure_file.scan", {
      fileRef,
      generation: 1
    }),
    { fileRef, generation: 1 }
  );
  assert.deepEqual(
    outbox.normalizeOutboxPayload("worker_identity.automated_checks", {
      identityRef,
      versionRef
    }),
    { identityRef, versionRef }
  );

  for (const [jobType, payload] of [
    ["platform.foundation.noop", { probeRef: "probe_A", token: "secret" }],
    ["platform.foundation.noop", { probeRef: "probe_A", email: "person@example.com" }],
    ["platform.foundation.noop", { probeRef: "probe_A", documentBody: "private" }],
    ["platform.foundation.noop", { probeRef: "<script>" }],
    ["platform.foundation.noop", { arbitrary: "value" }],
    ["notification.portal.foundation", { fixtureRef: "owner-test", token: "secret" }],
    ["notification.portal.foundation", { fixtureRef: "<script>" }],
    ["notification.portal.foundation", { arbitrary: "value" }],
    ["email.delivery.foundation", { fixtureRef: "owner-test", token: "secret" }],
    ["email.delivery.foundation", { fixtureRef: "owner-test", email: "person@example.com" }],
    ["email.delivery.foundation", { fixtureRef: "<script>" }],
    ["email.delivery.foundation", { arbitrary: "value" }],
    ["secure_file.scan", { fileRef, generation: 1, provider: "browser-selected" }],
    ["secure_file.scan", { fileRef, generation: 1, objectKey: "secure-files/browser" }],
    ["secure_file.scan", { fileRef, generation: 1, contentSha256: "a".repeat(64) }],
    ["secure_file.scan", { fileRef, generation: 0 }],
    ["secure_file.scan", { fileRef: "secure_file_short", generation: 1 }],
    ["worker_identity.automated_checks", { identityRef, versionRef, token: "secret" }],
    ["worker_identity.automated_checks", { identityRef, versionRef, documentNumber: "P123" }],
    ["worker_identity.automated_checks", { identityRef, versionRef, objectKey: "private/object" }],
    ["worker_identity.automated_checks", { identityRef: "worker_identity_short", versionRef }],
    ["worker_identity.automated_checks", { identityRef, versionRef: "identity_version_short" }],
    ["worker_identity.automated_checks", { identityRef }],
    ["platform.foundation.noop", ["not", "an", "object"]]
  ]) {
    assert.throws(
      () => outbox.normalizeOutboxPayload(jobType, payload),
      outbox.OutboxContractError
    );
  }
});

test("workers and leases are opaque server-created capabilities", () => {
  const worker = outbox.createTrustedOutboxWorker();
  assert.match(worker.workerId, /^outbox_worker_[A-Za-z0-9_-]{24}$/);
  assert.equal(outbox.assertTrustedOutboxWorker(worker), worker);

  assert.throws(
    () => outbox.assertTrustedOutboxWorker({
      workerId: "outbox_worker_forged",
      component: "outbox-worker"
    }),
    outbox.OutboxContractError
  );

  const lease = outbox.createTrustedOutboxLease({
    jobId: `job_${"A".repeat(24)}`,
    attemptId: `attempt_${"B".repeat(24)}`,
    attemptNumber: 1,
    workerId: worker.workerId,
    leaseId: `lease_${"C".repeat(24)}`,
    leaseExpiresAt: "2099-01-01T00:00:00.000Z"
  });
  assert.equal(outbox.assertTrustedOutboxLease(lease), lease);
  assert.throws(
    () => outbox.assertTrustedOutboxLease({
      ...lease,
      leaseId: `lease_${"D".repeat(24)}`
    }),
    outbox.StaleOutboxLeaseError
  );
});

test("retry policy is bounded and deterministic", () => {
  assert.deepEqual(outbox.OUTBOX_RETRY_DELAYS_SECONDS, [5, 30, 120, 600]);
  assert.equal(outbox.retryDelaySeconds(1), 5);
  assert.equal(outbox.retryDelaySeconds(4), 600);
  assert.throws(() => outbox.retryDelaySeconds(0));
  assert.throws(() => outbox.retryDelaySeconds(5));
  assert.equal(outbox.OUTBOX_MAX_ATTEMPTS, 5);
  assert.equal(outbox.OUTBOX_LEASE_SECONDS, 60);
});

test("system lifecycle audit authority is fixed and not forgeable", () => {
  const actor = audit.bindTrustedSystemAuditActor("outbox-worker", {
    tenantId: "tenant_AAAAAAAAAAAAAAAAAAAAAAAA",
    membershipId: "membership_AAAAAAAAAAAAAAAAAAAAAAAA"
  });
  assert.equal(actor.kind, "system");
  assert.equal(actor.accountId, null);
  assert.equal(actor.tenantId, "tenant_AAAAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(audit.assertTrustedAuditActor(actor), actor);
  assert.throws(
    () => audit.assertTrustedAuditActor({ ...actor }),
    audit.AuditContractError
  );
  assert.throws(
    () => audit.assertTrustedAuditActor({
      kind: "system",
      accountId: null,
      sessionId: null,
      activeRole: null,
      tenantId: null,
      membershipId: null,
      systemComponent: "outbox-worker"
    }),
    audit.AuditContractError
  );
  for (const action of [
    "outbox.job.enqueued",
    "outbox.job.claimed",
    "outbox.job.lease_reclaimed",
    "outbox.job.succeeded",
    "outbox.job.retry_scheduled",
    "outbox.job.terminal_failed"
  ]) {
    assert.equal(audit.isAuditAction(action), true);
  }
  assert.equal(audit.isAuditTargetType("job"), true);
});

test("required outbox transaction refuses accepted state without durable work", async () => {
  const committed = [];
  const actor = audit.bindTrustedAuditActor(workerPrincipal());
  const executor = {
    async transaction(operation) {
      const staged = [];
      const result = await operation(staged);
      committed.push(...staged);
      return result;
    }
  };

  await assert.rejects(
    transactionDomain.runRequiredOutboxTransactionCore({
      executor,
      actor,
      enqueue: async () => {
        throw new Error("must-not-run");
      },
      operation: async ({ transaction }) => {
        transaction.push("accepted-state");
        return "accepted";
      }
    }),
    outbox.RequiredOutboxMissingError
  );
  assert.deepEqual(committed, []);
});

test("required outbox transaction commits state and durable work together", async () => {
  const committed = [];
  const actor = audit.bindTrustedAuditActor(workerPrincipal());
  const executor = {
    async transaction(operation) {
      const staged = [];
      const result = await operation(staged);
      committed.push(...staged);
      return result;
    }
  };
  const jobRecord = { jobId: `job_${"Q".repeat(24)}` };

  const result = await transactionDomain.runRequiredOutboxTransactionCore({
    executor,
    actor,
    enqueue: async (transaction) => {
      transaction.push("durable-outbox");
      return jobRecord;
    },
    operation: async ({ transaction, enqueueRequired }) => {
      transaction.push("accepted-state");
      await enqueueRequired({
        jobType: "platform.foundation.noop",
        businessKey: "state_Q",
        payload: { probeRef: "probe_Q" }
      });
      return "accepted";
    }
  });

  assert.equal(result, "accepted");
  assert.deepEqual(committed, ["accepted-state", "durable-outbox"]);
});
