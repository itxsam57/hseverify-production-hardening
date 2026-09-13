import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_ASSURANCE_ORDER_RUNTIME_DIST;
assert.ok(runtime, "HSE_ASSURANCE_ORDER_RUNTIME_DIST is required");
const analyticsModule = await import(
  pathToFileURL(join(runtime, "assurance", "company-action-centre-analytics-service.js")).href
);
const { CompanyActionCentreAnalyticsService } = analyticsModule;

const MIGRATION = "0033_assurance_order_case_engine";
const NOW = new Date("2026-09-11T12:00:00.000Z");
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m3-04-company-action-centre-analytics",
  sessionSecret: "m3-04-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m3-04-auth-pepper-with-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const id = (prefix, c) => `${prefix}_${c.repeat(24)}`;
const tenant = (c) => id("tenant", c);

function principal(tenantId, c) {
  return Object.freeze({
    accountId: `account_m304_${c}`,
    sessionId: `session_m304_${c}`,
    activeRole: "company",
    accountStatus: "active",
    email: `company-m304-${c.toLowerCase()}@example.com`,
    displayName: `M304 Company ${c}`,
    createdAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString(),
    expiresAt: "2099-01-01T00:00:00.000Z",
    tenantMembership: {
      tenantId,
      tenantStatus: "active",
      membershipId: id("membership", c),
      role: "owner",
      status: "active",
      overrides: []
    },
    authorizedTenantPermission: "company.orders.read"
  });
}

async function database() {
  const db = await openScriptDatabase(ENV);
  await applyMigrationsThrough(db, ENV.releaseSha, MIGRATION);
  return db;
}

async function seedCase(db, input) {
  const orderId = id("assurance_order", input.key);
  const targetId = id("assurance_target", input.key);
  const caseId = id("assurance_case", input.key);
  const workerAccountId = `account_m304_worker_${input.key}`;
  const terminal = ["Approved", "Conditionally approved", "Rejected", "Closed"].includes(input.status);
  await db.query(
    `INSERT INTO assurance_orders
      (order_id,tenant_id,created_by_membership_id,order_name,order_reference,site_id,department_id,
       requested_identity_checks,requested_evidence_checks,assessment_framework_references,credential_target,
       order_status,submitted_at,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,$8,'SUBMITTED',$9,$9,$9)`,
    [
      orderId,
      input.tenantId,
      id("membership", input.key),
      `Order ${input.key}`,
      `M304-${input.key}`,
      input.siteId ?? null,
      input.departmentId ?? null,
      input.credentialTarget ?? null,
      NOW.toISOString()
    ]
  );
  await db.query(
    `INSERT INTO assurance_order_workers
      (target_id,order_id,tenant_id,worker_link_id,worker_account_id,site_id,department_id,funding_method,target_status,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'company','submitted',$8,$8)`,
    [
      targetId,
      orderId,
      input.tenantId,
      `company_worker_link_${input.key.repeat(24)}`,
      workerAccountId,
      input.workerSiteId ?? null,
      input.workerDepartmentId ?? null,
      NOW.toISOString()
    ]
  );
  await db.query(
    `INSERT INTO assurance_cases
      (case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,case_status,owner_kind,next_action,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
    [
      caseId,
      orderId,
      targetId,
      input.tenantId,
      `company_worker_link_${input.key.repeat(24)}`,
      workerAccountId,
      input.status,
      terminal ? null : input.owner ?? "worker",
      terminal ? null : input.nextAction ?? "Complete the current assurance step.",
      NOW.toISOString()
    ]
  );
  if (input.actionOwner) {
    const due = input.overdue ? "2026-09-10T12:00:00.000Z" : "2026-09-12T12:00:00.000Z";
    await db.query(
      `INSERT INTO assurance_action_items
        (action_id,tenant_id,order_id,case_id,worker_account_id,severity,reason,due_at,owner_kind,
         allowed_action,deep_link,statutory,action_status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'warning',$6,$7,$8,'open_case',$9,false,'open',$10,$10)`,
      [
        id("assurance_action", input.key),
        input.tenantId,
        orderId,
        caseId,
        workerAccountId,
        `Action ${input.key}`,
        due,
        input.actionOwner,
        `/company/assurance-orders/${orderId}#${caseId}`,
        NOW.toISOString()
      ]
    );
  }
}

