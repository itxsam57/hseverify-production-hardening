import assert from "node:assert/strict";
import test from "node:test";

const notification = await import(
  "../../.notification-test-dist/notifications/notification-domain.js"
);

function job(overrides = {}) {
  return {
    sequence: 1,
    jobId: `job_${"A".repeat(24)}`,
    jobType: "notification.portal.foundation",
    schemaVersion: 1,
    idempotencyKey: "a".repeat(64),
    payload: { fixtureRef: "owner-test" },
    enqueuedByAccountId: "account_A",
    enqueuedByRole: "worker",
    tenantId: null,
    membershipId: null,
    status: "pending",
    attemptCount: 0,
    maxAttempts: 5,
    nextAttemptAt: "2099-01-01T00:00:00.000Z",
    leaseId: null,
    workerId: null,
    leaseExpiresAt: null,
    succeededAt: null,
    terminalFailedAt: null,
    lastErrorCode: null,
    lastErrorSummary: null,
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
    ...overrides
  };
}

test("notification vocabulary is fixed and wildcard-free", () => {
  assert.deepEqual(notification.NOTIFICATION_TYPES, ["platform.foundation.ready"]);
  assert.deepEqual(notification.NOTIFICATION_TARGETS, ["portal.dashboard"]);
  for (const value of [
    ...notification.NOTIFICATION_TYPES,
    ...notification.NOTIFICATION_TARGETS
  ]) {
    assert.doesNotMatch(value, /\*/);
  }
});

test("fixed notification metadata rejects arbitrary and sensitive fields", () => {
  assert.deepEqual(
    notification.normalizeNotificationMetadata("platform.foundation.ready", {
      fixtureRef: "owner-test"
    }),
    { fixtureRef: "owner-test" }
  );
  for (const value of [
    { fixtureRef: "owner-test", token: "secret" },
    { fixtureRef: "owner-test", email: "person@example.com" },
    { arbitrary: "value" },
    { fixtureRef: "<script>" },
    ["owner-test"]
  ]) {
    assert.throws(
      () => notification.normalizeNotificationMetadata(
        "platform.foundation.ready",
        value
      ),
      notification.NotificationContractError
    );
  }
});

test("projection keys are deterministic and recipient-scope separated", () => {
  const base = {
    jobId: `job_${"B".repeat(24)}`,
    notificationType: "platform.foundation.ready",
    recipientAccountId: "account_A",
    recipientRole: "worker",
    tenantId: null
  };
  const first = notification.deriveNotificationProjectionKey(base);
  const repeated = notification.deriveNotificationProjectionKey(base);
  const otherAccount = notification.deriveNotificationProjectionKey({
    ...base,
    recipientAccountId: "account_B"
  });
  const otherRole = notification.deriveNotificationProjectionKey({
    ...base,
    recipientRole: "assessor"
  });
  assert.equal(first, repeated);
  assert.notEqual(first, otherAccount);
  assert.notEqual(first, otherRole);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("deep links are fixed to the current portal home and never accept a URL", () => {
  const expected = {
    worker: "/worker/dashboard",
    company: "/company/dashboard",
    assessor: "/assessor/dashboard",
    verifier: "/verifier/dashboard",
    admin: "/admin/dashboard",
    root: "/root/dashboard"
  };
  for (const [role, href] of Object.entries(expected)) {
    assert.equal(
      notification.resolveNotificationHref({
        role,
        target: "portal.dashboard",
        targetReference: null
      }),
      href
    );
    assert.equal(notification.notificationListPath(role), `/${role}/notifications`);
  }
  assert.throws(
    () => notification.resolveNotificationHref({
      role: "worker",
      target: "portal.dashboard",
      targetReference: "https://example.com"
    }),
    notification.NotificationContractError
  );
});

test("only the registered outbox projection type with coherent Company scope can notify", () => {
  assert.equal(notification.assertNotificationProjectionJob(job()).jobType, "notification.portal.foundation");
  assert.throws(
    () => notification.assertNotificationProjectionJob(job({
      jobType: "platform.foundation.noop"
    })),
    notification.NotificationContractError
  );
  assert.throws(
    () => notification.assertNotificationProjectionJob(job({
      enqueuedByRole: "company",
      tenantId: null,
      membershipId: null
    })),
    notification.NotificationContractError
  );
  assert.throws(
    () => notification.assertNotificationProjectionJob(job({
      enqueuedByRole: "worker",
      tenantId: "tenant_AAAAAAAAAAAAAAAAAAAAAAAA",
      membershipId: "membership_AAAAAAAAAAAAAAAAAAAAAAAA"
    })),
    notification.NotificationContractError
  );
});

test("notification identifiers and query bounds are fail-closed", () => {
  const id = notification.createNotificationId();
  assert.match(id, /^notification_[A-Za-z0-9_-]{24}$/);
  assert.equal(notification.normalizeNotificationId(id), id);
  assert.equal(notification.normalizeNotificationId("notification_1"), null);
  assert.equal(notification.normalizeNotificationLimit(undefined), 25);
  assert.throws(() => notification.normalizeNotificationLimit(0));
  assert.throws(() => notification.normalizeNotificationLimit(101));
  assert.equal(notification.normalizeNotificationCursor(null), null);
  assert.throws(() => notification.normalizeNotificationCursor(-1));
});
