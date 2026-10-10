import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { assessmentFundingFixture } from "../helpers/assessment-funding-fixture.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const { WorkerAssessmentApplicationService } = loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");
test("Actual Worker Company-funding request atomically persists one real next-actor notification job", async () => {
  const fixture = await assessmentFundingFixture(), database = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try {
    const application = await new WorkerAssessmentApplicationService(database).requestCompanyFunding(fixture.worker, fixture.fundingInput);
    assert.equal(application.status, "FUNDING_REQUESTED");
    assert.equal((await database.query("SELECT status FROM funding_requests WHERE funding_request_id=$1", [application.fundingRequestId])).rows[0].status, "REQUESTED");
    const source = (await database.query("SELECT event_id FROM worker_assessment_application_events WHERE application_id=$1 AND from_status IS NULL AND to_status='FUNDING_REQUESTED'", [application.applicationId])).rows[0];
    assert.ok(source, "Real producer must retain the immutable event.");
    const jobs = (await database.query("SELECT * FROM platform_outbox_jobs WHERE job_type='notification.assessment.funding' AND payload->>'eventRef'=$1", [source.event_id])).rows;
    assert.equal(jobs.length, 1, "Accepted funding request currently produces no persisted next-actor notification job.");
    assert.deepEqual(jobs[0].payload, { eventRef: source.event_id });
    assert.equal(jobs[0].enqueued_by_account_id, fixture.worker.accountId);
    assert.equal(jobs[0].enqueued_by_role, "worker");
  } finally { await database.close(); await fixture.cleanup(); }
});