test("M3.04 projects live workflow, approvals, readiness and competency gaps inside the trusted tenant", async () => {
  const db = await database();
  try {
    const tenantA = tenant("A");
    const tenantB = tenant("B");
    const siteNorth = id("site", "N");
    const departmentOps = id("department", "O");

    await seedCase(db, {
      key: "A", tenantId: tenantA, status: "Approved", siteId: siteNorth,
      departmentId: departmentOps, credentialTarget: "Forklift L2", actionOwner: null
    });
    await seedCase(db, {
      key: "B", tenantId: tenantA, status: "Review pending", owner: "reviewer", siteId: siteNorth,
      departmentId: departmentOps, credentialTarget: "Forklift L2", actionOwner: "company", overdue: true
    });
    await seedCase(db, {
      key: "C", tenantId: tenantA, status: "Conditionally approved", siteId: siteNorth,
      departmentId: departmentOps, credentialTarget: "Confined Space", actionOwner: "worker"
    });
    await seedCase(db, {
      key: "D", tenantId: tenantB, status: "Rejected", credentialTarget: "Forklift L2",
      actionOwner: "company", overdue: true
    });

    const snapshot = await new CompanyActionCentreAnalyticsService(db).snapshot(principal(tenantA, "A"), NOW);

    assert.equal(snapshot.summary.totalOrders, 3);
    assert.equal(snapshot.summary.activeOrders, 3);
    assert.equal(snapshot.summary.activeCases, 3);
    assert.equal(snapshot.summary.companyApprovalsRequired, 1);
    assert.equal(snapshot.summary.overdueActions, 1);
    assert.deepEqual(snapshot.workflowStages, [
      { status: "Approved", count: 1 },
      { status: "Conditionally approved", count: 1 },
      { status: "Review pending", count: 1 }
    ]);
    assert.deepEqual(snapshot.pendingOwners, [{ owner: "reviewer", count: 1 }]);
    assert.equal(snapshot.siteReadiness.length, 1);
    assert.deepEqual(snapshot.siteReadiness[0], {
      scopeId: siteNorth,
      scopeName: siteNorth,
      total: 3,
      assured: 2,
      conditional: 1,
      attention: 0,
      inProgress: 1,
      readinessPercent: 67
    });
    assert.equal(snapshot.departmentReadiness[0]?.scopeId, departmentOps);
    assert.deepEqual(snapshot.competencyGaps, [
      { credentialTarget: "Confined Space", total: 1, assured: 1, gap: 0, gapPercent: 0 },
      { credentialTarget: "Forklift L2", total: 2, assured: 1, gap: 1, gapPercent: 50 }
    ]);
  } finally {
    await db.close();
  }
});

test("M3.04 excludes cancelled/closed work from live readiness and fails closed on the wrong permission", async () => {
  const db = await database();
  try {
    const tenantA = tenant("E");
    await seedCase(db, { key: "E", tenantId: tenantA, status: "Closed", credentialTarget: "Rigging" });
    await db.query(`UPDATE assurance_orders SET order_status='CANCELLED',cancelled_at=$2 WHERE tenant_id=$1`, [tenantA, NOW.toISOString()]);
    const service = new CompanyActionCentreAnalyticsService(db);
    const snapshot = await service.snapshot(principal(tenantA, "E"), NOW);
    assert.equal(snapshot.summary.totalOrders, 1);
    assert.equal(snapshot.summary.activeOrders, 0);
    assert.equal(snapshot.summary.activeCases, 0);
    assert.deepEqual(snapshot.siteReadiness, []);
    assert.deepEqual(snapshot.competencyGaps, []);

    const wrong = Object.freeze({ ...principal(tenantA, "E"), authorizedTenantPermission: "company.tenant.read" });
    await assert.rejects(service.snapshot(wrong, NOW), /access/i);
  } finally {
    await db.close();
  }
});

test("M3.04 Company Action Centre UI is wired to the live analytics projection", async () => {
  const [page, panel] = await Promise.all([
    readFile(join(process.cwd(), "src/app/company/(portal)/action-centre/page.tsx"), "utf8"),
    readFile(join(process.cwd(), "src/components/company/company-action-centre-analytics.tsx"), "utf8")
  ]);

  assert.match(page, /CompanyActionCentreAnalyticsService/);
  assert.match(page, /CompanyActionCentreAnalyticsPanel/);
  assert.match(page, /Promise\.all/);

  for (const visibleContract of [
    "Live Company assurance summary",
    "Live workflow status",
    "Site readiness",
    "Department readiness",
    "Competency gaps",
    "Company approvals",
    "Overdue actions"
  ]) {
    assert.match(panel, new RegExp(visibleContract));
  }
});
