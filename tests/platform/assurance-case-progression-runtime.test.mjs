import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import ts from "typescript";

import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "assurance-case-progression-runtime",
  sessionSecret: "assurance-progression-session-secret-2026-000000000",
  authPepper: "assurance-progression-auth-pepper-2026-00000000000",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

async function loadProgressionRuntime() {
  const out = mkdtempSync(resolve(tmpdir(), "hse-assurance-progression-"));
  const files = [
    "src/lib/auth/auth-domain.ts",
    "src/lib/assurance/assurance-order-domain.ts",
    "src/lib/assurance/assurance-order-repository.ts",
    "src/lib/interview/interview-scheduling-domain.ts",
    "src/lib/interview/interview-scheduling-repository.ts",
    "src/lib/interview/interview-scheduling-service.ts",
    "src/lib/assurance/assurance-case-progression-service.ts"
  ];
  for (const sourceFile of files) {
    const source = readFileSync(sourceFile, "utf8").replace(/^import "server-only";\n?/, "");
    const output = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    const target = resolve(out, sourceFile.replace(/^src\//, "").replace(/\.ts$/, ".js"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, output);
  }
  const assignmentShim = resolve(out, "lib/interview/interview-assignment-service.js");
  mkdirSync(dirname(assignmentShim), { recursive: true });
  writeFileSync(
    assignmentShim,
    `class InterviewAssignmentService {
  constructor(database) { this.database = database; }
  async evaluateAndPersist() {
    throw new Error("Interview assignment must not run in PASS/FAIL recommendation progression tests.");
  }
}
module.exports = { InterviewAssignmentService };
`
  );
  return import(
    `file://${resolve(out, "lib/assurance/assurance-case-progression-service.js")}`
  );
}

async function seedInterviewPendingCase(database, suffix) {
  const tenantId = `tenant_${suffix.padEnd(24, "a").slice(0, 24)}`;
  const orderId = `assurance_order_${suffix.padEnd(24, "b").slice(0, 24)}`;
  const targetId = `assurance_target_${suffix.padEnd(24, "c").slice(0, 24)}`;
  const caseId = `assurance_case_${suffix.padEnd(24, "d").slice(0, 24)}`;
  const now = "2026-09-25T11:00:00.000Z";

  await database.query(
    `INSERT INTO assurance_orders(
       order_id,tenant_id,created_by_membership_id,order_name,order_reference,
       order_status,submitted_at,created_at,updated_at
     ) VALUES($1,$2,'membership_progression_owner','Progression order',$3,
       'ACTIVE',$4,$4,$4)`,
    [orderId, tenantId, `PROGRESSION-${suffix}`, now]
  );
  await database.query(
    `INSERT INTO assurance_order_workers(
       target_id,order_id,tenant_id,worker_link_id,worker_account_id,
       permanent_worker_id,funding_method,target_status,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$6,'company','submitted',$7,$7)`,
    [
      targetId,
      orderId,
      tenantId,
      `worker_link_${suffix.padEnd(20, "e").slice(0, 20)}`,
      `worker_account_${suffix.padEnd(20, "f").slice(0, 20)}`,
      `worker_id_${suffix.padEnd(24, "g").slice(0, 24)}`,
      now
    ]
  );
  await database.query(
    `INSERT INTO assurance_cases(
       case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,
       permanent_worker_id,case_status,owner_kind,next_action,
       interview_reference,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,'Interview pending','assessor',
       'Assigned assessor must schedule and complete the required interview.',
       $8,$9,$9)`,
    [
      caseId,
      orderId,
      targetId,
      tenantId,
      `worker_link_${suffix.padEnd(20, "e").slice(0, 20)}`,
      `worker_account_${suffix.padEnd(20, "f").slice(0, 20)}`,
      `worker_id_${suffix.padEnd(24, "g").slice(0, 24)}`,
      `interview_request_${suffix.padEnd(24, "i").slice(0, 24)}`,
      now
    ]
  );
  await database.query(
    `INSERT INTO assurance_action_items(
       action_id,tenant_id,order_id,case_id,worker_account_id,severity,reason,
       owner_kind,allowed_action,deep_link,statutory,action_status,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,'warning',
       'Assigned assessor must schedule and complete the required interview.',
       'assessor','open_case',$6,false,'open',$7,$7)`,
    [
      `assurance_action_${suffix.padEnd(24, "j").slice(0, 24)}`,
      tenantId,
      orderId,
      caseId,
      `worker_account_${suffix.padEnd(20, "f").slice(0, 20)}`,
      `/company/assurance-orders/${orderId}#${caseId}`,
      now
    ]
  );
  return { tenantId, orderId, caseId };
}

test("PASS interview recommendation moves the case to Decision pending and Admin ownership", async () => {
  const database = await openScriptDatabase(ENV);
  try {
    await applyMigrationsThrough(
      database,
      ENV.releaseSha,
      "0067_assessment_review_orchestration"
    );
    const { tenantId, caseId } = await seedInterviewPendingCase(database, "pass");
    const { advanceAfterInterviewRecommendation } = await loadProgressionRuntime();

    await advanceAfterInterviewRecommendation(database, {
      caseId,
      tenantId,
      recommendation: "PASS",
      actor: { accountId: "assessor_account_progression", role: "assessor" },
      now: new Date("2026-09-25T11:05:00.000Z")
    });

    const row = (
      await database.query(
        `SELECT case_status,owner_kind,next_action
           FROM assurance_cases
          WHERE case_id=$1 AND tenant_id=$2`,
        [caseId, tenantId]
      )
    ).rows[0];
    assert.equal(row.case_status, "Decision pending");
    assert.equal(row.owner_kind, "admin");
    assert.match(row.next_action, /final Assurance Case decision/i);

    const actions = await database.query(
      `SELECT owner_kind,reason,action_status
         FROM assurance_action_items
        WHERE case_id=$1
        ORDER BY created_at,action_id`,
      [caseId]
    );
    assert.equal(actions.rows[0].action_status, "resolved");
    assert.equal(actions.rows.at(-1).owner_kind, "admin");
    assert.equal(actions.rows.at(-1).action_status, "open");

    const timeline = await database.query(
      `SELECT event_type,from_status,to_status,actor_role
         FROM assurance_case_timeline_events
        WHERE case_id=$1
        ORDER BY occurred_at DESC
        LIMIT 1`,
      [caseId]
    );
    assert.equal(timeline.rows[0].event_type, "interview_recommendation_submitted");
    assert.equal(timeline.rows[0].from_status, "Interview pending");
    assert.equal(timeline.rows[0].to_status, "Decision pending");
    assert.equal(timeline.rows[0].actor_role, "assessor");
  } finally {
    await database.close();
  }
});

test("FAIL interview recommendation moves the case to Reassessment required", async () => {
  const database = await openScriptDatabase({
    ...ENV,
    releaseSha: "assurance-case-progression-fail-runtime"
  });
  try {
    await applyMigrationsThrough(
      database,
      "assurance-case-progression-fail-runtime",
      "0067_assessment_review_orchestration"
    );
    const { tenantId, caseId } = await seedInterviewPendingCase(database, "fail");
    const { advanceAfterInterviewRecommendation } = await loadProgressionRuntime();

    await advanceAfterInterviewRecommendation(database, {
      caseId,
      tenantId,
      recommendation: "FAIL",
      actor: { accountId: "assessor_account_progression", role: "assessor" },
      now: new Date("2026-09-25T11:05:00.000Z")
    });

    const row = (
      await database.query(
        `SELECT case_status,owner_kind,next_action
           FROM assurance_cases
          WHERE case_id=$1 AND tenant_id=$2`,
        [caseId, tenantId]
      )
    ).rows[0];
    assert.equal(row.case_status, "Reassessment required");
    assert.equal(row.owner_kind, "worker");
    assert.match(row.next_action, /reassessment/i);
  } finally {
    await database.close();
  }
});
