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
  assert.deepEqual(notification.NOTIFICATION_TYPES, ["platform.foundation.ready", "interview.scheduled", "interview.reminder", "assessment.funding.requested", "assessment.funding.approved", "account.password.changed", "account.password.reset", "account.mfa.replaced", "account.recovery_codes.rotated", "evidence.submitted", "evidence.reviewed", "evidence.additional.requested", "evidence.unable", "evidence.escalated", "evidence.returned", "assessment.review.conflict","evidence.second_review.requested","assessment.review.assigned", "integrity.escalated", "integrity.returned", "interview.recommended", "decision.recorded", "credential.issued", "appeal.submitted", "appeal.updated"]);
  assert.deepEqual(notification.NOTIFICATION_TARGETS, ["portal.dashboard", "account.security", "interview.record", "company.assurance.case", "company.billing.funding", "worker.assessment.case", "worker.evidence.record", "worker.identity.record", "worker.observation.record", "verifier.review.task", "admin.review.escalation", "worker.assurance.case", "worker.credential.record", "appeal.record", "admin.interview.case", "admin.integrity.review", "verifier.integrity.review", "admin.scoring.assignment", "admin.review.quality"]);
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

test("security metadata accepts only the immutable event reference and links all roles to account security", () => {
  for (const type of notification.NOTIFICATION_TYPES.filter(type => type.startsWith("account."))) {
    assert.deepEqual(notification.normalizeNotificationMetadata(type, {eventRef:"event_security_A"}), {eventRef:"event_security_A"});
    for (const metadata of [{eventRef:"event_security_A",token:"secret"},{eventRef:"event_security_A",email:"person@example.test"},{eventRef:"<script>"},{fixtureRef:"owner-test"}]) assert.throws(() => notification.normalizeNotificationMetadata(type, metadata));
  }
  for (const role of ["worker","company","assessor","verifier","admin","root"]) assert.equal(notification.resolveNotificationHref({role,target:"account.security",targetReference:null}), "/account/security");
  assert.throws(() => notification.resolveNotificationHref({role:"worker",target:"account.security",targetReference:"https://example.test"}));
});

test("Scheduled notices accept only fixed recipient-role record references",()=>{
 for(const role of ["worker","assessor"]){
  assert.equal(notification.resolveNotificationHref({role,target:"interview.record",targetReference:"interview_request_abc"}),"/"+role+"/interviews/interview_request_abc");
 }
 assert.equal(notification.resolveNotificationHref({role:"company",target:"company.assurance.case",targetReference:"assurance_order_abc#assurance_case_abc"}),"/company/assurance-orders/assurance_order_abc#assurance_case_abc");
 for(const input of [
  {role:"admin",target:"interview.record",targetReference:"interview_request_abc"},
  {role:"worker",target:"company.assurance.case",targetReference:"order#case"},
  {role:"company",target:"company.assurance.case",targetReference:"order#case#third"},
  ...["https://example.test","../other","//example.test","record?account=other","record%2fother",""].map(targetReference=>({role:"worker",target:"interview.record",targetReference}))
 ])assert.throws(()=>notification.resolveNotificationHref(input),notification.NotificationContractError);
 assert.deepEqual(notification.normalizeNotificationMetadata("interview.scheduled",{eventRef:"audit_abc"}),{eventRef:"audit_abc"});
 assert.throws(()=>notification.normalizeNotificationMetadata("interview.scheduled",{eventRef:"audit_abc",href:"https://example.test"}));
});


test("Funding notices permit only exact role-owned opaque funding or case targets", () => {
  for (const [role, target, prefix, path] of [
    ["company", "company.billing.funding", "funding_", "/company/billing#"],
    ["worker", "worker.assessment.case", "assurance_case_", "/worker/available-assessments#"]
  ]) {
    const targetReference = prefix + "A".repeat(24);
    assert.equal(notification.resolveNotificationHref({ role, target, targetReference }), path + targetReference);
    for (const otherRole of ["worker", "company", "assessor", "verifier", "admin", "root"].filter(value => value !== role)) {
      assert.throws(() => notification.resolveNotificationHref({role: otherRole, target, targetReference}), notification.NotificationContractError);
    }
    for (const invalid of [null, "", "https://example.test", "../other", prefix + "A".repeat(23), prefix + "A".repeat(25), targetReference + "#other"]) {
      assert.throws(() => notification.resolveNotificationHref({role, target, targetReference: invalid}), notification.NotificationContractError);
    }
  }
  for (const type of ["assessment.funding.requested", "assessment.funding.approved"]) {
    assert.deepEqual(notification.normalizeNotificationMetadata(type, {eventRef: "assessment_application_event_" + "A".repeat(24)}),
      {eventRef: "assessment_application_event_" + "A".repeat(24)});
    assert.throws(() => notification.normalizeNotificationMetadata(type, {eventRef: "assessment_application_event_" + "A".repeat(24), href: "/company/billing"}));
  }
});


