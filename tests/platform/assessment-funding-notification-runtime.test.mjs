import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { assessmentFundingFixture, fundingPrincipal } from "../helpers/assessment-funding-fixture.mjs";
import { seedPermanentWorkerId } from "../helpers/permanent-worker-id-fixture.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const { WorkerAssessmentApplicationService } = loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");
const { AssuranceOrderService } = loadWorkerRegistrationTs("src/lib/assurance/assurance-order-service.ts");
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

test("Company approval rejects exhausted credits without changing pending funding or creating cases", async () => {
  const fixture = await assessmentFundingFixture(), database = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try {
    const service = new WorkerAssessmentApplicationService(database);
    const application = await service.requestCompanyFunding(fixture.worker, fixture.fundingInput);
    const tenant = fixture.fundingInput.tenantId;
    const balance = (await database.query("SELECT COALESCE(SUM(credit_delta),0)::int AS n FROM billing_credit_ledger WHERE tenant_id=$1", [tenant])).rows[0].n;
    assert.equal(balance, 3, "Fixture starts with exactly three legitimate purchased credits.");
    // Preload a fully reserved budget without altering the immutable credit ledger.
    await database.query(
      `INSERT INTO funding_requests (funding_request_id,tenant_id,worker_link_id,requested_by_account_id,status,credit_units,reserved_credit_units,idempotency_key,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'APPROVED',3,3,$5,clock_timestamp(),clock_timestamp())`,
      ["funding_request_budget_exhausted",tenant,fixture.fundingInput.workerLinkId,fixture.worker.accountId,"reserved-budget-exhaustion"]
    );
    const before = (await database.query("SELECT COUNT(*)::int AS n FROM assurance_cases WHERE worker_account_id=$1",[fixture.worker.accountId])).rows[0].n;
    await assert.rejects(
      () => service.decideCompanyFunding(fixture.company,{fundingRequestId:application.fundingRequestId,approved:true}),
      /enough unreserved assessment credits/i
    );
    const funding = (await database.query("SELECT status,reserved_credit_units FROM funding_requests WHERE funding_request_id=$1",[application.fundingRequestId])).rows[0];
    assert.equal(funding.status,"REQUESTED");
    assert.equal(funding.reserved_credit_units,0);
    const pending = (await database.query("SELECT application_status FROM worker_assessment_applications WHERE application_id=$1",[application.applicationId])).rows[0];
    assert.equal(pending.application_status,"FUNDING_REQUESTED");
    assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM assurance_cases WHERE worker_account_id=$1",[fixture.worker.accountId])).rows[0].n,before);
  } finally { await database.close(); await fixture.cleanup(); }
});


