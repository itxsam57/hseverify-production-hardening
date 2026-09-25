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
  releaseSha: "decision-assurance-progression-runtime",
  sessionSecret: "decision-assurance-session-secret-2026-000000000",
  authPepper: "decision-assurance-auth-pepper-2026-00000000000",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

async function loadRepository() {
  const out = mkdtempSync(resolve(tmpdir(), "hse-decision-assurance-"));
  for (const sourceFile of [
    "src/lib/auth/auth-domain.ts",
    "src/lib/decision/decision-engine-domain.ts",
    "src/lib/decision/decision-engine-repository.ts"
  ]) {
    let source = readFileSync(sourceFile, "utf8").replace(/^import "server-only";\n?/, "");
    const output = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText;
    const target = resolve(out, sourceFile.replace(/^src\//, "").replace(/\.ts$/, ".js"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, output);
  }
  const dbTarget = resolve(out, "lib/database/database.js");
  mkdirSync(dirname(dbTarget), { recursive: true });
  writeFileSync(
    dbTarget,
    "module.exports={getDatabaseClient:async()=>{throw new Error('test injects database')}};"
  );
  return {
    repository: await import(`file://${resolve(out, "lib/decision/decision-engine-repository.js")}`),
    domain: await import(`file://${resolve(out, "lib/decision/decision-engine-domain.js")}`)
  };
}

async function seedDecisionPendingCase(database) {
  const tenantId = "tenant_aaaaaaaaaaaaaaaaaaaaaaaa";
  const orderId = "assurance_order_bbbbbbbbbbbbbbbbbbbbbbbb";
  const targetId = "assurance_target_cccccccccccccccccccccccc";
  const caseId = "assurance_case_dddddddddddddddddddddddd";
  const now = "2026-09-25T10:00:00.000Z";

  await database.query(
    `INSERT INTO assurance_orders(
       order_id,tenant_id,created_by_membership_id,order_name,order_reference,
       order_status,submitted_at,created_at,updated_at
     ) VALUES($1,$2,'membership_acceptance_owner','Decision progression order','DECISION-RUNTIME-1',
       'SUBMITTED',$3,$3,$3)`,
    [orderId, tenantId, now]
  );
  await database.query(
    `INSERT INTO assurance_order_workers(
       target_id,order_id,tenant_id,worker_link_id,worker_account_id,
       permanent_worker_id,funding_method,target_status,created_at,updated_at
     ) VALUES($1,$2,$3,'worker_link_acceptance_01','worker_account_acceptance_01',
       'worker_id_acceptance_000001','company','submitted',$4,$4)`,
    [targetId, orderId, tenantId, now]
  );
  await database.query(
    `INSERT INTO assurance_cases(
       case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,
       permanent_worker_id,case_status,owner_kind,next_action,created_at,updated_at
     ) VALUES($1,$2,$3,$4,'worker_link_acceptance_01','worker_account_acceptance_01',
       'worker_id_acceptance_000001','Decision pending','admin',
       'Record the final Assurance Case decision.',$5,$5)`,
    [caseId, orderId, targetId, tenantId, now]
  );
  await database.query(
    `INSERT INTO assurance_action_items(
       action_id,tenant_id,order_id,case_id,worker_account_id,severity,reason,
       owner_kind,allowed_action,deep_link,statutory,action_status,created_at,updated_at
     ) VALUES('assurance_action_eeeeeeeeeeeeeeeeeeeeeeee',$1,$2,$3,
       'worker_account_acceptance_01','warning','Record the final decision.','admin',
       'open_case',$4,false,'open',$5,$5)`,
    [tenantId, orderId, caseId, `/company/assurance-orders/${orderId}#${caseId}`, now]
  );
  return { tenantId, orderId, caseId };
}

test("Admin final decision atomically progresses Assurance Case and parent order", async () => {
  const database = await openScriptDatabase(ENV);
  try {
    await applyMigrationsThrough(
      database,
      ENV.releaseSha,
      "0067_assessment_review_orchestration"
    );
    const { tenantId, orderId, caseId } = await seedDecisionPendingCase(database);
    const { repository, domain } = await loadRepository();
    const { DecisionRepository } = repository;
    const { createDecision } = domain;
    const decision = createDecision({
      tenantId,
      caseId,
      state: "APPROVED",
      reasonCode: "acceptance_complete",
      explanation: "All required assurance stages are complete.",
      ruleVersion: "runtime-v1",
      inputReferences: ["assessment-runtime", "interview-runtime"],
      createdAt: "2026-09-25T10:05:00.000Z"
    });

    await new DecisionRepository(Promise.resolve(database)).saveDecisionAndProgressCase(
      decision,
      "admin_account_acceptance_01"
    );

    const caseRow = (
      await database.query(
        `SELECT case_status,owner_kind,next_action,decision_reference,closed_at
           FROM assurance_cases
          WHERE case_id=$1 AND tenant_id=$2`,
        [caseId, tenantId]
      )
    ).rows[0];
    assert.equal(caseRow.case_status, "Approved");
    assert.equal(caseRow.owner_kind, null);
    assert.equal(caseRow.next_action, null);
    assert.equal(caseRow.decision_reference, decision.decisionId);
    assert.ok(caseRow.closed_at);

    const order = (
      await database.query(
        "SELECT order_status FROM assurance_orders WHERE order_id=$1 AND tenant_id=$2",
        [orderId, tenantId]
      )
    ).rows[0];
    assert.equal(order.order_status, "COMPLETED");

    const actions = await database.query(
      "SELECT action_status FROM assurance_action_items WHERE case_id=$1",
      [caseId]
    );
    assert.deepEqual(actions.rows.map((row) => row.action_status), ["resolved"]);

    const timeline = await database.query(
      `SELECT event_type,from_status,to_status,actor_account_id,actor_role
         FROM assurance_case_timeline_events
        WHERE case_id=$1
        ORDER BY occurred_at DESC
        LIMIT 1`,
      [caseId]
    );
    assert.equal(timeline.rows[0].event_type, "decision_recorded");
    assert.equal(timeline.rows[0].from_status, "Decision pending");
    assert.equal(timeline.rows[0].to_status, "Approved");
    assert.equal(timeline.rows[0].actor_account_id, "admin_account_acceptance_01");
    assert.equal(timeline.rows[0].actor_role, "admin");
  } finally {
    await database.close();
  }
});

test("Decision override keeps platform decision and Assurance Case lifecycle aligned", async () => {
  const database = await openScriptDatabase({ ...ENV, releaseSha: "decision-override-progression-runtime" });
  try {
    await applyMigrationsThrough(
      database,
      "decision-override-progression-runtime",
      "0067_assessment_review_orchestration"
    );
    const { tenantId, caseId } = await seedDecisionPendingCase(database);
    const { repository, domain } = await loadRepository();
    const { DecisionRepository } = repository;
    const { createDecision, createManualDecisionOverride } = domain;
    const repo = new DecisionRepository(Promise.resolve(database));
    const decision = createDecision({
      tenantId,
      caseId,
      state: "APPROVED",
      reasonCode: "acceptance_complete",
      explanation: "Initial approval.",
      ruleVersion: "runtime-v1",
      inputReferences: ["evidence-runtime"],
      createdAt: "2026-09-25T10:05:00.000Z"
    });
    await repo.saveDecisionAndProgressCase(decision, "admin_account_acceptance_01");

    const override = createManualDecisionOverride({
      decisionId: decision.decisionId,
      tenantId,
      previousState: "APPROVED",
      newState: "SUSPENDED",
      reason: "New safety concern requires controlled review.",
      evidenceReference: "evidence_new_concern",
      confirmed: true,
      mfaVerifiedAt: "2026-09-25T10:10:00.000Z",
      notificationRequired: true,
      actorReference: "admin_account_acceptance_01",
      createdAt: "2026-09-25T10:10:00.000Z"
    });
    await repo.persistOverride(override);

    const decisionRow = (
      await database.query(
        "SELECT state FROM platform_decisions WHERE decision_id=$1 AND tenant_id=$2",
        [decision.decisionId, tenantId]
      )
    ).rows[0];
    assert.equal(decisionRow.state, "SUSPENDED");

    const caseRow = (
      await database.query(
        `SELECT case_status,owner_kind,next_action,closed_at
           FROM assurance_cases
          WHERE case_id=$1 AND tenant_id=$2`,
        [caseId, tenantId]
      )
    ).rows[0];
    assert.equal(caseRow.case_status, "Suspended");
    assert.equal(caseRow.owner_kind, "admin");
    assert.match(caseRow.next_action, /suspended Assurance Case/i);
    assert.equal(caseRow.closed_at, null);
  } finally {
    await database.close();
  }
});
