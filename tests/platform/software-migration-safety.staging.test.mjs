import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { seedWorkerPrincipal } from "../helpers/assessment-attempt-fixture.mjs";
import { seedCredentialDecisionFixture } from "../helpers/credential-decision-fixture.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyPendingMigrations, listMigrations, rollbackLatestMigration } from "../../scripts/lib/migrations.mjs";

test("isolated PostgreSQL applies migrations atomically and refuses a checksum mismatch and production rollback", { timeout: 90000 }, async () => {
  const path = await realpath(process.env.HSE_SOFTWARE_STAGE_CONFIG);
  const config = JSON.parse(await readFile(path, "utf8"));
  assert.equal(config.syntheticOnly, true);
  assert.equal(dirname(path), config.privateRoot);
  assert.ok(config.privateRoot.startsWith(resolve(config.projectRoot, "..") + "/hse-https-stage."));
  const url = new URL(config.applicationEnvironment.DATABASE_URL);
  assert.equal(url.hostname, "127.0.0.1");

  const name = "migration_drill_" + randomBytes(8).toString("hex");
  const admin = await openScriptDatabase({ databaseDriver: "postgres", databaseUrl: url.href });
  let database;
  let created = false;
  const oldAcknowledgement = process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
  try {
    await admin.execute('CREATE DATABASE "' + name + '"');
    created = true;
    url.pathname = "/" + name;
    database = await openScriptDatabase({ databaseDriver: "postgres", databaseUrl: url.href });
    const migrations = await listMigrations();
    const readHistory = async () => (await database.query("SELECT * FROM hse_schema_migrations ORDER BY migration_id")).rows;
    let appliedSchemaInsideFailedTransaction = false;
    const interrupted = {
      execute: (...args) => database.execute(...args),
      query: (...args) => database.query(...args),
      transaction: operation => database.transaction(tx => operation({
        execute: (...args) => tx.execute(...args),
        query: async (sql, params) => {
          if (sql.includes("INSERT INTO hse_schema_migrations")) {
            appliedSchemaInsideFailedTransaction = Boolean((await tx.query("SELECT to_regclass('public.worker_profiles') AS present")).rows[0].present);
            throw new Error("Injected interruption before migration history write");
          }
          return tx.query(sql, params);
        },
      })),
    };
    await assert.rejects(applyPendingMigrations(interrupted, config.candidateSha), /Injected interruption/);
    assert.equal(appliedSchemaInsideFailedTransaction, true);
    assert.deepEqual(await readHistory(), []);
    assert.equal((await database.query("SELECT to_regclass('public.worker_profiles') AS present")).rows[0].present, null);

    assert.deepEqual(await applyPendingMigrations(database, config.candidateSha), migrations.map(item => item.id));
    const history = await readHistory();
    assert.deepEqual(history.map(row => [row.migration_id, row.checksum, row.release_sha]),
      migrations.map(item => [item.id, item.checksum, config.candidateSha]));
    const constraint = (await database.query(`
      SELECT convalidated, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'public.assurance_action_items'::regclass
        AND conname = 'assurance_action_items_deep_link_check'
    `)).rows[0];
    assert.equal(constraint?.convalidated, true);
    for (const destination of ["/worker/assurance-cases", "/admin/operations/scoring-assignments", "/assessor/interviews"]) {
      assert.ok(constraint.definition.includes(destination));
    }
    assert.deepEqual(await applyPendingMigrations(database, config.candidateSha), []);
    assert.deepEqual(await readHistory(), history);

    process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = "true";
    await assert.rejects(rollbackLatestMigration(database, { appEnvironment: "production" }), /rollback is prohibited/i);
    assert.deepEqual(await readHistory(), history);

    const fixture = await seedCredentialDecisionFixture(database);
    const actionId = "assurance_action_" + "r".repeat(24);
    const readAction = async () => (await database.query(
      "SELECT row_to_json(action) AS action FROM assurance_action_items action WHERE action_id=$1", [actionId]
    )).rows[0].action;
    const readCase = async () => (await database.query(
      "SELECT row_to_json(assurance_case) AS assurance_case FROM assurance_cases assurance_case WHERE case_id=$1", [fixture.caseId]
    )).rows[0].assurance_case;
    await database.query(`
      INSERT INTO assurance_action_items (action_id,tenant_id,order_id,case_id,worker_account_id,severity,reason,owner_kind,allowed_action,deep_link)
      SELECT $1,tenant_id,order_id,case_id,worker_account_id,'warning','Synthetic retained Worker action','worker','provide-evidence',$2
      FROM assurance_cases WHERE case_id=$3
    `, [actionId, "/worker/assurance-cases/" + fixture.caseId, fixture.caseId]);
    const action = await readAction();
    const assuranceCase = await readCase();
    const latest = "0129_assurance_role_action_destinations";
    assert.equal(await rollbackLatestMigration(database, { appEnvironment: "test" }), latest);
    assert.equal((await readHistory()).length, history.length - 1);
    const restoredAction = { ...action, deep_link: "/company/assurance-orders/" + action.order_id + "#" + fixture.caseId };
    assert.deepEqual(await readAction(), restoredAction);
    assert.deepEqual(await readCase(), assuranceCase);
    const author = await seedWorkerPrincipal(database, "populated-playbook-rollback");
    const interviewId = "interview_request_" + "i".repeat(24);
    await database.query(`
      INSERT INTO interview_requests (interview_request_id, tenant_id, case_id, worker_account_id, status, requested_at)
      VALUES ($1, $2, $3, $4, 'REQUESTED', CURRENT_TIMESTAMP)
    `, [interviewId, action.tenant_id, fixture.caseId, action.worker_account_id]);
    const questionSet = "interview_questions_" + "q".repeat(24);
    await database.query(`
      INSERT INTO interview_question_sets (question_set_id, tenant_id, interview_request_id, version_no, questions_json, created_by_account_id)
      VALUES ($1, $3, $4, 1, '["Original question"]', $5),
             ($2, $3, $4, 2, '["Original question","Follow-up"]', $5)
    `, [questionSet, "interview_questions_" + "s".repeat(24), action.tenant_id, interviewId, author.accountId]);
    const readQuestions = async () => (await database.query(
      "SELECT row_to_json(sets) AS snapshot FROM interview_question_sets sets WHERE interview_request_id=$1 ORDER BY version_no",
      [interviewId]
    )).rows;
    const retainedQuestions = await readQuestions();
    const playbook = "0128_interview_playbook_append_only";
    assert.equal(await rollbackLatestMigration(database, { appEnvironment: "test" }), playbook);
    assert.deepEqual(await readQuestions(), retainedQuestions);
    assert.equal((await readHistory()).length, history.length - 2);
    assert.deepEqual(await applyPendingMigrations(database, config.candidateSha), [playbook, latest]);
    await assert.rejects(database.query("DELETE FROM interview_question_sets WHERE question_set_id=$1", [questionSet]), /append-only/);
    assert.deepEqual(await readQuestions(), retainedQuestions);
    console.log("POSTGRES_POPULATED_DOWN_UP_PASS", playbook);
    assert.deepEqual(await readAction(), restoredAction);
    assert.deepEqual(await readCase(), assuranceCase);
    const reappliedHistory = await readHistory();
    assert.deepEqual(reappliedHistory.map(row => [row.migration_id, row.checksum, row.release_sha]),
      migrations.map(item => [item.id, item.checksum, config.candidateSha]));
    console.log("POSTGRES_POPULATED_DOWN_UP_PASS", latest);

    await database.query("UPDATE hse_schema_migrations SET checksum=$1 WHERE migration_id=$2",
      ["0".repeat(64), history[0].migration_id]);
    const mismatchedHistory = await readHistory();
    await assert.rejects(applyPendingMigrations(database, config.candidateSha), /checksum mismatch/i);
    assert.deepEqual(await readHistory(), mismatchedHistory);
    console.log("POSTGRES_MIGRATION_SAFETY_PASS", migrations.length, "migrations", config.candidateSha);
  } finally {
    if (oldAcknowledgement === undefined) delete process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK;
    else process.env.HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK = oldAcknowledgement;
    await database?.close();
    if (created) await admin.execute('DROP DATABASE "' + name + '"');
    await admin.close();
  }
});
