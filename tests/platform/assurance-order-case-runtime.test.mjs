import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_ASSURANCE_ORDER_RUNTIME_DIST;
assert.ok(runtime, "HSE_ASSURANCE_ORDER_RUNTIME_DIST is required");
const domainModule = await import(pathToFileURL(join(runtime, "assurance", "assurance-order-domain.js")).href);
const serviceModule = await import(pathToFileURL(join(runtime, "assurance", "assurance-order-service.js")).href);
const actionModule = await import(pathToFileURL(join(runtime, "assurance", "assurance-action-centre-service.js")).href);
const { AssuranceOrderConflictError, AssuranceOrderNotFoundError } = domainModule;
const { AssuranceOrderService } = serviceModule;
const { AssuranceActionCentreService } = actionModule;

const MIGRATION = "0033_assurance_order_case_engine";
const NOW_DATE = new Date("2026-08-18T00:00:00.000Z");
const NOW = NOW_DATE.toISOString();
const FUTURE = "2099-01-01T00:00:00.000Z";
const ENV = {
  appEnvironment: "test", databaseDriver: "pglite", databaseUrl: null,
  pgliteDataDir: "memory://", releaseSha: "m2-01-assurance-runtime-test",
  sessionSecret: "m2-01-assurance-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m2-01-assurance-auth-pepper-with-more-than-thirty-two-characters",
  authSandboxEnabled: false, authSandboxAccessKey: null,
  demoAuthEnabled: false, demoDataEnabled: false
};
const oid = (prefix, c) => `${prefix}_${c.repeat(24)}`;

async function db() {
  const database = await openScriptDatabase(ENV);
  await applyMigrationsThrough(database, ENV.releaseSha, MIGRATION);
  return database;
}

