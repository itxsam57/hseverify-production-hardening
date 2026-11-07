import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { spawnSync } from "node:child_process";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";
import { migrationStatus, rollbackLatestMigration } from "../../scripts/lib/migrations.mjs";

const runtime = process.env.HSE_BILLING_RUNTIME_DIST;
if (!runtime) {
  const wrapper = spawnSync(process.execPath, ["scripts/run-billing-tests.mjs"], {
    stdio: "inherit",
    env: { ...process.env, HSE_BILLING_TEST_WRAPPER: "1" }
  });
  assert.equal(wrapper.status, 0, "billing runtime wrapper failed");
  process.exit(0);
}
const domainModule = await import(pathToFileURL(join(runtime, "billing", "billing-domain.js")).href);
const providerModule = await import(pathToFileURL(join(runtime, "billing", "billing-provider.js")).href);
const serviceModule = await import(pathToFileURL(join(runtime, "billing", "billing-service.js")).href);
const { BillingAccessError, BillingConflictError, BillingInputError } = domainModule;
const { SandboxBillingProvider, signBillingWebhook } = providerModule;
const { BillingService } = serviceModule;

const MIGRATION = "0045_billing_subscriptions";
const NOW_DATE = new Date("2026-09-11T18:00:00.000Z");
const NOW = NOW_DATE.toISOString();
const FUTURE = "2099-01-01T00:00:00.000Z";
const SECRET = "m3-05-local-billing-webhook-secret-32-chars-minimum";
const ENV = {
  appEnvironment: "test", databaseDriver: "pglite", databaseUrl: null,
  pgliteDataDir: "memory://", releaseSha: "m3-05-billing-runtime-test",
  sessionSecret: "m3-05-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m3-05-auth-pepper-with-more-than-thirty-two-characters",
  authSandboxEnabled: false, authSandboxAccessKey: null,
  demoAuthEnabled: false, demoDataEnabled: false
};
const oid = (prefix, c) => `${prefix}_${c.repeat(24)}`;

async function db(withFunding=false) {
  const database = await openScriptDatabase(ENV);
  // Refund reservations share the live M2.01 funding/assurance schema;
  // keep historical 0045-only migration/rollback tests at their original ceiling.
  await applyMigrationsThrough(database, ENV.releaseSha,
    withFunding ? "0095_assessment_funding_notifications" : MIGRATION);
  return database;
}

