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
    "notification.account.security",
    "notification.interview.scheduled",
    "notification.interview.reminder",
    "email.delivery.foundation",
    "email.interview.scheduled",
    "email.interview.reminder",
    "secure_file.scan",
    "worker_identity.automated_checks",
    "assessment.attempt.expiry",
    "authentication.challenge.delivery",
    "report.generation",
    "notification.assessment.funding",
    "email.report.ready",
    "notification.assurance.event",
    "email.assurance.event"
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

test("security jobs carry only a source event reference", () => {
  assert.deepEqual(outbox.normalizeOutboxPayload("notification.account.security", {eventRef:"event_security_A"}), {eventRef:"event_security_A"});
  for (const value of [{eventRef:"event_security_A",token:"secret"},{eventRef:"event_security_A",email:"person@example.test"},{eventRef:"<script>"},{fixtureRef:"owner-test"}]) assert.throws(() => outbox.normalizeOutboxPayload("notification.account.security",value),outbox.OutboxContractError);
});

 test("Assessment expiry payload accepts only immutable attempt clock references", () => {
  const payload={attemptRef:`assessment_attempt_${"A".repeat(24)}`,phaseIndex:0,deadlineAt:"2026-10-05T00:00:00.000Z"};
  assert.deepEqual(outbox.normalizeOutboxPayload("assessment.attempt.expiry",payload),payload);
  for(const invalid of [{...payload,phaseIndex:-1},{...payload,deadlineAt:"tomorrow"},{...payload,answer:"secret"},{...payload,attemptRef:"other"}]) {
    assert.throws(()=>outbox.normalizeOutboxPayload("assessment.attempt.expiry",invalid),outbox.OutboxContractError);
  }
});


test("Authentication challenge delivery accepts only an opaque dispatch reference", () => {
  const dispatchRef = `delivery_${"D".repeat(24)}`;
  assert.deepEqual(
    outbox.normalizeOutboxPayload("authentication.challenge.delivery", { dispatchRef }),
    { dispatchRef }
  );
  for (const payload of [
    { dispatchRef, code: "123456" },
    { dispatchRef, destination: "worker@example.test" },
    { dispatchRef, provider: "custom" },
    { dispatchRef: "arbitrary-reference" },
    {}
  ]) {
    assert.throws(
      () => outbox.normalizeOutboxPayload("authentication.challenge.delivery", payload),
      outbox.OutboxContractError
    );
  }
});

test("Interview scheduling and reminder work have sealed recipient-bound event contracts",()=>{
 const payload={eventRef:"audit_abc",recipientRef:"account_abc",recipientRole:"worker",membershipRef:null};
 for(const jobType of ["notification.interview.scheduled","email.interview.scheduled","notification.interview.reminder","email.interview.reminder"]){
  assert.deepEqual(outbox.normalizeOutboxPayload(jobType,payload),payload);
  assert.deepEqual(outbox.normalizeOutboxPayload(jobType,{...payload,recipientRole:"company",membershipRef:"membership_abc"}),{...payload,recipientRole:"company",membershipRef:"membership_abc"});
  for(const value of [
   {...payload,href:"https://example.test"},{...payload,recipientRole:"admin"},
   {...payload,recipientRole:{toString:()=>"worker"}},{...payload,recipientRole:"company"},
   {...payload,membershipRef:"membership_other"},{...payload,eventRef:"<script>"},{...payload,recipientRef:""}
  ])assert.throws(()=>outbox.normalizeOutboxPayload(jobType,value),outbox.OutboxContractError);
 }
});

test("Report generation accepts only the bounded server report reference", () => {
  for (const reportRef of ["report_abc", "report_" + "A".repeat(80)]) {
    assert.deepEqual(outbox.normalizeOutboxPayload("report.generation", { reportRef }), { reportRef });
  }
  for (const payload of [
    {}, { reportRef: "report_ab" }, { reportRef: "report_" + "A".repeat(81) },
    { reportRef: "report_abc", tenantId: "tenant_other" },
    { reportRef: "report_abc", objectKey: "private/other" },
    { reportRef: "report_abc", href: "https://example.test" },
    { reportRef: "report_abc", format: "pdf" },
    { reportRef: "report_../private" }, { reportRef: 42 },
    Object.assign(Object.create({ tenantId: "tenant_other" }), { reportRef: "report_abc" })
  ]) {
    assert.throws(() => outbox.normalizeOutboxPayload("report.generation", payload), outbox.OutboxContractError);
  }
});