async function seedCompany(database, c) {
  const x = {
    accountId: `account_m201_company_${c}`,
    tenantId: oid("tenant", c),
    membershipId: oid("membership", c),
    sessionId: `session_m201_company_${c}`,
    email: `company-m201-${c.toLowerCase()}@example.com`,
    displayName: `M201 Company ${c}`
  };
  await database.query(`INSERT INTO auth_accounts
    (account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
    VALUES ($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [x.accountId,x.email,x.displayName,"scrypt$16384$8$1$salt$hash",NOW]);
  await database.query(`INSERT INTO auth_account_roles (account_id,role,created_at) VALUES ($1,'company',$2)`,[x.accountId,NOW]);
  await database.query(`INSERT INTO platform_tenants
    (tenant_id,tenant_type,display_name,tenant_status,created_by_account_id,created_at,updated_at,activated_at)
    VALUES ($1,'company',$2,'active',$3,$4,$4,$4)`,[x.tenantId,x.displayName,x.accountId,NOW]);
  await database.query(`INSERT INTO auth_tenant_memberships
    (membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at)
    VALUES ($1,$2,$3,'company','owner','active',$3,$4,$4,$4)`,[x.membershipId,x.tenantId,x.accountId,NOW]);
  await database.query(`INSERT INTO auth_sessions
    (session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at)
    VALUES ($1,$2,'company',$3,$4,$5,$5,$6)`,[x.sessionId,x.accountId,`m201-token-${c}`,`m201-csrf-${c}`,NOW,FUTURE]);
  await database.query(`INSERT INTO company_verification_cases
    (case_id,tenant_id,owner_account_id,case_status,lock_version,created_at,updated_at,verified_at)
    VALUES ($1,$2,$3,'verified',0,$4,$4,$4)`,[oid("company_verification",c),x.tenantId,x.accountId,NOW]);
  return x;
}

function managePrincipal(x) {
  return Object.freeze({
    accountId:x.accountId,sessionId:x.sessionId,activeRole:"company",accountStatus:"active",
    email:x.email,displayName:x.displayName,createdAt:NOW,lastSeenAt:NOW,expiresAt:FUTURE,
    tenantMembership:{tenantId:x.tenantId,tenantStatus:"active",membershipId:x.membershipId,role:"owner",status:"active",overrides:[]},
    authorizedTenantPermission:"company.orders.manage"
  });
}
function readPrincipal(x) {
  return Object.freeze({...managePrincipal(x),authorizedTenantPermission:"company.orders.read"});
}

async function seedWorkerLink(database, company, c) {
  const worker = {
    accountId:`account_m201_worker_${c}`,
    email:`worker-m201-${c.toLowerCase()}@example.com`,
    displayName:`M201 Worker ${c}`
  };
  await database.query(`INSERT INTO auth_accounts
    (account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
    VALUES ($1,$2,$3,'active',$4,$5,$5,$5,$5)`,[worker.accountId,worker.email,worker.displayName,"scrypt$16384$8$1$salt$hash",NOW]);
  await database.query(`INSERT INTO auth_account_roles (account_id,role,created_at) VALUES ($1,'worker',$2)`,[worker.accountId,NOW]);
  const invitationId=oid("worker_invitation",c);
  await database.query(`INSERT INTO company_worker_invitations
    (invitation_id,tenant_id,email_normalized,token_hash,invitation_status,site_id,department_id,payment_responsibility,assessment_reference,invited_by_membership_id,accepted_by_worker_account_id,resend_count,resend_available_at,expires_at,accepted_at,created_at,updated_at)
    VALUES ($1,$2,$3,$4,'accepted',NULL,NULL,'worker',NULL,$5,$6,0,$7,$8,$7,$7,$7)`,
    [invitationId,company.tenantId,worker.email,`m201-invite-hash-${c}`,company.membershipId,worker.accountId,NOW,FUTURE]);
  const linkId=oid("company_worker_link",c);
  await database.query(`INSERT INTO company_worker_links
    (link_id,tenant_id,worker_account_id,permanent_worker_id,link_source,invitation_id,code_id,link_status,site_id,department_id,payment_responsibility,assessment_reference,requested_by_membership_id,worker_accepted_at,activated_at,created_at,updated_at)
    VALUES ($1,$2,$3,NULL,'invitation',$4,NULL,'active',NULL,NULL,'worker',NULL,$5,$6,$6,$6,$6)`,
    [linkId,company.tenantId,worker.accountId,invitationId,company.membershipId,NOW]);
  return {...worker,linkId};
}

const basicDraft = (reference) => ({
  orderName:`Runtime ${reference}`,
  orderReference:reference,
  siteId:null,
  departmentId:null,
  requestedIdentityChecks:["identity"],
  requestedEvidenceChecks:["qualification"],
  assessmentFrameworkReferences:[],
  interviewRequired:false,
  credentialTarget:null,
  deadline:"2026-08-25T00:00:00.000Z",
  effectivePolicyReference:null,
  companyNotes:"Runtime hard test",
  purchaseOrderReference:null
});

async function readyOrder(database, company, workers, reference) {
  const service=new AssuranceOrderService(database);
  const principal=managePrincipal(company);
  const order=await service.createDraft(principal,basicDraft(reference),NOW_DATE);
  for(const worker of workers) await service.addWorkerTarget(principal,order.orderId,worker.linkId,"worker",NOW_DATE);
  const validation=await service.validateOrder(principal,order.orderId,NOW_DATE);
  assert.equal(validation.ready,true,validation.errors.join("; "));
  return {service,principal,order};
}

test("M2.01 real runtime creates one durable Assurance Case and Action Centre obligation per Worker",async()=>{
  const database=await db();
  try {
    const company=await seedCompany(database,"A");
    const workers=[await seedWorkerLink(database,company,"B"),await seedWorkerLink(database,company,"C")];
    const {service,principal,order}=await readyOrder(database,company,workers,"RUNTIME-A");
    const cases=await service.submitOrder(principal,order.orderId,NOW_DATE);
    assert.equal(cases.length,2);
    assert.deepEqual([...new Set(cases.map(item=>item.caseStatus))],["Identity pending"]);
    assert.deepEqual([...new Set(cases.map(item=>item.owner))],["worker"]);
    assert.ok(cases.every(item=>item.nextAction?.length>0));
    const storedOrder=await database.query(`SELECT order_status FROM assurance_orders WHERE order_id=$1`,[order.orderId]);
    assert.equal(storedOrder.rows[0]?.order_status,"SUBMITTED");
    const targets=await database.query(`SELECT target_status FROM assurance_order_workers WHERE order_id=$1`,[order.orderId]);
    assert.ok(targets.rows.every(row=>row.target_status==="submitted"));
    const actions=await database.query(`SELECT COUNT(*)::int AS count FROM assurance_action_items WHERE order_id=$1`,[order.orderId]);
    assert.equal(actions.rows[0]?.count,2);
    const timeline=await database.query(`SELECT event_type FROM assurance_case_timeline_events WHERE order_id=$1 ORDER BY occurred_at,timeline_event_id`,[order.orderId]);
    assert.equal(timeline.rows.filter(row=>row.event_type==="case_created").length,2);
  } finally { await database.close(); }
});

test("M2.01 concurrent submit race produces exactly one submission and no duplicate cases/actions",async()=>{
  const database=await db();
  try {
    const company=await seedCompany(database,"D");
    const workers=[await seedWorkerLink(database,company,"E"),await seedWorkerLink(database,company,"F")];
    const {service,principal,order}=await readyOrder(database,company,workers,"RUNTIME-RACE");
    const result=await Promise.allSettled(Array.from({length:12},()=>service.submitOrder(principal,order.orderId,NOW_DATE)));
    assert.equal(result.filter(item=>item.status==="fulfilled").length,1);
    assert.equal(result.filter(item=>item.status==="rejected").length,11);
    for(const item of result.filter(item=>item.status==="rejected")) assert.ok(item.reason instanceof AssuranceOrderConflictError);
    const cases=await database.query(`SELECT COUNT(*)::int AS count FROM assurance_cases WHERE order_id=$1`,[order.orderId]);
    const actions=await database.query(`SELECT COUNT(*)::int AS count FROM assurance_action_items WHERE order_id=$1`,[order.orderId]);
    const submittedEvents=await database.query(`SELECT COUNT(*)::int AS count FROM assurance_case_timeline_events WHERE order_id=$1 AND event_type='order_submitted'`,[order.orderId]);
    assert.equal(cases.rows[0]?.count,2); assert.equal(actions.rows[0]?.count,2); assert.equal(submittedEvents.rows[0]?.count,1);
  } finally { await database.close(); }
});

test("M2.01 copied IDs cannot cross tenants and stale Worker links fail closed",async()=>{
  const database=await db();
  try {
    const a=await seedCompany(database,"G"), b=await seedCompany(database,"H");
    const worker=await seedWorkerLink(database,a,"I");
    const {service,order}=await readyOrder(database,a,[worker],"RUNTIME-ISO");
    assert.equal(await service.findOrder(readPrincipal(b),order.orderId),null);
    await assert.rejects(new AssuranceOrderService(database).addWorkerTarget(managePrincipal(b),order.orderId,worker.linkId,"worker",NOW_DATE),AssuranceOrderNotFoundError);

    const draft=await service.createDraft(managePrincipal(a),basicDraft("RUNTIME-STALE"),NOW_DATE);
    await service.addWorkerTarget(managePrincipal(a),draft.orderId,worker.linkId,"worker",NOW_DATE);
    await database.query(`UPDATE company_worker_links SET link_status='revoked',revoked_at=$2,updated_at=$2 WHERE link_id=$1`,[worker.linkId,NOW]);
    const validation=await service.validateOrder(managePrincipal(a),draft.orderId,NOW_DATE);
    assert.equal(validation.ready,false);
    assert.match(validation.errors.join(" "),/no longer active/i);
  } finally { await database.close(); }
});

test("M2.01 database rejects submitted-scope mutation and timeline update/delete tampering",async()=>{
  const database=await db();
  try {
    const company=await seedCompany(database,"J");
    const worker=await seedWorkerLink(database,company,"K");
    const {service,principal,order}=await readyOrder(database,company,[worker],"RUNTIME-GUARD");
    const [createdCase]=await service.submitOrder(principal,order.orderId,NOW_DATE);
    await assert.rejects(database.query(`UPDATE assurance_orders SET order_name='tampered' WHERE order_id=$1`,[order.orderId]),error=>error?.code==="55000");
    await assert.rejects(database.query(`DELETE FROM assurance_order_workers WHERE order_id=$1`,[order.orderId]),error=>error?.code==="55000");
    const event=await database.query(`SELECT timeline_event_id FROM assurance_case_timeline_events WHERE case_id=$1 LIMIT 1`,[createdCase.caseId]);
    const eventId=event.rows[0]?.timeline_event_id; assert.ok(eventId);
    await assert.rejects(database.query(`UPDATE assurance_case_timeline_events SET next_action='tampered' WHERE timeline_event_id=$1`,[eventId]),error=>error?.code==="55000");
    await assert.rejects(database.query(`DELETE FROM assurance_case_timeline_events WHERE timeline_event_id=$1`,[eventId]),error=>error?.code==="55000");
  } finally { await database.close(); }
});

test("M2.01 submitted cancellation closes cases, resolves actions and preserves immutable history",async()=>{
  const database=await db();
  try {
    const company=await seedCompany(database,"L");
    const worker=await seedWorkerLink(database,company,"M");
    const {service,principal,order}=await readyOrder(database,company,[worker],"RUNTIME-CANCEL");
    await service.submitOrder(principal,order.orderId,NOW_DATE);
    const before=await database.query(`SELECT COUNT(*)::int AS count FROM assurance_case_timeline_events WHERE order_id=$1`,[order.orderId]);
    await service.cancelSubmittedOrder(principal,order.orderId,new Date("2026-08-18T01:00:00.000Z"));
    const orderState=await database.query(`SELECT order_status FROM assurance_orders WHERE order_id=$1`,[order.orderId]);
    const cases=await database.query(`SELECT case_status,owner_kind,next_action FROM assurance_cases WHERE order_id=$1`,[order.orderId]);
    const actions=await database.query(`SELECT action_status FROM assurance_action_items WHERE order_id=$1`,[order.orderId]);
    const after=await database.query(`SELECT COUNT(*)::int AS count FROM assurance_case_timeline_events WHERE order_id=$1`,[order.orderId]);
    assert.equal(orderState.rows[0]?.order_status,"CANCELLED");
    assert.ok(cases.rows.every(row=>row.case_status==="Closed"&&row.owner_kind===null&&row.next_action===null));
    assert.ok(actions.rows.every(row=>row.action_status==="resolved"));
    assert.ok(after.rows[0].count>before.rows[0].count);
  } finally { await database.close(); }
});

test("M2.01 Action Centre blocks unsafe assignment and snoozing of live worker obligations",async()=>{
  const database=await db();
  try {
    const company=await seedCompany(database,"N");
    const worker=await seedWorkerLink(database,company,"O");
    const {service,principal,order}=await readyOrder(database,company,[worker],"RUNTIME-ACTION");
    await service.submitOrder(principal,order.orderId,NOW_DATE);
    const actionRow=await database.query(`SELECT action_id FROM assurance_action_items WHERE order_id=$1 LIMIT 1`,[order.orderId]);
    const actionId=actionRow.rows[0]?.action_id; assert.ok(actionId);
    const actionService=new AssuranceActionCentreService(database);
    await assert.rejects(actionService.assignOwner(principal,actionId,company.membershipId,NOW_DATE),AssuranceOrderConflictError);
    await assert.rejects(actionService.snooze(principal,actionId,new Date("2026-08-20T00:00:00.000Z"),"not appropriate",NOW_DATE),AssuranceOrderConflictError);
    await actionService.acknowledge(principal,actionId,NOW_DATE);
    const stored=await database.query(`SELECT action_status FROM assurance_action_items WHERE action_id=$1`,[actionId]);
    assert.equal(stored.rows[0]?.action_status,"acknowledged");
  } finally { await database.close(); }
});
