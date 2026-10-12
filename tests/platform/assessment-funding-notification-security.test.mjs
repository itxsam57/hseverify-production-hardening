import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { assessmentFundingFixture, fundingPrincipal } from "../helpers/assessment-funding-fixture.mjs";
import { loadWorkerRegistrationTs } from "../helpers/worker-registration-runtime-loader.mjs";
const { WorkerAssessmentApplicationService } = loadWorkerRegistrationTs("src/lib/assessment-catalogue/worker-assessment-application-service.ts");
const { DatabaseOutboxRepository } = loadWorkerRegistrationTs("src/lib/outbox/outbox-repository.ts");
const { processNextOutboxJob } = loadWorkerRegistrationTs("src/lib/outbox/outbox-worker.ts");
const { DatabaseNotificationRepository } = loadWorkerRegistrationTs("src/lib/notifications/notification-repository.ts");
const identifier = (prefix, seed) => prefix + "_" + createHash("sha256").update(seed).digest("hex").slice(0, 24);
async function withFunding(run) {
  const fixture = await assessmentFundingFixture(), database = await PGlite.create(fixture.environment.HSE_PGLITE_DATA_DIR);
  try { await run(fixture, database, new WorkerAssessmentApplicationService(database), new DatabaseNotificationRepository(Promise.resolve(database))); }
  finally { await database.close(); await fixture.cleanup(); }
}
async function deliver(database) {
  const result = await processNextOutboxJob({ database, repository: new DatabaseOutboxRepository(Promise.resolve(database)) });
  assert.equal(result?.status, "succeeded");
  return result;
}
async function addMember(database, fixture, seed, options = {}) {
  const accountId = "assessment_funding_" + seed, membershipId = identifier("membership", seed);
  const role = options.role ?? "admin", tenantId = options.tenantId ?? fixture.fundingInput.tenantId, now = new Date().toISOString();
  await database.query("INSERT INTO auth_accounts(account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at) SELECT $1,$2,$3,$4,password_hash,$5,$5 FROM auth_accounts WHERE account_id=$6",
    [accountId, seed + "@funding.example.test", "Funding " + seed, "active", now, fixture.company.accountId]);
  await database.query("INSERT INTO auth_account_roles(account_id,role) VALUES($1,'company')", [accountId]);
  await database.query("INSERT INTO auth_tenant_memberships(membership_id,tenant_id,account_id,membership_role,membership_status,activated_at,revoked_at,created_by_account_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [membershipId, tenantId, accountId, role, options.revoked ? "revoked" : "active", now, options.revoked ? now : null, fixture.credentials.admin.accountId]);
  if (options.deny) await deny(database, { membershipId, membershipRole: role }, options.deny);
  const principal = await fundingPrincipal(database, { accountId, membershipId, tenantId, membershipRole: role }, "company");
  if (options.disabled) await database.query("UPDATE auth_accounts SET account_status='disabled' WHERE account_id=$1", [accountId]);
  return principal;
}
async function deny(database, identity, permission = "company.billing.manage") {
  await database.query("INSERT INTO auth_tenant_permission_overrides(membership_id,membership_role,permission_key,effect,reason) VALUES($1,$2,$3,'deny','Focused funding permission revocation')",
    [identity.membershipId, identity.membershipRole ?? identity.role, permission]);
}
async function fundingState(database) {
  const result = {};
  for (const [key, sql] of Object.entries({
    requests: "SELECT funding_request_id,status,reserved_credit_units FROM funding_requests ORDER BY funding_request_id",
    applications: "SELECT application_id,application_status,assurance_case_id FROM worker_assessment_applications ORDER BY application_id",
    events: "SELECT event_id,application_id,from_status,to_status FROM worker_assessment_application_events ORDER BY event_id",
    cases: "SELECT case_id,worker_account_id,tenant_id FROM assurance_cases ORDER BY case_id",
    jobs: "SELECT job_id,status,attempt_count FROM platform_outbox_jobs ORDER BY job_id",
    notices: "SELECT notification_id,recipient_account_id,recipient_role,tenant_id,membership_id FROM platform_notifications ORDER BY notification_id",
    ledger: "SELECT ledger_entry_id,credit_delta FROM billing_credit_ledger ORDER BY ledger_entry_id"
  })) result[key] = (await database.query(sql)).rows;
  return result;
}
test("Canonical source-event identity rejects a second delivery job with another key", async () => withFunding(async (fixture, database, service) => {
  const application = await service.requestCompanyFunding(fixture.worker, fixture.fundingInput);
  const job = (await database.query("SELECT * FROM platform_outbox_jobs WHERE job_type='notification.assessment.funding'")).rows[0];
  const before = await fundingState(database);
  await assert.rejects(() => database.query(
    "INSERT INTO platform_outbox_jobs(job_id,job_type,schema_version,idempotency_key,payload,enqueued_by_account_id,enqueued_by_role,tenant_id,membership_id) SELECT $1,job_type,schema_version,$2,payload,enqueued_by_account_id,enqueued_by_role,tenant_id,membership_id FROM platform_outbox_jobs WHERE job_id=$3",
    [identifier("job", "duplicate-event"), createHash("sha256").update("duplicate-event").digest("hex"), job.job_id]), { code: "23514" });
  await database.query("SELECT platform_enqueue_assessment_funding_notification($1)", [job.payload.eventRef]);
  assert.deepEqual(await fundingState(database), before, "Exact producer replay retains one job and the original funding transition.");
  await assert.rejects(() => database.query("UPDATE platform_outbox_jobs SET job_id=$2 WHERE job_id=$1", [job.job_id, identifier("job", "changed-identity")]), { code: "55000" });
  assert.equal(before.requests[0].funding_request_id, application.fundingRequestId);
}));
test("Live Company billing revocation removes the persisted next-action bell and denies Open", async () => withFunding(async (fixture, database, service, notices) => {
  await service.requestCompanyFunding(fixture.worker, fixture.fundingInput);
  await deliver(database);
  const notice = (await notices.listForPrincipal(fixture.company))[0];
  assert.ok(await notices.findForPrincipal(fixture.company, notice.notificationId));
  await deny(database, fixture.company.tenantMembership);
  assert.equal(await notices.findForPrincipal(fixture.company, notice.notificationId), null);
  assert.equal(await notices.unreadCountForPrincipal(fixture.company), 0, "A revoked billing actor must not retain an actionable bell count.");
  assert.deepEqual(await notices.listForPrincipal(fixture.company), []);
  assert.equal(await notices.markReadForPrincipal(fixture.company, notice.notificationId), null);
  assert.deepEqual(await notices.markAllReadForPrincipal(fixture.company), []);
  assert.equal((await database.query("SELECT read_at FROM platform_notifications WHERE notification_id=$1", [notice.notificationId])).rows[0].read_at, null);
}));
test("One real request fans out only to live owned billing members and foreign approval stays denied", async () => withFunding(async (fixture, database, service, notices) => {
  const eligible = await addMember(database, fixture, "eligible");
  const viewer = await addMember(database, fixture, "viewer", { role: "viewer" });
  const manager = await addMember(database, fixture, "manager", { role: "manager" });
  await addMember(database, fixture, "deny_manage", { deny: "company.billing.manage" });
  await addMember(database, fixture, "deny_read", { deny: "company.billing.read" });
  await addMember(database, fixture, "revoked", { role: "owner", revoked: true });
  await addMember(database, fixture, "disabled", { role: "owner", disabled: true });
  const foreignTenant = identifier("tenant", "foreign-funding");
  await database.query("INSERT INTO platform_tenants(tenant_id,tenant_type,display_name,tenant_status,activated_at) VALUES($1,'company','Foreign funding Company','active',CURRENT_TIMESTAMP)", [foreignTenant]);
  const foreign = await addMember(database, fixture, "foreign", { role: "owner", tenantId: foreignTenant });
  const application = await service.requestCompanyFunding(fixture.worker, fixture.fundingInput);
  const beforeApproval = await fundingState(database);
  await assert.rejects(() => service.decideCompanyFunding(foreign, { fundingRequestId: application.fundingRequestId, approved: true }));
  assert.deepEqual(await fundingState(database), beforeApproval);
  await deliver(database);
  const rows = (await database.query("SELECT * FROM platform_notifications WHERE notification_type='assessment.funding.requested' ORDER BY recipient_account_id")).rows;
  assert.deepEqual(rows.map(row => row.recipient_account_id).sort(), [eligible.accountId, fixture.company.accountId].sort());
  assert.equal(new Set(rows.map(row => row.source_job_id)).size, 1, "Two recipients share the single real producer job.");
  assert.ok(rows.every(row => row.tenant_id === fixture.fundingInput.tenantId && row.target_reference === application.fundingRequestId));
  for (const principal of [viewer, manager, foreign]) {
    assert.deepEqual(await notices.listForPrincipal(principal), []);
    assert.equal(await notices.findForPrincipal(principal, rows[0].notification_id), null);
  }
  await assert.rejects(() => database.query("INSERT INTO auth_tenant_permission_overrides(membership_id,membership_role,permission_key,effect,reason) VALUES($1,'manager','company.billing.manage','grant','Cannot exceed role ceiling')",
    [manager.tenantMembership.membershipId]), { code: "23503" });
  await database.query("UPDATE auth_tenant_memberships SET membership_status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE membership_id=$1", [eligible.tenantMembership.membershipId]);
  await assert.rejects(() => notices.listForPrincipal(eligible), { name: "NotificationAccessDeniedError" });
  const retained = await fundingState(database);
  const down = await readFile("database/migrations/0095_assessment_funding_notifications.down.sql", "utf8");
  await assert.rejects(() => database.transaction(transaction => transaction.exec(down)), { code: "55000" });
  assert.deepEqual(await fundingState(database), retained, "Rollback refuses retained fanout without deleting notification or funding history.");
}));
test("Persisted source rejects arbitrary content, another recipient, target tampering and mutable job payload", async () => withFunding(async (fixture, database, service) => {
  await service.requestCompanyFunding(fixture.worker, fixture.fundingInput);
  await deliver(database);
  const row = (await database.query("SELECT * FROM platform_notifications WHERE notification_type='assessment.funding.requested'")).rows[0];
  const before = await fundingState(database);
  const base = {
    notification_id: row.notification_id, notification_type: row.notification_type, schema_version: row.schema_version,
    source_job_id: row.source_job_id, projection_key: row.projection_key, recipient_account_id: row.recipient_account_id,
    recipient_role: row.recipient_role, tenant_id: row.tenant_id, membership_id: row.membership_id, title: row.title,
    body: row.body, metadata: row.metadata, target_key: row.target_key, target_reference: row.target_reference
  };
  let sequence = 0;
  for (const patch of [
    { title: "Arbitrary title" }, { body: "Browser-supplied content" },
    { target_reference: identifier("funding", "other-funding") },
    { metadata: { eventRef: row.metadata.eventRef, arbitrary: "value" } },
    { recipient_account_id: "search_foreign_worker", recipient_role: "worker", tenant_id: null, membership_id: null }
  ]) {
    sequence += 1;
    const candidate = { ...base, ...patch, notification_id: identifier("notification", "tamper-" + sequence), projection_key: createHash("sha256").update("tamper-" + sequence).digest("hex") };
    const columns = Object.keys(candidate), values = Object.values(candidate).map((value, index) => columns[index] === "metadata" ? JSON.stringify(value) : value);
    await assert.rejects(() => database.query("INSERT INTO platform_notifications(" + columns.join(",") + ") VALUES(" + columns.map((column, index) => "$" + (index + 1) + (column === "metadata" ? "::jsonb" : "")).join(",") + ")", values), { code: "23514" });
  }
  await assert.rejects(() => database.query("UPDATE platform_outbox_jobs SET payload=$2::jsonb WHERE job_id=$1", [row.source_job_id, JSON.stringify({ eventRef: identifier("assessment_application_event", "other-event") })]), { code: "55000" });
  assert.deepEqual(await fundingState(database), before);
}));
test("Worker account revocation suppresses delivery after real approval while retaining the funded owned case", async () => withFunding(async (fixture, database, service) => {
  const application = await service.requestCompanyFunding(fixture.worker, fixture.fundingInput);
  await deliver(database);
  await service.decideCompanyFunding(fixture.company, { fundingRequestId: application.fundingRequestId, approved: true });
  const funded = await fundingState(database);
  await database.query("UPDATE auth_accounts SET account_status='disabled' WHERE account_id=$1", [fixture.worker.accountId]);
  await deliver(database);
  const after = await fundingState(database);
  for (const key of ["requests", "applications", "events", "cases", "ledger"]) assert.deepEqual(after[key], funded[key]);
  assert.equal(after.requests[0].status, "APPROVED");
  assert.equal(after.requests[0].reserved_credit_units, 1);
  assert.equal(after.cases.length, 1);
  assert.equal((await database.query("SELECT COUNT(*)::int AS count FROM platform_notifications WHERE notification_type='assessment.funding.approved'")).rows[0].count, 0);
}));
test("Producer enqueue failure rolls back the funding transition and duplicate submission creates no second request", async () => withFunding(async (fixture, database, service) => {
  const before = await fundingState(database);
  await database.exec("CREATE FUNCTION test_fail_funding_enqueue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.job_type='notification.assessment.funding' THEN RAISE EXCEPTION 'Injected enqueue failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER test_fail_funding_enqueue BEFORE INSERT ON platform_outbox_jobs FOR EACH ROW EXECUTE FUNCTION test_fail_funding_enqueue()");
  await assert.rejects(() => service.requestCompanyFunding(fixture.worker, fixture.fundingInput), /Injected enqueue failure/);
  assert.deepEqual(await fundingState(database), before);
  await database.exec("DROP TRIGGER test_fail_funding_enqueue ON platform_outbox_jobs; DROP FUNCTION test_fail_funding_enqueue()");
  await service.requestCompanyFunding(fixture.worker, fixture.fundingInput);
  const committed = await fundingState(database);
  await assert.rejects(() => service.requestCompanyFunding(fixture.worker, fixture.fundingInput), /active|already|pending|application/i);
  assert.deepEqual(await fundingState(database), committed);
}));
test("Empty funding rollback restores exact predecessor constraints, trigger and source uniqueness", async () => withFunding(async (fixture, database) => {
  const contract = (await database.query("SELECT platform_assessment_funding_notification_rollback_contract() AS contract")).rows[0].contract;
  const before = await fundingState(database);
  const down = await readFile("database/migrations/0095_assessment_funding_notifications.down.sql", "utf8");
  await database.transaction(transaction => transaction.exec(down));
  for (const item of contract.checks) {
    const row = (await database.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2", [item.table, item.constraint])).rows[0];
    assert.equal(row.definition, item.definition);
  }
  assert.equal((await database.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='platform_notifications'::regclass AND conname='platform_notifications_source_job_id_key'")).rows[0].definition, contract.sourceUnique);
  assert.equal((await database.query("SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid='platform_notifications'::regclass AND tgname='platform_notifications_validate_insert'")).rows[0].definition, contract.trigger);
  assert.deepEqual(await fundingState(database), before);
  const up = await readFile("database/migrations/0095_assessment_funding_notifications.up.sql", "utf8");
  await database.transaction(transaction => transaction.exec(up));
  assert.deepEqual(await fundingState(database), before);
}));