async function seedCompany(database, c) {
  const company = {
    accountId: `account_m305_company_${c}`,
    tenantId: oid("tenant", c),
    membershipId: oid("membership", c),
    sessionId: `session_m305_company_${c}`,
    email: `company-m305-${c.toLowerCase()}@example.com`,
    displayName: `M305 Company ${c}`
  };
  await database.query(`INSERT INTO auth_accounts
    (account_id,email_normalized,display_name,account_status,password_hash,email_verified_at,password_set_at,created_at,updated_at)
    VALUES ($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [company.accountId,company.email,company.displayName,"scrypt$16384$8$1$salt$hash",NOW]);
  await database.query(`INSERT INTO auth_account_roles (account_id,role,created_at) VALUES ($1,'company',$2)`,[company.accountId,NOW]);
  await database.query(`INSERT INTO platform_tenants
    (tenant_id,tenant_type,display_name,tenant_status,created_by_account_id,created_at,updated_at,activated_at)
    VALUES ($1,'company',$2,'active',$3,$4,$4,$4)`,[company.tenantId,company.displayName,company.accountId,NOW]);
  await database.query(`INSERT INTO auth_tenant_memberships
    (membership_id,tenant_id,account_id,portal_role,membership_role,membership_status,created_by_account_id,created_at,updated_at,activated_at)
    VALUES ($1,$2,$3,'company','owner','active',$3,$4,$4,$4)`,[company.membershipId,company.tenantId,company.accountId,NOW]);
  await database.query(`INSERT INTO auth_sessions
    (session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,expires_at)
    VALUES ($1,$2,'company',$3,$4,$5,$5,$6)`,[company.sessionId,company.accountId,`m305-token-${c}`,`m305-csrf-${c}`,NOW,FUTURE]);
  return company;
}

function principal(company, permission) {
  return Object.freeze({
    accountId:company.accountId,sessionId:company.sessionId,activeRole:"company",accountStatus:"active",
    email:company.email,displayName:company.displayName,createdAt:NOW,lastSeenAt:NOW,expiresAt:FUTURE,
    tenantMembership:{tenantId:company.tenantId,tenantStatus:"active",membershipId:company.membershipId,role:"owner",status:"active",overrides:[]},
    authorizedTenantPermission:permission
  });
}

function event(input) {
  return JSON.stringify(input);
}

test("M3.05 checkout is tenant-scoped, provider-pending and idempotent", async () => {
  const database = await db();
  try {
    const a = await seedCompany(database, "A");
    const b = await seedCompany(database, "B");
    const service = new BillingService(database, new SandboxBillingProvider());
    const input = { idempotencyKey:"checkout-a-001", creditUnits:10, amountMinor:5000, currency:"USD" };
    const first = await service.createCreditCheckout(principal(a,"company.billing.manage"), input, NOW_DATE);
    const retry = await service.createCreditCheckout(principal(a,"company.billing.manage"), input, NOW_DATE);
    assert.equal(first.checkoutId, retry.checkoutId);
    assert.equal(first.status, "REQUIRES_PROVIDER");
    assert.equal(first.providerMode, "sandbox");
    assert.match(first.providerCheckoutReference, /^sandbox_checkout_/);

    const snapshotA = await service.snapshot(principal(a,"company.billing.read"));
    const snapshotB = await service.snapshot(principal(b,"company.billing.read"));
    assert.equal(snapshotA.checkouts.length, 1);
    assert.equal(snapshotA.invoices.length, 1);
    assert.equal(snapshotA.creditBalance, 0);
    assert.equal(snapshotB.checkouts.length, 0);
    await assert.rejects(
      service.createCreditCheckout(principal(a,"company.billing.read"), input, NOW_DATE),
      BillingAccessError
    );
  } finally { await database.close(); }
});

test("M3.05 billing foreign keys reject cross-tenant financial relationships", async () => {
  const database = await db();
  try {
    const a = await seedCompany(database, "N");
    const b = await seedCompany(database, "O");
    const timestamp = NOW;

    await database.query(`INSERT INTO billing_checkouts
      (checkout_id,tenant_id,idempotency_key,credit_units,amount_minor,currency,provider_mode,provider_checkout_reference,status,created_by_membership_id,created_at)
      VALUES($1,$2,$3,10,5000,'USD','sandbox',$4,'REQUIRES_PROVIDER',$5,$6)`,[
      "billing_checkout_cross_a_001",a.tenantId,"cross-checkout-a-001","sandbox_checkout_cross_a_001",a.membershipId,timestamp
    ]);
    await assert.rejects(database.query(`INSERT INTO billing_invoices
      (invoice_id,tenant_id,checkout_id,credit_units,amount_minor,currency,status,created_at,updated_at)
      VALUES($1,$2,$3,10,5000,'USD','OPEN',$4,$4)`,[
      "billing_invoice_cross_b_001",b.tenantId,"billing_checkout_cross_a_001",timestamp
    ]));

    await database.query(`INSERT INTO billing_checkouts
      (checkout_id,tenant_id,idempotency_key,credit_units,amount_minor,currency,provider_mode,provider_checkout_reference,status,created_by_membership_id,created_at)
      VALUES($1,$2,$3,10,5000,'USD','sandbox',$4,'REQUIRES_PROVIDER',$5,$6)`,[
      "billing_checkout_cross_b_001",b.tenantId,"cross-checkout-b-001","sandbox_checkout_cross_b_001",b.membershipId,timestamp
    ]);
    await database.query(`INSERT INTO billing_invoices
      (invoice_id,tenant_id,checkout_id,credit_units,amount_minor,currency,status,created_at,updated_at)
      VALUES($1,$2,$3,10,5000,'USD','OPEN',$4,$4)`,[
      "billing_invoice_cross_b_002",b.tenantId,"billing_checkout_cross_b_001",timestamp
    ]);
    await database.query(`INSERT INTO billing_checkouts
      (checkout_id,tenant_id,idempotency_key,credit_units,amount_minor,currency,provider_mode,provider_checkout_reference,status,created_by_membership_id,created_at)
      VALUES($1,$2,$3,10,5000,'USD','sandbox',$4,'REQUIRES_PROVIDER',$5,$6)`,[
      "billing_checkout_cross_a_002",a.tenantId,"cross-checkout-a-002","sandbox_checkout_cross_a_002",a.membershipId,timestamp
    ]);
    await database.query(`INSERT INTO billing_invoices
      (invoice_id,tenant_id,checkout_id,credit_units,amount_minor,currency,status,created_at,updated_at)
      VALUES($1,$2,$3,10,5000,'USD','OPEN',$4,$4)`,[
      "billing_invoice_cross_a_002",a.tenantId,"billing_checkout_cross_a_002",timestamp
    ]);

    await assert.rejects(database.query(`INSERT INTO billing_refunds
      (refund_id,tenant_id,invoice_id,idempotency_key,amount_minor,credit_units,currency,provider_mode,provider_refund_reference,status,created_by_membership_id,created_at)
      VALUES($1,$2,$3,$4,1000,2,'USD','sandbox',$5,'REQUIRES_PROVIDER',$6,$7)`,[
      "billing_refund_cross_b_001",b.tenantId,"billing_invoice_cross_a_002","cross-refund-b-001","sandbox_refund_cross_b_001",b.membershipId,timestamp
    ]));

    await database.query(`INSERT INTO billing_refunds
      (refund_id,tenant_id,invoice_id,idempotency_key,amount_minor,credit_units,currency,provider_mode,provider_refund_reference,status,created_by_membership_id,created_at)
      VALUES($1,$2,$3,$4,1000,2,'USD','sandbox',$5,'REQUIRES_PROVIDER',$6,$7)`,[
      "billing_refund_cross_a_002",a.tenantId,"billing_invoice_cross_a_002","cross-refund-a-002","sandbox_refund_cross_a_002",a.membershipId,timestamp
    ]);
    await database.query(`INSERT INTO billing_provider_events
      (provider_event_id,tenant_id,event_type,provider_reference,amount_minor,currency,payload_sha256,received_at)
      VALUES($1,$2,'payment.captured',$3,5000,'USD',$4,$5)`,[
      "provider-event-cross-b-001",b.tenantId,"sandbox_checkout_cross_b_001","1".repeat(64),timestamp
    ]);
    await database.query(`INSERT INTO billing_provider_events
      (provider_event_id,tenant_id,event_type,provider_reference,amount_minor,currency,payload_sha256,received_at)
      VALUES($1,$2,'payment.captured',$3,5000,'USD',$4,$5)`,[
      "provider-event-cross-b-002",b.tenantId,"sandbox_checkout_cross_b_001","2".repeat(64),timestamp
    ]);
    await database.query(`INSERT INTO billing_provider_events
      (provider_event_id,tenant_id,event_type,provider_reference,amount_minor,currency,payload_sha256,received_at)
      VALUES($1,$2,'payment.captured',$3,5000,'USD',$4,$5)`,[
      "provider-event-cross-a-001",a.tenantId,"sandbox_checkout_cross_a_002","3".repeat(64),timestamp
    ]);

    await assert.rejects(database.query(`INSERT INTO billing_credit_ledger
      (ledger_entry_id,tenant_id,invoice_id,refund_id,provider_event_id,entry_type,credit_delta,amount_minor,currency,occurred_at)
      VALUES($1,$2,$3,NULL,$4,'PURCHASE',10,5000,'USD',$5)`,[
      "billing_ledger_cross_b_invoice",b.tenantId,"billing_invoice_cross_a_002","provider-event-cross-b-001",timestamp
    ]));
    await assert.rejects(database.query(`INSERT INTO billing_credit_ledger
      (ledger_entry_id,tenant_id,invoice_id,refund_id,provider_event_id,entry_type,credit_delta,amount_minor,currency,occurred_at)
      VALUES($1,$2,$3,$4,$5,'REFUND',-2,1000,'USD',$6)`,[
      "billing_ledger_cross_b_refund",b.tenantId,"billing_invoice_cross_b_002","billing_refund_cross_a_002","provider-event-cross-b-002",timestamp
    ]));
    await assert.rejects(database.query(`INSERT INTO billing_credit_ledger
      (ledger_entry_id,tenant_id,invoice_id,refund_id,provider_event_id,entry_type,credit_delta,amount_minor,currency,occurred_at)
      VALUES($1,$2,$3,NULL,$4,'PURCHASE',10,5000,'USD',$5)`,[
      "billing_ledger_cross_b_event",b.tenantId,"billing_invoice_cross_b_002","provider-event-cross-a-001",timestamp
    ]));

    await database.query(`INSERT INTO billing_reconciliation_runs
      (reconciliation_run_id,tenant_id,status,created_by_membership_id,created_at)
      VALUES($1,$2,'CLEAN',$3,$4)`,["billing_reconciliation_cross_a",a.tenantId,a.membershipId,timestamp]);
    await assert.rejects(database.query(`INSERT INTO billing_reconciliation_items
      (reconciliation_item_id,reconciliation_run_id,tenant_id,code,reference,detail,created_at)
      VALUES($1,$2,$3,'CROSS_TENANT_TEST','cross-reference','cross-tenant relationship must fail',$4)`,[
      "billing_reconciliation_item_cross_b","billing_reconciliation_cross_a",b.tenantId,timestamp
    ]));
  } finally { await database.close(); }
});

test("M3.05 company subscription lifecycle is tenant-scoped, idempotent and audited", async () => {
  const database = await db();
  try {
    const a = await seedCompany(database, "P");
    const b = await seedCompany(database, "Q");
    const service = new BillingService(database, new SandboxBillingProvider());
    const manageA = principal(a,"company.billing.manage");
    const manageB = principal(b,"company.billing.manage");

    const started = await service.startSubscription(
      manageA,
      { idempotencyKey:"subscription-p-001", planCode:"standard" },
      NOW_DATE
    );
    const retry = await service.startSubscription(
      manageA,
      { idempotencyKey:"subscription-p-001", planCode:"standard" },
      NOW_DATE
    );
    assert.equal(retry.subscriptionId,started.subscriptionId);
    assert.equal(started.status,"ACTIVE");
    assert.equal(started.planCode,"standard");
    assert.equal(started.providerMode,"sandbox");
    assert.match(started.providerSubscriptionReference,/^sandbox_subscription_/);

    const activeSnapshot = await service.snapshot(principal(a,"company.billing.read"));
    assert.equal(activeSnapshot.activeSubscription?.subscriptionId,started.subscriptionId);
    assert.equal(activeSnapshot.activeSubscription?.planCode,"standard");
    assert.equal((await service.snapshot(principal(b,"company.billing.read"))).activeSubscription,null);

    await assert.rejects(
      service.cancelSubscription(manageB,{subscriptionId:started.subscriptionId},NOW_DATE),
      BillingAccessError
    );
    const cancelled = await service.cancelSubscription(
      manageA,
      {subscriptionId:started.subscriptionId},
      new Date("2026-09-11T18:30:00.000Z")
    );
    assert.equal(cancelled.status,"CANCELLED");
    assert.equal(cancelled.cancelledAt,"2026-09-11T18:30:00.000Z");
    const cancelledSnapshot = await service.snapshot(principal(a,"company.billing.read"));
    assert.equal(cancelledSnapshot.activeSubscription,null);
    assert.equal(cancelledSnapshot.subscriptions[0]?.status,"CANCELLED");

    const audit = await database.query(`SELECT action_key FROM platform_audit_events
      WHERE actor_tenant_id=$1 AND action_key LIKE 'billing.subscription.%' ORDER BY audit_sequence`,[a.tenantId]);
    assert.deepEqual(audit.rows.map((row)=>row.action_key),[
      "billing.subscription.started","billing.subscription.cancelled"
    ]);
  } finally { await database.close(); }
});

test("M3.05 verified provider capture credits exactly once and invalid/duplicate webhooks cannot double-credit", async () => {
  const database = await db();
  try {
    const company = await seedCompany(database, "C");
    const service = new BillingService(database, new SandboxBillingProvider());
    const checkout = await service.createCreditCheckout(
      principal(company,"company.billing.manage"),
      { idempotencyKey:"checkout-c-001", creditUnits:12, amountMinor:6000, currency:"USD" },
      NOW_DATE
    );
    const rawBody = event({
      id:"provider-event-capture-c-001", type:"payment.captured",
      checkoutReference:checkout.providerCheckoutReference, amountMinor:6000, currency:"USD"
    });
    await assert.rejects(
      service.ingestProviderWebhook({ rawBody, signature:"invalid", secret:SECRET, now:NOW_DATE }),
      BillingAccessError
    );
    assert.equal((await service.snapshot(principal(company,"company.billing.read"))).creditBalance, 0);

    const signature = signBillingWebhook(rawBody, SECRET);
    const first = await service.ingestProviderWebhook({ rawBody, signature, secret:SECRET, now:NOW_DATE });
    const duplicate = await service.ingestProviderWebhook({ rawBody, signature, secret:SECRET, now:NOW_DATE });
    assert.equal(first.processed, true);
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    const snapshot = await service.snapshot(principal(company,"company.billing.read"));
    assert.equal(snapshot.creditBalance, 12);
    assert.equal(snapshot.invoices[0]?.status, "PAID");
    assert.equal(snapshot.creditLedger.filter((item)=>item.entryType==="PURCHASE").length, 1);
  } finally { await database.close(); }
});

test("M3.05 provider event IDs are permanently bound to the original signed payload", async () => {
  const database = await db();
  try {
    const company = await seedCompany(database, "F");
    const service = new BillingService(database, new SandboxBillingProvider());
    const checkout = await service.createCreditCheckout(
      principal(company,"company.billing.manage"),
      { idempotencyKey:"checkout-f-001", creditUnits:10, amountMinor:5000, currency:"USD" },
      NOW_DATE
    );
    const original = event({
      id:"provider-event-capture-f-001", type:"payment.captured",
      checkoutReference:checkout.providerCheckoutReference, amountMinor:5000, currency:"USD"
    });
    await service.ingestProviderWebhook({
      rawBody:original, signature:signBillingWebhook(original,SECRET), secret:SECRET, now:NOW_DATE
    });

    const altered = event({
      id:"provider-event-capture-f-001", type:"payment.captured",
      checkoutReference:checkout.providerCheckoutReference, amountMinor:4500, currency:"USD"
    });
    await assert.rejects(
      service.ingestProviderWebhook({
        rawBody:altered, signature:signBillingWebhook(altered,SECRET), secret:SECRET, now:NOW_DATE
      }),
      BillingConflictError
    );
    const events = await database.query(
      `SELECT amount_minor,payload_sha256 FROM billing_provider_events WHERE provider_event_id=$1`,
      ["provider-event-capture-f-001"]
    );
    assert.equal(Number(events.rows[0]?.amount_minor),5000);
    assert.equal(events.rows.length,1);
    assert.equal((await service.snapshot(principal(company,"company.billing.read"))).creditBalance,10);
  } finally { await database.close(); }
});

test("M3.05 a new provider event ID for an already captured checkout is harmless and reconciliation stays clean", async () => {
  const database = await db();
  try {
    const company = await seedCompany(database, "M");
    const service = new BillingService(database, new SandboxBillingProvider());
    const manage = principal(company,"company.billing.manage");
    const checkout = await service.createCreditCheckout(
      manage,
      { idempotencyKey:"checkout-m-001", creditUnits:10, amountMinor:5000, currency:"USD" },
      NOW_DATE
    );
    for (const id of ["provider-event-capture-m-001","provider-event-capture-m-002"]) {
      const rawBody=event({id,type:"payment.captured",checkoutReference:checkout.providerCheckoutReference,amountMinor:5000,currency:"USD"});
      await service.ingestProviderWebhook({rawBody,signature:signBillingWebhook(rawBody,SECRET),secret:SECRET,now:NOW_DATE});
    }
    const run=await service.runReconciliation(manage,new Date("2026-09-11T18:07:00.000Z"));
    assert.equal(run.status,"CLEAN");
    const snapshot=await service.snapshot(principal(company,"company.billing.read"));
    assert.equal(snapshot.creditBalance,10);
    assert.equal(snapshot.creditLedger.filter((item)=>item.entryType==="PURCHASE").length,1);
    assert.equal((await database.query(`SELECT COUNT(*)::int AS count FROM billing_provider_events WHERE tenant_id=$1`,[company.tenantId])).rows[0].count,2);
  } finally { await database.close(); }
});

test("M3.05 refunds are bounded/idempotent and provider success preserves financial history", async () => {
  const database = await db(true);
  try {
    const company = await seedCompany(database, "D");
    const service = new BillingService(database, new SandboxBillingProvider());
    const manage = principal(company,"company.billing.manage");
    const read = principal(company,"company.billing.read");
    const checkout = await service.createCreditCheckout(manage,{idempotencyKey:"checkout-d-001",creditUnits:10,amountMinor:5000,currency:"USD"},NOW_DATE);
    const captureBody = event({id:"provider-event-capture-d-001",type:"payment.captured",checkoutReference:checkout.providerCheckoutReference,amountMinor:5000,currency:"USD"});
    await service.ingestProviderWebhook({rawBody:captureBody,signature:signBillingWebhook(captureBody,SECRET),secret:SECRET,now:NOW_DATE});
    const invoiceId = (await service.snapshot(read)).invoices[0].invoiceId;
    const refund = await service.requestRefund(manage,{invoiceId,idempotencyKey:"refund-d-001",amountMinor:2000},NOW_DATE);
    const retry = await service.requestRefund(manage,{invoiceId,idempotencyKey:"refund-d-001",amountMinor:2000},NOW_DATE);
    assert.equal(refund.refundId,retry.refundId);
    assert.equal(refund.status,"REQUIRES_PROVIDER");
    await assert.rejects(service.requestRefund(manage,{invoiceId,idempotencyKey:"refund-too-large",amountMinor:4000},NOW_DATE),BillingConflictError);
    await assert.rejects(service.requestRefund(manage,{invoiceId,idempotencyKey:"refund-not-divisible",amountMinor:750},NOW_DATE),BillingInputError);

    const refundBody = event({id:"provider-event-refund-d-001",type:"refund.succeeded",refundReference:refund.providerRefundReference,amountMinor:2000,currency:"USD"});
    await service.ingestProviderWebhook({rawBody:refundBody,signature:signBillingWebhook(refundBody,SECRET),secret:SECRET,now:new Date("2026-09-11T18:05:00.000Z")});
    await service.ingestProviderWebhook({rawBody:refundBody,signature:signBillingWebhook(refundBody,SECRET),secret:SECRET,now:new Date("2026-09-11T18:06:00.000Z")});
    const snapshot = await service.snapshot(read);
    assert.equal(snapshot.creditBalance,6);
    assert.equal(snapshot.invoices[0].status,"PARTIALLY_REFUNDED");
    assert.equal(snapshot.invoices[0].refundedAmountMinor,2000);
    assert.equal(snapshot.refunds[0].status,"SUCCEEDED");
    assert.equal(snapshot.creditLedger.filter((item)=>item.entryType==="REFUND").length,1);
  } finally { await database.close(); }
});

test("M3.05 idempotency keys cannot be reused with different financial data and tenants cannot refund each other's invoices", async () => {
  const database = await db(true);
  try {
    const a = await seedCompany(database,"G");
    const b = await seedCompany(database,"H");
    const service = new BillingService(database,new SandboxBillingProvider());
    const manageA = principal(a,"company.billing.manage");
    const manageB = principal(b,"company.billing.manage");
    const checkout = await service.createCreditCheckout(manageA,{idempotencyKey:"checkout-g-001",creditUnits:10,amountMinor:5000,currency:"USD"},NOW_DATE);
    await assert.rejects(
      service.createCreditCheckout(manageA,{idempotencyKey:"checkout-g-001",creditUnits:8,amountMinor:4000,currency:"USD"},NOW_DATE),
      BillingConflictError
    );
    const capture = event({id:"provider-event-capture-g-001",type:"payment.captured",checkoutReference:checkout.providerCheckoutReference,amountMinor:5000,currency:"USD"});
    await service.ingestProviderWebhook({rawBody:capture,signature:signBillingWebhook(capture,SECRET),secret:SECRET,now:NOW_DATE});
    const invoiceId=(await service.snapshot(principal(a,"company.billing.read"))).invoices[0].invoiceId;
    const refund=await service.requestRefund(manageA,{invoiceId,idempotencyKey:"refund-g-001",amountMinor:1000},NOW_DATE);
    await assert.rejects(
      service.requestRefund(manageA,{invoiceId,idempotencyKey:"refund-g-001",amountMinor:1500},NOW_DATE),
      BillingConflictError
    );
    await assert.rejects(
      service.requestRefund(manageB,{invoiceId,idempotencyKey:"refund-h-cross-tenant",amountMinor:1000},NOW_DATE),
      BillingAccessError
    );
    assert.equal(refund.amountMinor,1000);
  } finally { await database.close(); }
});

test("M3.05 concurrent refund reservations cannot over-refund an invoice", async () => {
  const database = await db(true);
  try {
    const company = await seedCompany(database,"I");
    const service = new BillingService(database,new SandboxBillingProvider());
    const manage = principal(company,"company.billing.manage");
    const checkout = await service.createCreditCheckout(manage,{idempotencyKey:"checkout-i-001",creditUnits:10,amountMinor:5000,currency:"USD"},NOW_DATE);
    const capture = event({id:"provider-event-capture-i-001",type:"payment.captured",checkoutReference:checkout.providerCheckoutReference,amountMinor:5000,currency:"USD"});
    await service.ingestProviderWebhook({rawBody:capture,signature:signBillingWebhook(capture,SECRET),secret:SECRET,now:NOW_DATE});
    const invoiceId=(await service.snapshot(principal(company,"company.billing.read"))).invoices[0].invoiceId;
    const results=await Promise.allSettled([
      service.requestRefund(manage,{invoiceId,idempotencyKey:"refund-i-001",amountMinor:3000},NOW_DATE),
      service.requestRefund(manage,{invoiceId,idempotencyKey:"refund-i-002",amountMinor:3000},NOW_DATE)
    ]);
    assert.equal(results.filter((result)=>result.status==="fulfilled").length,1);
    assert.equal(results.filter((result)=>result.status==="rejected" && result.reason instanceof BillingConflictError).length,1);
    const refunds=await database.query(`SELECT amount_minor FROM billing_refunds WHERE tenant_id=$1`,[company.tenantId]);
    assert.equal(refunds.rows.reduce((sum,row)=>sum+Number(row.amount_minor),0),3000);
  } finally { await database.close(); }
});

test("M3.05 provider amount/currency mismatches fail closed without financial mutation", async () => {
  const database = await db();
  try {
    const company=await seedCompany(database,"J");
    const service=new BillingService(database,new SandboxBillingProvider());
    const checkout=await service.createCreditCheckout(principal(company,"company.billing.manage"),{idempotencyKey:"checkout-j-001",creditUnits:10,amountMinor:5000,currency:"USD"},NOW_DATE);
    for (const [suffix,amountMinor,currency] of [["amount",4500,"USD"],["currency",5000,"EUR"]]) {
      const raw=event({id:`provider-event-capture-j-${suffix}`,type:"payment.captured",checkoutReference:checkout.providerCheckoutReference,amountMinor,currency});
      await assert.rejects(
        service.ingestProviderWebhook({rawBody:raw,signature:signBillingWebhook(raw,SECRET),secret:SECRET,now:NOW_DATE}),
        BillingConflictError
      );
    }
    const snapshot=await service.snapshot(principal(company,"company.billing.read"));
    assert.equal(snapshot.creditBalance,0);
    assert.equal(snapshot.checkouts[0].status,"REQUIRES_PROVIDER");
    assert.equal(snapshot.invoices[0].status,"OPEN");
    assert.equal((await database.query(`SELECT COUNT(*)::int AS count FROM billing_provider_events WHERE tenant_id=$1`,[company.tenantId])).rows[0].count,0);
  } finally { await database.close(); }
});

test("M3.05 reconciliation records discrepancies without silently rewriting immutable ledger/history", async () => {
  const database = await db();
  try {
    const company = await seedCompany(database, "E");
    const service = new BillingService(database, new SandboxBillingProvider());
    const manage = principal(company,"company.billing.manage");
    const checkout = await service.createCreditCheckout(manage,{idempotencyKey:"checkout-e-001",creditUnits:4,amountMinor:2000,currency:"USD"},NOW_DATE);
    const captureBody = event({id:"provider-event-capture-e-001",type:"payment.captured",checkoutReference:checkout.providerCheckoutReference,amountMinor:2000,currency:"USD"});
    await service.ingestProviderWebhook({rawBody:captureBody,signature:signBillingWebhook(captureBody,SECRET),secret:SECRET,now:NOW_DATE});
    await database.query(`DELETE FROM billing_credit_ledger WHERE tenant_id=$1`,[company.tenantId]).then(
      () => assert.fail("immutable credit ledger delete unexpectedly succeeded"),
      () => undefined
    );
    await database.query(`UPDATE billing_invoices SET status='OPEN' WHERE tenant_id=$1`,[company.tenantId]);
    await database.query(`INSERT INTO billing_provider_events(provider_event_id,tenant_id,event_type,provider_reference,amount_minor,currency,payload_sha256,received_at)
      VALUES($1,$2,'payment.captured',$3,2000,'USD',$4,$5)`,[
      "provider-event-orphan-e-001",company.tenantId,"sandbox_checkout_orphan_e_001","0".repeat(64),NOW
    ]);
    const run = await service.runReconciliation(manage,new Date("2026-09-11T18:10:00.000Z"));
    assert.equal(run.status,"DISCREPANCIES_FOUND");
    assert.ok(run.items.some((item)=>item.code==="PAID_CHECKOUT_INVOICE_MISMATCH"));
    assert.ok(run.items.some((item)=>item.code==="ORPHAN_PROVIDER_EVENT"));
    const invoice = await database.query(`SELECT status FROM billing_invoices WHERE tenant_id=$1`,[company.tenantId]);
    assert.equal(invoice.rows[0]?.status,"OPEN");
  } finally { await database.close(); }
});

test("M3.05 reconciliation detects refund, provider-event and credit-ledger inconsistencies without repairing them", async () => {
  const database=await db(true);
  try {
    const company=await seedCompany(database,"K");
    const service=new BillingService(database,new SandboxBillingProvider());
    const manage=principal(company,"company.billing.manage");
    const read=principal(company,"company.billing.read");
    const checkout=await service.createCreditCheckout(manage,{idempotencyKey:"checkout-k-001",creditUnits:10,amountMinor:5000,currency:"USD"},NOW_DATE);
    const capture=event({id:"provider-event-capture-k-001",type:"payment.captured",checkoutReference:checkout.providerCheckoutReference,amountMinor:5000,currency:"USD"});
    await service.ingestProviderWebhook({rawBody:capture,signature:signBillingWebhook(capture,SECRET),secret:SECRET,now:NOW_DATE});
    const invoiceId=(await service.snapshot(read)).invoices[0].invoiceId;
    const refund=await service.requestRefund(manage,{invoiceId,idempotencyKey:"refund-k-001",amountMinor:1000},NOW_DATE);
    const refundEvent=event({id:"provider-event-refund-k-001",type:"refund.succeeded",refundReference:refund.providerRefundReference,amountMinor:1000,currency:"USD"});
    await service.ingestProviderWebhook({rawBody:refundEvent,signature:signBillingWebhook(refundEvent,SECRET),secret:SECRET,now:NOW_DATE});
    await database.query(`UPDATE billing_invoices SET refunded_amount_minor=0,status='PAID' WHERE tenant_id=$1 AND invoice_id=$2`,[company.tenantId,invoiceId]);
    const run=await service.runReconciliation(manage,new Date("2026-09-11T18:20:00.000Z"));
    assert.equal(run.status,"DISCREPANCIES_FOUND");
    assert.ok(run.items.some((item)=>item.code==="REFUND_TOTAL_MISMATCH"));
    assert.ok(run.items.some((item)=>item.code==="CREDIT_LEDGER_HISTORY_MISMATCH"));
    const after=await database.query(`SELECT refunded_amount_minor,status FROM billing_invoices WHERE tenant_id=$1 AND invoice_id=$2`,[company.tenantId,invoiceId]);
    assert.equal(Number(after.rows[0].refunded_amount_minor),0);
    assert.equal(after.rows[0].status,"PAID");
  } finally { await database.close(); }
});

test("M3.05 monotonic rollback/reapply retains financial history", async () => {
  const database=await db();
  const previous=process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK="true";
  try {
    const company=await seedCompany(database,"L");
    const service=new BillingService(database,new SandboxBillingProvider());
    const checkout=await service.createCreditCheckout(principal(company,"company.billing.manage"),{idempotencyKey:"checkout-l-001",creditUnits:6,amountMinor:3000,currency:"USD"},NOW_DATE);
    const capture=event({id:"provider-event-capture-l-001",type:"payment.captured",checkoutReference:checkout.providerCheckoutReference,amountMinor:3000,currency:"USD"});
    await service.ingestProviderWebhook({rawBody:capture,signature:signBillingWebhook(capture,SECRET),secret:SECRET,now:NOW_DATE});
    assert.equal(await rollbackLatestMigration(database,ENV),MIGRATION);
    assert.equal((await database.query(`SELECT COUNT(*)::int AS count FROM billing_credit_ledger WHERE tenant_id=$1`,[company.tenantId])).rows[0].count,1);
    assert.deepEqual(await applyMigrationsThrough(database,"m3-05-reapply",MIGRATION),[MIGRATION]);
    assert.equal((await database.query(`SELECT COUNT(*)::int AS count FROM billing_credit_ledger WHERE tenant_id=$1`,[company.tenantId])).rows[0].count,1);
    const status=await migrationStatus(database);
    const owned=status.find((entry)=>entry.id===MIGRATION);
    assert.equal(owned?.applied,true);
    assert.equal(owned?.checksumMatches,true);
  } finally {
    if(previous===undefined)delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=previous;
    await database.close();
  }
});

test("M3.05 Company Billing UI and webhook boundary are wired and label sandbox state truthfully", async () => {
  const [page, actions, route, shell, navigation, copy] = await Promise.all([
    readFile(join(process.cwd(),"src/app/company/(portal)/billing/page.tsx"),"utf8"),
    readFile(join(process.cwd(),"src/app/company/(portal)/billing/actions.ts"),"utf8"),
    readFile(join(process.cwd(),"src/app/api/billing/webhook/route.ts"),"utf8"),
    readFile(join(process.cwd(),"src/components/auth/role-portal-shell.tsx"),"utf8"),
    readFile(join(process.cwd(),"src/components/auth/role-navigation.tsx"),"utf8"),
    readFile(join(process.cwd(),"src/config/product-copy.ts"),"utf8")
  ]);
  for (const marker of ["Company billing","Sandbox billing mode","Company credits","Invoices","Refunds","Reconciliation"]) assert.match(page,new RegExp(marker));
  assert.match(actions,/company\.billing\.manage/);
  assert.match(actions,/createCreditCheckout/);
  assert.match(actions,/requestRefund/);
  assert.match(actions,/runReconciliation/);
  assert.match(route,/HSE_BILLING_WEBHOOK_SECRET/);
  assert.match(route,/ingestProviderWebhook/);
  assert.match(`${shell}\n${navigation}`,/\/company\/billing/);
  assert.match(copy,/src\/lib\/billing\/billing-provider\.ts/);
  assert.match(copy,/sandbox/i);
});