test("M2.01.04 competing funded Worker approvals never overreserve one purchased Company credit",async()=>{
  const fixture=await assessmentFundingFixture({startingCreditUnits:1});
  const database=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
    const now=new Date().toISOString(),secondWorker="search_foreign_worker";
    const foreignWorkerId=await seedPermanentWorkerId(database,{accountId:secondWorker},"z",now);
    const secondLinkId="company_worker_link_"+"z".repeat(24);
    await database.query(
      "INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,link_status,payment_responsibility,requested_by_membership_id,worker_accepted_at,activated_at,created_at,updated_at) VALUES($1,$2,$3,$4,'permanent_worker_id','active','company',$5,$6,$6,$6,$6)",
      [secondLinkId,fixture.fundingInput.tenantId,secondWorker,foreignWorkerId,fixture.credentials.company.membershipId,now]
    );
    const secondPrincipal=await fundingPrincipal(database,{accountId:secondWorker});
    const service=new WorkerAssessmentApplicationService(database);
    const first=await service.requestCompanyFunding(fixture.worker,fixture.fundingInput);
    const second=await service.requestCompanyFunding(secondPrincipal,{...fixture.fundingInput,workerLinkId:secondLinkId});
    assert.notEqual(first.fundingRequestId,second.fundingRequestId);
    const before=(await database.query("SELECT COALESCE(SUM(credit_delta),0)::int AS amount FROM billing_credit_ledger WHERE tenant_id=$1",[fixture.fundingInput.tenantId])).rows[0].amount;
    assert.equal(before,1);
    const competing=await Promise.allSettled([first,second].map(item=>service.decideCompanyFunding(fixture.company,{fundingRequestId:item.fundingRequestId,approved:true})));
    assert.equal(competing.filter(item=>item.status==="fulfilled").length,1);
    const errors=competing.filter(item=>item.status==="rejected");
    assert.equal(errors.length,1);
    assert.match(errors[0].reason.message,/enough unreserved assessment credits/i);
    const reservations=(await database.query("SELECT funding_request_id,status,credit_units,reserved_credit_units FROM funding_requests WHERE tenant_id=$1 ORDER BY funding_request_id",[fixture.fundingInput.tenantId])).rows;
    assert.equal(reservations.length,2);
    assert.deepEqual(reservations.map(row=>row.status).sort(),["APPROVED","REQUESTED"]);
    assert.equal(reservations.reduce((sum,row)=>sum+Number(row.reserved_credit_units),0),1);
    const applications=(await database.query("SELECT worker_account_id,application_status,assurance_case_id FROM worker_assessment_applications WHERE company_tenant_id=$1 ORDER BY worker_account_id",[fixture.fundingInput.tenantId])).rows;
    assert.equal(applications.length,2);
    assert.deepEqual(applications.map(row=>row.application_status).sort(),["CASE_CREATED","FUNDING_REQUESTED"]);
    const cases=(await database.query("SELECT case_id,worker_account_id FROM assurance_cases WHERE tenant_id=$1",[fixture.fundingInput.tenantId])).rows;
    assert.equal(cases.length,1);
    assert.ok(applications.some(row=>row.assurance_case_id===cases[0].case_id));
    assert.equal((await database.query("SELECT COALESCE(SUM(credit_delta),0)::int AS amount FROM billing_credit_ledger WHERE tenant_id=$1",[fixture.fundingInput.tenantId])).rows[0].amount,1);
    console.log("ACTUAL_M20104_FUNDING_CONCURRENT 2 real worker requests / one purchased credit / one reserved and funded case, other remains pending; no overspend or double debit, atomic Company permission-scoped transactions");
  }finally{await database.close();await fixture.cleanup();}
});