test("Funding notifications accept only an immutable application-event reference", () => {
  const eventRef = "assessment_application_event_" + "F".repeat(24);
  assert.deepEqual(outbox.normalizeOutboxPayload("notification.assessment.funding", { eventRef }), { eventRef });
  for (const payload of [
    {}, { eventRef: "event_other" }, { eventRef: "assessment_application_event_" + "F".repeat(23) },
    { eventRef, recipientRef: "account_other" }, { eventRef, membershipRef: "membership_other" },
    { eventRef, message: "Approve immediately" }, { eventRef, href: "/admin" },
    { eventRef, tenantId: "tenant_other" }, { eventRef: ["not", "a", "reference"] },
    Object.assign(Object.create({ tenantId: "tenant_other" }), { eventRef })
  ]) {
    assert.throws(() => outbox.normalizeOutboxPayload("notification.assessment.funding", payload), outbox.OutboxContractError);
  }
});

test("report email jobs carry only a bound opaque delivery reference", () => {
  const deliveryRef = "report_email_" + "R".repeat(24);
  assert.deepEqual(outbox.normalizeOutboxPayload("email.report.ready", { deliveryRef }), { deliveryRef });
  for (const payload of [
    { deliveryRef, email: "other@example.com" },
    { deliveryRef, artifactKey: "private/other" },
    { deliveryRef, recipientRef: "account_other" },
    { deliveryRef: "report_email_short" },
    { deliveryRef: "email_delivery_" + "R".repeat(24) },
    { reportRef: "report_worker_" + "R".repeat(24) },
    Object.assign(Object.create({ deliveryRef }), {}),
  ]) assert.throws(() => outbox.normalizeOutboxPayload("email.report.ready", payload), outbox.OutboxContractError);
});

const assuranceEvents = [
  ["evidence.submitted", "audit:audit_event_A"],
  ["evidence.reviewed", "review:evidence_review_decision_A"],
  ["evidence.additional.requested", "review:evidence_review_decision_B"],
  ["decision.recorded", "case:case_timeline_event_A"],
  ["credential.issued", "issuance:credential_A:1"],
  ["appeal.submitted", "appeal:appeal_A:1"],
  ["appeal.updated", "appeal:appeal_A:2"],
  ["appeal.evidence.submitted", "appeal_followup:audit_evidence_A"],
  ["appeal.interview.submitted", "appeal_followup:audit_interview_A"],
];

test("assurance notice jobs have a fixed source-derived event schema", () => {
  for (const [eventType, eventRef] of assuranceEvents) {
    assert.deepEqual(outbox.normalizeOutboxPayload("notification.assurance.event", {eventType,eventRef}), {eventType,eventRef});
  }
  for (const payload of [
    {eventType:"evidence.submitted",eventRef:"review:decision_A"},
    {eventType:"credential.issued",eventRef:"issuance:credential_A:0"},
    {eventType:"credential.issued",eventRef:"issuance:credential_A:01"},
    {eventType:"credential.issued",eventRef:"issuance:credential_A:9007199254740992"},
    {eventType:"appeal.updated",eventRef:"appeal:appeal_A"},
    {eventType:"appeal.evidence.submitted",eventRef:"appeal:appeal_A:2"},
    {eventType:"appeal.interview.submitted",eventRef:"appeal_followup:audit_A:2"},
    {eventType:"evidence.submitted",eventRef:"audit:../other"},
    {eventType:"assessment.funding.approved",eventRef:"funding:event_A"},
    {eventType:"evidence.submitted",eventRef:"audit:event_A",recipientRef:"account_other"},
    {eventType:"evidence.submitted",eventRef:"audit:"+"A".repeat(161)},
  ]) assert.throws(() => outbox.normalizeOutboxPayload("notification.assurance.event",payload),outbox.OutboxContractError);
});

test("assurance emails seal opaque recipient role and membership with the source event", () => {
  const recipient = {recipientRef:"account_worker_A",recipientRole:"worker",membershipRef:null};
  for (const [eventType,eventRef] of [...assuranceEvents,["assessment.funding.requested","funding:application_event_A"],["assessment.funding.approved","funding:application_event_B"]]) {
    const payload={eventType,eventRef,...recipient};
    assert.deepEqual(outbox.normalizeOutboxPayload("email.assurance.event",payload),payload);
  }
  const company={eventType:"decision.recorded",eventRef:"case:event_A",recipientRef:"account_company_A",recipientRole:"company",membershipRef:"membership_A"};
  assert.deepEqual(outbox.normalizeOutboxPayload("email.assurance.event",company),company);
  for (const payload of [
    {...company,membershipRef:null},
    {...company,recipientRole:"worker"},
    {...company,recipientRole:"*"},
    {...company,recipientRef:"https://other.example/account"},
    {...company,membershipRef:"https://other.example/member"},
    {...company,email:"other@example.com"},
    {...company,body:"private case details"},
    {...company,eventRef:"case:event_A:1"},
    {...company,membershipRef:undefined},
  ]) assert.throws(() => outbox.normalizeOutboxPayload("email.assurance.event",payload),outbox.OutboxContractError);
});