const { DatabaseOutboxRepository } = loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const { processNextOutboxJob } = loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");
const { DatabaseNotificationRepository } = loadWorkerRegistrationTs("src/lib/notifications/notification-repository.ts");
const { resolveNotificationHref } = loadWorkerRegistrationTs("src/lib/notifications/notification-domain.ts");
async function nextFundingProjection(database) {
  for(let checked=0;checked<3;checked++){
    const result=await processNextOutboxJob({database,repository:new DatabaseOutboxRepository(Promise.resolve(database))});
    assert.ok(result,"The committed funding projection must remain queued.");
    if(result.jobType==="notification.assessment.funding")return result;
    assert.equal(result.jobType,"email.assurance.event","Only the preceding committed funding email may intervene in FIFO order.");
    assert.equal(result.payload.eventType,"assessment.funding.requested");
    const source=(await database.query("SELECT event_id FROM worker_assessment_application_events WHERE event_id=$1 AND to_status=\'FUNDING_REQUESTED\'",[result.payload.eventRef.slice("funding:".length)])).rows[0];
    assert.equal(result.payload.eventRef,"funding:"+source?.event_id);
    assert.equal(result.status,"succeeded","The genuine registered email handler must finish its obsolete request safely.");
    const delivery=(await database.query("SELECT status,last_result_code FROM platform_email_deliveries WHERE source_job_id=$1",[result.jobId])).rows[0];
    assert.deepEqual(delivery,{status:"suppressed",last_result_code:"recipient_or_record_unavailable"},"Completed funding no longer authorizes dispatch of the prior request email.");
  }
  assert.fail("Funding projection was not reached within its two-channel FIFO boundary.");
}
async function deliver(database) {
  const result = await nextFundingProjection(database);
  assert.equal(result?.status, "succeeded", "Actual registered worker must project its committed notification job.");
  return result;
}
test("Real Company approval delivers the owned Worker assessment next action and replay cannot reserve credits twice", async () => {
  const fixture = await assessmentFundingFixture(), database = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try {
    const service = new WorkerAssessmentApplicationService(database);
    const application = await service.requestCompanyFunding(fixture.worker, fixture.fundingInput);
    await deliver(database);
    const notices = new DatabaseNotificationRepository(Promise.resolve(database));
    const companyNotices = await notices.listForPrincipal(fixture.company);
    assert.equal(companyNotices.length, 1);
    assert.equal(companyNotices[0].notificationType, "assessment.funding.requested");
    assert.equal(companyNotices[0].recipientAccountId, fixture.company.accountId);
    assert.equal(companyNotices[0].membershipId, fixture.company.tenantMembership.membershipId);
    assert.equal(resolveNotificationHref({ role: "company", target: companyNotices[0].target, targetReference: companyNotices[0].targetReference }),
      "/company/billing#" + application.fundingRequestId);
    assert.equal(await notices.unreadCountForPrincipal(fixture.company), 1);
    assert.equal((await notices.markReadForPrincipal(fixture.company, companyNotices[0].notificationId)).changed, true);
    assert.equal((await notices.markReadForPrincipal(fixture.company, companyNotices[0].notificationId)).changed, false);
    await service.decideCompanyFunding(fixture.company, { fundingRequestId: application.fundingRequestId, approved: true });
    const funded = (await database.query("SELECT * FROM worker_assessment_applications WHERE application_id=$1", [application.applicationId])).rows[0];
    assert.equal(funded.application_status, "CASE_CREATED");
    const actualCase = (await database.query("SELECT worker_account_id,tenant_id,case_status FROM assurance_cases WHERE case_id=$1", [funded.assurance_case_id])).rows[0];
    assert.deepEqual(actualCase, { worker_account_id: fixture.worker.accountId, tenant_id: fixture.fundingInput.tenantId, case_status: "Assessment pending" });
    const job = await deliver(database);
    assert.equal(job.jobType, "notification.assessment.funding");
    const workerNotices = await notices.listForPrincipal(fixture.worker);
    assert.equal(workerNotices.length, 1);
    const notice = workerNotices[0];
    assert.equal(notice.notificationType, "assessment.funding.approved");
    assert.equal(notice.recipientAccountId, fixture.worker.accountId);
    assert.equal(notice.tenantId, null);
    assert.equal(resolveNotificationHref({ role: "worker", target: notice.target, targetReference: notice.targetReference }),
      "/worker/available-assessments#" + funded.assurance_case_id);
    assert.equal(await notices.unreadCountForPrincipal(fixture.worker), 1);
    assert.equal(await notices.findForPrincipal(fixture.company, companyNotices[0].notificationId), null, "Completed funding request is no longer an actionable Company deep link.");
    const before = await snapshotFunding(database);
    await assert.rejects(() => service.decideCompanyFunding(fixture.company, { fundingRequestId: application.fundingRequestId, approved: true }), /no longer pending/);
    const { projectAssessmentFundingNotification } = loadWorkerRegistrationTs("src/lib/notifications/assessment-funding-notification-projector.ts");
    assert.deepEqual(await projectAssessmentFundingNotification(job, database), { kind: "succeeded" });
    assert.deepEqual(await snapshotFunding(database), before);
    await assert.rejects(() => database.query("UPDATE worker_assessment_application_events SET actor_role='worker' WHERE event_id=$1", [job.payload.eventRef]), /append-only/);
  } finally { await database.close(); await fixture.cleanup(); }
});
async function snapshotFunding(database) {
  return {
    requests: (await database.query("SELECT funding_request_id,status,reserved_credit_units FROM funding_requests ORDER BY funding_request_id")).rows,
    applications: (await database.query("SELECT application_id,application_status,assurance_case_id FROM worker_assessment_applications ORDER BY application_id")).rows,
    cases: (await database.query("SELECT case_id,worker_account_id,tenant_id FROM assurance_cases ORDER BY case_id")).rows,
    jobs: (await database.query("SELECT job_id,status,attempt_count FROM platform_outbox_jobs ORDER BY job_id")).rows,
    notifications: (await database.query("SELECT notification_id,recipient_account_id,recipient_role,target_key,target_reference FROM platform_notifications ORDER BY notification_id")).rows,
    ledger: (await database.query("SELECT ledger_entry_id,credit_delta FROM billing_credit_ledger ORDER BY ledger_entry_id")).rows
  };
}
test("Notification projection failure retries independently after funding commits and cannot reapprove", async () => {
  const fixture = await assessmentFundingFixture(), database = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try {
    const service = new WorkerAssessmentApplicationService(database);
    const application = await service.requestCompanyFunding(fixture.worker, fixture.fundingInput);
    await deliver(database);
    await service.decideCompanyFunding(fixture.company, { fundingRequestId: application.fundingRequestId, approved: true });
    const fundedBefore = await snapshotFunding(database);
    await database.exec("CREATE FUNCTION test_fail_funding_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.notification_type='assessment.funding.approved' THEN RAISE EXCEPTION 'Injected notification delivery failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER test_fail_funding_notification BEFORE INSERT ON platform_notifications FOR EACH ROW EXECUTE FUNCTION test_fail_funding_notification()");
    const failed = await nextFundingProjection(database);
    assert.equal(failed.jobType,"notification.assessment.funding");
    assert.equal(failed.status, "retry_wait");
    const failedSnapshot = await snapshotFunding(database);
    for (const key of ["requests", "applications", "cases", "ledger"]) assert.deepEqual(failedSnapshot[key], fundedBefore[key]);
    assert.equal(failedSnapshot.notifications.length, 1);
    await database.exec("DROP TRIGGER test_fail_funding_notification ON platform_notifications; DROP FUNCTION test_fail_funding_notification()");
    await database.query("UPDATE platform_outbox_jobs SET next_attempt_at=clock_timestamp()-INTERVAL '1 second' WHERE job_id=$1", [failed.jobId]);
    const retried = await deliver(database);
    assert.equal(retried.jobId, failed.jobId);
    assert.equal(retried.attemptCount, 2);
    const after = await snapshotFunding(database);
    for (const key of ["requests", "applications", "cases", "ledger"]) assert.deepEqual(after[key], fundedBefore[key]);
    assert.equal(after.notifications.length, 2);
    assert.equal(after.requests[0].reserved_credit_units, 1);
    assert.equal(after.cases.length, 1);
  } finally { await database.close(); await fixture.cleanup(); }
});