test("M2.01 shared Company credits cannot fund direct orders and Worker requests twice; pending cancellation releases order hold",async()=>{
  const fixture=await assessmentFundingFixture({startingCreditUnits:1});
  const database=await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try{
    const workerAccount="search_foreign_worker",now=new Date().toISOString(),tenant=fixture.fundingInput.tenantId;
    const company={...fixture.company,authorizedTenantPermission:"company.orders.manage"};
    const secondWorkerId=await seedPermanentWorkerId(database,{accountId:workerAccount},"y",now);
    const secondLink="company_worker_link_"+"y".repeat(24);
    await database.query(
      "INSERT INTO company_worker_links(link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,link_status,payment_responsibility,requested_by_membership_id,worker_accepted_at,activated_at,created_at,updated_at) VALUES($1,$2,$3,$4,'permanent_worker_id','active','company',$5,$6,$6,$6,$6)",
      [secondLink,tenant,workerAccount,secondWorkerId,fixture.credentials.company.membershipId,now]
    );
    const orders=new AssuranceOrderService(database);
    const funding=new WorkerAssessmentApplicationService(database);
    const draft=(ref)=>({
      orderName:"Company credit cross-flow "+ref,orderReference:ref,siteId:null,departmentId:null,
      requestedIdentityChecks:["identity"],requestedEvidenceChecks:["qualification"],assessmentFrameworkReferences:[],
      interviewRequired:false,credentialTarget:null,deadline:new Date(Date.now()+86400000).toISOString(),
      effectivePolicyReference:null,companyNotes:"Verified purchased credit boundary",purchaseOrderReference:null
    });
    const first=await orders.createDraft(company,draft("CREDIT-CROSS-FIRST"));
    await orders.addWorkerTarget(company,first.orderId,fixture.fundingInput.workerLinkId,"company");
    assert.equal((await orders.validateOrder(company,first.orderId)).ready,true);
    const firstCases=await orders.submitOrder(company,first.orderId);
    assert.equal(firstCases.length,1);
    assert.equal((await database.query("SELECT COALESCE(SUM(credit_delta),0)::int AS amount FROM billing_credit_ledger WHERE tenant_id=$1",[tenant])).rows[0].amount,1);

    const second=await orders.createDraft(company,draft("CREDIT-CROSS-SECOND"));
    await orders.addWorkerTarget(company,second.orderId,secondLink,"company");
    const insufficient=await orders.validateOrder(company,second.orderId);
    assert.equal(insufficient.ready,false,"Direct Company order must respect the first order's held credit.");
    assert.match(insufficient.errors.join(" "),/insufficient.*credits/i);

    const secondActor=await fundingPrincipal(database,{accountId:workerAccount});
    const request=await funding.requestCompanyFunding(secondActor,{...fixture.fundingInput,workerLinkId:secondLink});
    await assert.rejects(
      funding.decideCompanyFunding(fixture.company,{fundingRequestId:request.fundingRequestId,approved:true}),
      /enough unreserved assessment credits/i,
      "Worker application cannot spend a credit already held by a direct Company Assurance Order."
    );
    assert.equal((await database.query("SELECT status FROM funding_requests WHERE funding_request_id=$1",[request.fundingRequestId])).rows[0].status,"REQUESTED");

    await orders.cancelSubmittedOrder(company,first.orderId);
    assert.equal((await database.query("SELECT order_status FROM assurance_orders WHERE order_id=$1",[first.orderId])).rows[0].order_status,"CANCELLED");
    assert.equal((await database.query("SELECT case_status FROM assurance_cases WHERE order_id=$1",[first.orderId])).rows[0].case_status,"Closed");
    assert.equal((await orders.validateOrder(company,second.orderId)).ready,true,"Cancelled pending order must no longer consume unused Company credit.");

    await funding.decideCompanyFunding(fixture.company,{fundingRequestId:request.fundingRequestId,approved:true});
    assert.equal((await database.query("SELECT reserved_credit_units FROM funding_requests WHERE funding_request_id=$1",[request.fundingRequestId])).rows[0].reserved_credit_units,1);
    await assert.rejects(
      orders.submitOrder(company,second.orderId),
      /insufficient unreserved assessment credits/i,
      "A once-READY direct order must not submit using the credit now reserved by the Worker funding path."
    );
    assert.equal((await database.query("SELECT order_status FROM assurance_orders WHERE order_id=$1",[second.orderId])).rows[0].order_status,"READY");
    const funded=(await database.query("SELECT assurance_order_id,assurance_case_id,application_status FROM worker_assessment_applications WHERE funding_request_id=$1",[request.fundingRequestId])).rows[0];
    assert.equal(funded.application_status,"CASE_CREATED");
    assert.ok(funded.assurance_order_id&&funded.assurance_case_id);
    assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM assurance_cases WHERE order_id=$1",[funded.assurance_order_id])).rows[0].n,1);
    assert.equal((await database.query("SELECT COALESCE(SUM(credit_delta),0)::int AS n FROM billing_credit_ledger WHERE tenant_id=$1",[tenant])).rows[0].n,1);
    console.log("ACTUAL_M20102_CREDIT_CROSS_FLOW real 1-credit sandbox purchase: direct Company order holds one, second direct and Worker funding denied; cancelling pending order releases hold; Worker funding reserves once and creates case; stale READY direct submission denied, no duplicate ledger debit");
  }finally{await database.close();await fixture.cleanup();}
});