test("Assurance record metadata and role links remain closed to arbitrary content, URLs and foreign portal roles",()=>{
 const kinds=["evidence.submitted","evidence.reviewed","evidence.additional.requested","evidence.unable","evidence.escalated","evidence.returned","assessment.review.conflict","evidence.second_review.requested","assessment.review.assigned","integrity.escalated","integrity.returned","interview.recommended","decision.recorded","credential.issued","appeal.submitted","appeal.updated"];
 const refs={"evidence.submitted":"audit:audit_A","evidence.reviewed":"review:review_A","evidence.additional.requested":"review:review_B","evidence.unable":"resolution:resolution_A","evidence.escalated":"resolution:resolution_B","evidence.returned":"resolution:resolution_C","assessment.review.conflict":"review_recovery:audit_conflict_A","evidence.second_review.requested":"review_recovery:audit_quality_A","assessment.review.assigned":"scoring:audit_assignment_A","integrity.escalated":"integrity:integrity_A","integrity.returned":"integrity:integrity_B","interview.recommended":"recommendation:recommendation_A","decision.recorded":"case:event_A","credential.issued":"issuance:credential_id_A:1","appeal.submitted":"appeal:appeal_A:1","appeal.updated":"appeal:appeal_A:2"};
 for(const type of kinds){
  assert.deepEqual(notification.normalizeNotificationMetadata(type,{eventRef:refs[type]}),{eventRef:refs[type]});
  for(const extra of ["href","recipientRef","body","email","token"])assert.throws(()=>notification.normalizeNotificationMetadata(type,{eventRef:refs[type],[extra]:"arbitrary"}));
  if(type!=="evidence.submitted")assert.throws(()=>notification.normalizeNotificationMetadata(type,{eventRef:"audit:unrelated"}));
 }
 for(const [role,target,ref,path] of [
  ["worker","worker.evidence.record","evidence_record_"+"a".repeat(32),"/worker/evidence#"],
  ["worker","worker.identity.record","worker_identity_"+"A".repeat(24),"/worker/identity#"],
  ["worker","worker.observation.record","supervisor_observation_"+"A".repeat(24),"/worker/observations#"],
  ["verifier","verifier.review.task","evidence_review_"+"A".repeat(24),"/verifier/reviews/"],
  ["worker","worker.assurance.case","assurance_case_"+"A".repeat(24),"/worker/assurance-cases/"],
  ["worker","worker.credential.record","credential_id_decision_A","/worker/passport#"],
  ["admin","admin.scoring.assignment","assurance_case_"+"A".repeat(24),"/admin/operations/scoring-assignments#"],
  ["admin","admin.review.quality","evidence_review_"+"A".repeat(24),"/admin/operations/review-quality#"],
  ["admin","appeal.record","appeal_A","/admin/appeals#"]
 ]){
  assert.equal(notification.resolveNotificationHref({role,target,targetReference:ref}),path+ref);
  for(const bad of [null,"https://example.test","../other","//example.test",ref+"?owner=other",ref+"%2fother"])assert.throws(()=>notification.resolveNotificationHref({role,target,targetReference:bad}));
  if(target!=="appeal.record")for(const foreign of ["worker","company","assessor","verifier","admin","root"].filter(r=>r!==role))assert.throws(()=>notification.resolveNotificationHref({role:foreign,target,targetReference:ref}));
 }
 assert.throws(()=>notification.resolveNotificationHref({role:"root",target:"appeal.record",targetReference:"appeal_A"}));
});

test("integrity notices deep-link only to their authorized operational reviewer",()=>{
 const review="written_score_"+"A".repeat(24);
 for(const [role,target,path] of [["admin","admin.integrity.review","/admin/operations/integrity-reviews"],["verifier","verifier.integrity.review","/verifier/reviews/scoring"]]){
  assert.equal(notification.resolveNotificationHref({role,target,targetReference:review}),path+"#"+review);
  for(const foreign of ["worker","company","root",role==="admin"?"verifier":"admin"]){assert.throws(()=>notification.resolveNotificationHref({role:foreign,target,targetReference:review}),notification.NotificationContractError);}
  assert.throws(()=>notification.resolveNotificationHref({role,target,targetReference:"https://example.test/"}),notification.NotificationContractError);
 }
});
