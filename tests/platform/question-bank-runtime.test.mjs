import { seedQuestionFixtureAdmin } from "../helpers/question-publication-fixture.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_QUESTION_BANK_RUNTIME_DIST;
if (!runtime) {
  const result = spawnSync(process.execPath, ["scripts/run-question-bank-runtime-tests.mjs"], {
    stdio: "inherit"
  });
  process.exit(result.status ?? 1);
}
const domain = await import(pathToFileURL(join(runtime, "question-bank", "question-bank-domain.js")).href);
const serviceModule = await import(pathToFileURL(join(runtime, "question-bank", "question-bank-service.js")).href);
const deliveryModule = await import(pathToFileURL(join(runtime, "question-bank", "question-delivery-service.js")).href);
const { QuestionBankInputError, QuestionBankAccessError, QuestionBankConflictError } = domain;
const { QuestionBankService } = serviceModule;
const { QuestionDeliveryService } = deliveryModule;
const NOW_DATE = new Date("2026-08-18T02:10:00.000Z");
const NOW = NOW_DATE.toISOString();
const FUTURE = "2099-01-01T00:00:00.000Z";
const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "m2-04-question-bank-runtime",
  sessionSecret: "m2-04-session-secret-with-more-than-thirty-two-characters",
  authPepper: "m2-04-auth-pepper-with-more-than-thirty-two-characters",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};

const oid = (prefix, c) => `${prefix}_${c.repeat(24)}`;

async function db() {
  const database = await openScriptDatabase(ENV);
  await applyMigrationsThrough(
    database,
    ENV.releaseSha,
    "0103_question_approval_lifecycle"
  );
  return database;
}

async function seedAdmin(database, c, { revoked = false } = {}) {
  const accountId = `account_m204_admin_${c}`;
  const sessionId = `session_m204_admin_${c}`;
  const email = `admin-m204-${c.toLowerCase()}@example.com`;
  await database.query(
    `INSERT INTO auth_accounts(
       account_id,email_normalized,display_name,account_status,password_hash,
       email_verified_at,password_set_at,created_at,updated_at
     ) VALUES($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [accountId, email, `Admin ${c}`, "scrypt$16384$8$1$salt$hash", NOW]
  );
  await database.query(
    `INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'admin',$2)`,
    [accountId, NOW]
  );
  await database.query(
    `INSERT INTO auth_sessions(
       session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,
       last_seen_at,expires_at,revoked_at,revocation_reason
     ) VALUES($1,$2,'admin',$3,$4,$5,$5,$6,$7,$8)`,
    [
      sessionId,
      accountId,
      `token-${c}`,
      `csrf-${c}`,
      NOW,
      FUTURE,
      revoked ? NOW : null,
      revoked ? "runtime_fixture_revoked" : null
    ]
  );
  return Object.freeze({
    accountId,
    sessionId,
    activeRole: "admin",
    accountStatus: "active",
    email,
    displayName: `Admin ${c}`,
    createdAt: NOW,
    lastSeenAt: NOW,
    expiresAt: FUTURE,
    tenantMembership: null,
    authorizedPlatformPermission: "platform.operations.manage"
  });
}

async function seedFramework(database, c) {
  const id = oid("framework", c);
  await database.query(
    `INSERT INTO assurance_frameworks(
       framework_id,framework_reference,title,created_by_account_id,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$5)`,
    [id, `FRAME-${c}`, `Framework ${c}`, `account_seed_${c}`, NOW]
  );
  return { frameworkId: id, frameworkReference: `FRAME-${c}` };
}

const common = (frameworkReference, prompt, questionType, extra = {}) => ({
  questionType,
  prompt,
  frameworkReference,
  domainReference: "General Safety",
  difficulty: "MEDIUM",
  tags: ["safety", "core"],
  ...extra
});

async function transition(service, actor, item, action, reason) {
  return service.transitionQuestion(actor, {questionId:item.question.questionId,expectedAuthoringVersionId:item.question.authoringVersionId,expectedWorkflowState:item.workflow.state,expectedRevisionNo:item.workflow.revisionNo,action,reason}, NOW_DATE);
}
async function publish(database, service, author, item) {
  const reviewer = await seedQuestionFixtureAdmin(database, "question_runtime_reviewer_"+author.accountId, NOW);
  const submitted=await transition(service,author,item,"SUBMIT");
  const approved=await transition(service,reviewer,submitted,"APPROVE");
  return transition(service,reviewer,approved,"PUBLISH");
}

const rubric = {
  maxScore: 10,
  criteria: [
    { description: "Identifies the primary hazard", points: 4 },
    { description: "Explains the correct control measures", points: 6 }
  ]
};

test("M2.04 accepts all six canonical types and round-trips immutable current versions", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "A");
    const framework = await seedFramework(database, "A");
    const service = new QuestionBankService(database);
    const inputs = [
      [
        "Q-MCQ",
        "MULTIPLE_CHOICE",
        { options: ["Stop work", "Continue work", "Ignore the hazard"], answerKey: "Stop work" }
      ],
      ["Q-TF", "TRUE_FALSE", { answerKey: true }],
      ["Q-SHORT", "SHORT_TEXT", { rubric }],
      ["Q-LONG", "LONG_TEXT", { rubric }],
      ["Q-INT", "INTEGER", { answerKey: 5 }],
      ["Q-DEC", "DECIMAL", { answerKey: 2.5 }]
    ];

    for (const [reference, type, extra] of inputs) {
      const made = await service.createQuestion(
        admin,
        {
          questionReference: reference,
          version: common(
            framework.frameworkReference,
            `Unique ${type} safety question prompt for runtime validation`,
            type,
            extra
          )
        },
        NOW_DATE
      );
      assert.equal(made.question.questionStatus, "INACTIVE");
      assert.equal(made.workflow.state,"DRAFT");
      assert.equal(await new QuestionDeliveryService(database).findActiveVersion(made.version.questionVersionId),null);
      await publish(database,service,admin,made);
      assert.equal(made.version.questionType, type);
      assert.equal(made.version.versionNo, 1);
      if (Object.hasOwn(extra, "answerKey")) {
        assert.deepEqual(made.version.answerKey, extra.answerKey);
        assert.equal(made.version.rubric, null);
      } else {
        assert.equal(made.version.answerKey, null);
        assert.deepEqual(made.version.rubric, rubric);
      }
    }

    const listed = await service.listQuestions(admin);
    assert.equal(listed.length, 6);
    const mcq = listed.find((entry) => entry.question.questionReference === "Q-MCQ");
    assert.equal(mcq?.version.answerKey, "Stop work");

    const count = await database.query(
      `SELECT COUNT(*)::int AS count FROM assessment_questions WHERE question_status='ACTIVE'`
    );
    assert.equal(count.rows[0].count, 6);
  } finally {
    await database.close();
  }
});

test("M2.04 rejects malformed MCQ, boolean, numeric and written question shapes", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "B");
    const framework = await seedFramework(database, "B");
    const service = new QuestionBankService(database);
    const invalid = [
      common(framework.frameworkReference, "Invalid MCQ answer shape prompt", "MULTIPLE_CHOICE", {
        options: ["A", "A"],
        answerKey: "A"
      }),
      common(framework.frameworkReference, "Invalid true false answer shape prompt", "TRUE_FALSE", {
        answerKey: "true"
      }),
      common(framework.frameworkReference, "Invalid integer answer shape prompt", "INTEGER", {
        answerKey: 2.4
      }),
      common(framework.frameworkReference, "Invalid decimal answer shape prompt", "DECIMAL", {
        answerKey: Number.POSITIVE_INFINITY
      }),
      common(framework.frameworkReference, "Invalid short written rubric prompt", "SHORT_TEXT", {
        rubric: null
      }),
      common(framework.frameworkReference, "Invalid long written rubric totals prompt", "LONG_TEXT", {
        rubric: { maxScore: 10, criteria: [{ description: "One criterion", points: 4 }] }
      })
    ];
    for (let index = 0; index < invalid.length; index += 1) {
      await assert.rejects(
        service.createQuestion(
          admin,
          { questionReference: `BAD-${index}`, version: invalid[index] },
          NOW_DATE
        ),
        QuestionBankInputError
      );
    }
  } finally {
    await database.close();
  }
});

test("M2.04 rejects duplicate active semantic content even under a different reference or option order", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "C");
    const framework = await seedFramework(database, "C");
    const service = new QuestionBankService(database);
    const first = common(
      framework.frameworkReference,
      "Which immediate action is correct after finding an uncontrolled hazard?",
      "MULTIPLE_CHOICE",
      { options: ["Stop work", "Notify supervisor", "Walk away"], answerKey: "Stop work" }
    );
    const original=await service.createQuestion(admin, { questionReference: "DUP-1", version: first }, NOW_DATE);
    await publish(database,service,admin,original);
    const duplicate = common(
      framework.frameworkReference,
      "  Which   immediate action is correct after finding an uncontrolled hazard?  ",
      "MULTIPLE_CHOICE",
      { options: ["Walk away", "Stop work", "Notify supervisor"], answerKey: "Stop work" }
    );
    await assert.rejects(
      (async()=>{const made=await service.createQuestion(admin,{questionReference:"DUP-2",version:duplicate},NOW_DATE);await publish(database,service,admin,made);})(),
      QuestionBankConflictError
    );
  } finally {
    await database.close();
  }
});

test("M2.04 revoked admin cannot mutate and live admin mutations emit dedicated audit events", async () => {
  const database = await db();
  try {
    const live = await seedAdmin(database, "D");
    const revoked = await seedAdmin(database, "E", { revoked: true });
    const framework = await seedFramework(database, "D");
    const service = new QuestionBankService(database);
    const version = common(
      framework.frameworkReference,
      "Question used to verify fixed-role live admin authorization",
      "TRUE_FALSE",
      { answerKey: true }
    );
    await assert.rejects(
      service.createQuestion(revoked, { questionReference: "REVOKED", version }, NOW_DATE),
      QuestionBankAccessError
    );
    const made = await service.createQuestion(
      live,
      { questionReference: "AUDIT", version },
      NOW_DATE
    );
    await publish(database,service,live,made);
    await service.setStatus(live, made.question.questionId, "INACTIVE", NOW_DATE);
    const events = await database.query(
      `SELECT action_key FROM platform_audit_events WHERE target_reference=$1 ORDER BY audit_sequence`,
      [made.question.questionId]
    );
    assert.deepEqual(events.rows.map((row) => row.action_key), [
      "assessment.question.created",
      "assessment.question.status.changed",
      "assessment.question.status.changed",
      "assessment.question.status.changed",
      "assessment.question.status.changed"
    ]);
  } finally {
    await database.close();
  }
});

test("M2.04 question listing requires a live admin session", async () => {
  const database = await db();
  try {
    const revoked = await seedAdmin(database, "L", { revoked: true });
    const service = new QuestionBankService(database);
    await assert.rejects(
      service.listQuestions(revoked),
      QuestionBankAccessError
    );
  } finally {
    await database.close();
  }
});

test("M2.04 eight-way stale revision race has exactly one winner and preserves every version row", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "F");
    const framework = await seedFramework(database, "F");
    const service = new QuestionBankService(database);
    const made = await service.createQuestion(
      admin,
      {
        questionReference: "RACE",
        version: common(
          framework.frameworkReference,
          "Original question prompt before concurrent revisions",
          "INTEGER",
          { answerKey: 3 }
        )
      },
      NOW_DATE
    );
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        service.reviseQuestion(
          admin,
          {
            questionId: made.question.questionId,
            expectedCurrentVersionId: made.question.currentVersionId,
            version: common(
              framework.frameworkReference,
              `Concurrent revision number ${index} has a distinct safety prompt`,
              "INTEGER",
              { answerKey: index + 10 }
            )
          },
          NOW_DATE
        )
      )
    );
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 7);
    const rows = await database.query(
      `SELECT version_no FROM assessment_question_versions WHERE question_id=$1 ORDER BY version_no`,
      [made.question.questionId]
    );
    assert.deepEqual(rows.rows.map((row) => Number(row.version_no)), [1, 2]);
    const audits = await database.query(
      `SELECT action_key FROM platform_audit_events WHERE target_reference=$1 ORDER BY audit_sequence`,
      [made.question.questionId]
    );
    assert.deepEqual(audits.rows.map((row) => row.action_key), [
      "assessment.question.created",
      "assessment.question.revised"
    ]);
  } finally {
    await database.close();
  }
});

test("M2.04 delivery projection exposes no hidden answer or scoring material", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "G");
    const framework = await seedFramework(database, "G");
    const service = new QuestionBankService(database);
    const delivery = new QuestionDeliveryService(database);
    const made = await service.createQuestion(
      admin,
      {
        questionReference: "DELIVERY",
        version: common(
          framework.frameworkReference,
          "Select the safe isolation method before maintenance begins",
          "MULTIPLE_CHOICE",
          {
            options: ["Lockout tagout", "Verbal warning only", "No isolation"],
            answerKey: "Lockout tagout"
          }
        )
      },
      NOW_DATE
    );
    assert.equal(await delivery.findActiveVersion(made.version.questionVersionId),null);
    await publish(database,service,admin,made);
    const publicVersion = await delivery.findActiveVersion(made.question.currentVersionId);
    assert.ok(publicVersion);
    assert.deepEqual(
      Object.keys(publicVersion).sort(),
      [
        "difficulty",
        "domainReference",
        "frameworkId",
        "options",
        "prompt",
        "questionId",
        "questionType",
        "questionVersionId",
        "tags"
      ].sort()
    );
    assert.equal(JSON.stringify(publicVersion).includes("Lockout tagout"), true);
    assert.equal(Object.hasOwn(publicVersion, "answerKey"), false);
    assert.equal(Object.hasOwn(publicVersion, "rubric"), false);
    assert.equal(Object.hasOwn(publicVersion, "contentFingerprint"), false);
  } finally {
    await database.close();
  }
});

test("M2.04 version history rejects UPDATE and DELETE tampering", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "H");
    const framework = await seedFramework(database, "H");
    const service = new QuestionBankService(database);
    const made = await service.createQuestion(
      admin,
      {
        questionReference: "IMMUTABLE",
        version: common(
          framework.frameworkReference,
          "Immutable question version history must reject direct tampering",
          "TRUE_FALSE",
          { answerKey: false }
        )
      },
      NOW_DATE
    );
    await assert.rejects(
      database.query(
        `UPDATE assessment_question_versions SET prompt='tampered prompt value' WHERE question_version_id=$1`,
        [made.question.currentVersionId]
      ),
      (error) => error?.code === "55000"
    );
    await assert.rejects(
      database.query(
        `DELETE FROM assessment_question_versions WHERE question_version_id=$1`,
        [made.question.currentVersionId]
      ),
      (error) => error?.code === "55000"
    );
  } finally {
    await database.close();
  }
});

test("M2.04 history-preserving down/reapply retains questions and versions", async () => {
  const database = await db();
  try {
    const admin = await seedAdmin(database, "I");
    const framework = await seedFramework(database, "I");
    const service = new QuestionBankService(database);
    const made = await service.createQuestion(
      admin,
      {
        questionReference: "RETAIN",
        version: common(
          framework.frameworkReference,
          "Question history must remain after a milestone rollback script",
          "DECIMAL",
          { answerKey: 1.25 }
        )
      },
      NOW_DATE
    );
    await database.execute(readFileSync("database/migrations/0036_question_bank.down.sql", "utf8"));
    assert.equal(
      (
        await database.query(
          `SELECT COUNT(*)::int AS count FROM assessment_question_versions WHERE question_id=$1`,
          [made.question.questionId]
        )
      ).rows[0].count,
      1
    );
    await database.execute(readFileSync("database/migrations/0036_question_bank.up.sql", "utf8"));
    assert.equal(
      (
        await database.query(
          `SELECT COUNT(*)::int AS count FROM assessment_question_versions WHERE question_id=$1`,
          [made.question.questionId]
        )
      ).rows[0].count,
      1
    );
  } finally {
    await database.close();
  }
});

test("Question independent approval retains old live publication through changes, CAS races and terminal archival", async()=>{
 const database=await db();try{
  const author=await seedAdmin(database,"Z"),reviewer=await seedAdmin(database,"Y"),revoked=await seedAdmin(database,"X",{revoked:true});
  const framework=await seedFramework(database,"Z"),service=new QuestionBankService(database),delivery=new QuestionDeliveryService(database);
  const input=common(framework.frameworkReference,"Approval lifecycle original safe isolation question","TRUE_FALSE",{answerKey:true});
  let item=await service.createQuestion(author,{questionReference:"LIFECYCLE",version:input},NOW_DATE);
  const v1=item.version.questionVersionId;
  assert.equal(item.workflow.state,"DRAFT");assert.equal(item.liveVersion,null);assert.equal(await delivery.findActiveVersion(v1),null);
  await assert.rejects(database.query("UPDATE assessment_questions SET question_status='ACTIVE' WHERE question_id=$1",[item.question.questionId]),e=>e.code==="23514");
  await assert.rejects(service.setStatus(author,item.question.questionId,"ACTIVE",NOW_DATE),QuestionBankConflictError);
  await assert.rejects(transition(service,reviewer,item,"SUBMIT"),QuestionBankAccessError);
  const submissions=await Promise.allSettled(Array.from({length:8},()=>transition(service,author,item,"SUBMIT")));
  assert.equal(submissions.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(submissions.filter(x=>x.status==="rejected").length,7);
  item=submissions.find(x=>x.status==="fulfilled").value;
  await assert.rejects(transition(service,author,item,"APPROVE"),QuestionBankAccessError);
  await assert.rejects(transition(service,revoked,item,"APPROVE"),QuestionBankAccessError);
  await assert.rejects(transition(service,reviewer,item,"REQUEST_CHANGES",""),QuestionBankInputError);
  await assert.rejects(database.query("UPDATE question_version_workflow SET workflow_state='APPROVED',approved_by_account_id=$2,approved_at=$3,transition_actor_account_id=$2,transition_session_id=$4 WHERE question_version_id=$1",[v1,author.accountId,NOW,author.sessionId]),e=>["23514","42501"].includes(e.code));
  const reviews=await Promise.allSettled(Array.from({length:8},()=>transition(service,reviewer,item,"APPROVE")));
  assert.equal(reviews.filter(x=>x.status==="fulfilled").length,1);assert.equal(reviews.filter(x=>x.status==="rejected").length,7);
  item=reviews.find(x=>x.status==="fulfilled").value;
  assert.equal(item.workflow.approvedByAccountId,reviewer.accountId);
  await assert.rejects(database.query("UPDATE question_version_workflow SET approved_by_account_id=$2 WHERE question_version_id=$1",[v1,revoked.accountId]),e=>e.code==="55000");
  const publications=await Promise.allSettled(Array.from({length:8},()=>transition(service,reviewer,item,"PUBLISH")));
  assert.equal(publications.filter(x=>x.status==="fulfilled").length,1);assert.equal(publications.filter(x=>x.status==="rejected").length,7);
  item=publications.find(x=>x.status==="fulfilled").value;assert.ok(await delivery.findActiveVersion(v1));
  item=await service.reviseQuestion(author,{questionId:item.question.questionId,expectedAuthoringVersionId:v1,version:{...input,prompt:"Approval lifecycle draft replacement safe isolation question"}},NOW_DATE);
  const v2=item.version.questionVersionId;assert.equal(item.question.currentVersionId,v1);assert.equal(item.workflow.state,"DRAFT");assert.ok(await delivery.findActiveVersion(v1));assert.equal(await delivery.findActiveVersion(v2),null);
  await assert.rejects(service.transitionQuestion(reviewer,{questionId:item.question.questionId,expectedAuthoringVersionId:v1,expectedWorkflowState:"APPROVED",expectedRevisionNo:2,action:"PUBLISH"},NOW_DATE),QuestionBankConflictError);
  item=await transition(service,author,item,"SUBMIT");item=await transition(service,reviewer,item,"REQUEST_CHANGES","Clarify the isolation sequence.");
  assert.equal(item.workflow.state,"CHANGES_REQUESTED");assert.ok(await delivery.findActiveVersion(v1));
  item=await service.reviseQuestion(author,{questionId:item.question.questionId,expectedAuthoringVersionId:v2,version:{...input,prompt:"Approval lifecycle corrected final safe isolation question"}},NOW_DATE);
  const v3=item.version.questionVersionId;item=await transition(service,author,item,"SUBMIT");item=await transition(service,reviewer,item,"APPROVE");item=await transition(service,reviewer,item,"PUBLISH");
  assert.equal(item.question.currentVersionId,v3);assert.equal(await delivery.findActiveVersion(v1),null);assert.ok(await delivery.findActiveVersion(v3));
  const old=(await database.query("SELECT workflow_state FROM question_version_workflow WHERE question_version_id=$1",[v1])).rows[0];assert.equal(old.workflow_state,"PAUSED");
  item=await transition(service,author,item,"PAUSE");const stalePaused=item;assert.equal(await delivery.findActiveVersion(v3),null);item=await transition(service,author,item,"RESUME");assert.ok(await delivery.findActiveVersion(v3));
  item=await transition(service,author,item,"PAUSE");await assert.rejects(transition(service,author,stalePaused,"RESUME"),QuestionBankConflictError);item=await transition(service,author,item,"RESUME");
  await assert.rejects(transition(service,author,item,"RETIRE"),QuestionBankInputError);
  item=await transition(service,author,item,"RETIRE","Replaced by a revised curriculum.");assert.equal(await delivery.findActiveVersion(v3),null);
  item=await transition(service,author,item,"ARCHIVE");assert.equal(item.workflow.state,"ARCHIVED");
  await assert.rejects(transition(service,author,item,"RESUME"),QuestionBankConflictError);
  const events=await database.query("SELECT event_id,from_state,to_state,actor_account_id FROM question_version_workflow_events WHERE question_version_id=$1 ORDER BY revision_no",[v3]);
  assert.deepEqual(events.rows.map(x=>x.to_state),["DRAFT","UNDER_REVIEW","APPROVED","PUBLISHED","PAUSED","PUBLISHED","PAUSED","PUBLISHED","RETIRED","ARCHIVED"]);
  await assert.rejects(database.query("UPDATE question_version_workflow_events SET reason='tamper' WHERE event_id=$1",[events.rows[0].event_id]),e=>e.code==="55000");
  await assert.rejects(database.query("DELETE FROM question_version_workflow_events WHERE event_id=$1",[events.rows[0].event_id]),e=>e.code==="55000");
  await assert.rejects(database.execute(readFileSync("database/migrations/0103_question_approval_lifecycle.down.sql","utf8")),e=>e.code==="55000");
  console.log("ACTUAL_QUESTION_LIFECYCLE_SQL two live Admin accounts, submit/review/publish races, self review denied, requested changes, draft/live separation, pause/resume/retire/archive, event tamper denied");
 }finally{await database.close();}
});


test("M2.04 bulk draft import is all-or-nothing, reports the failing row and preserves independent approval", async () => {
  const database = await db();
  try {
    const author = await seedAdmin(database, "Y");
    const framework = await seedFramework(database, "Y");
    const service = new QuestionBankService(database);
    const draft = (reference, prompt) => ({
      questionReference: reference,
      version: common(framework.frameworkReference, prompt, "MULTIPLE_CHOICE", {
        options: ["Stop work", "Keep working"], answerKey: "Stop work"
      })
    });
    const first = draft("BATCH-SAFE-1", "What is the safest action for the first imported hazard?");
    const second = draft("BATCH-SAFE-2", "What is the safest action for the next imported hazard?");
    await assert.rejects(
      service.importDraftQuestions(author, [first, {...second, version: {...second.version, answerKey: "not-an-option"}}], NOW_DATE),
      error => error instanceof QuestionBankInputError && /row 2/i.test(error.message)
    );
    assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM assessment_questions")).rows[0].n, 0,
      "Invalid later row cannot partially import earlier valid question");
    await assert.rejects(
      service.importDraftQuestions(author, [first, {questionReference:"BATCH-MISSING-PROMPT",version:{questionType:"MULTIPLE_CHOICE",difficulty:"MEDIUM"}}], NOW_DATE),
      error => error instanceof QuestionBankInputError && /row 2/i.test(error.message),
      "Missing required fields must report its row, not throw an internal TypeError"
    );
    assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM assessment_questions")).rows[0].n,0);

    await assert.rejects(
      service.importDraftQuestions(author, [first, {...second, questionReference: first.questionReference}], NOW_DATE),
      error => error instanceof QuestionBankInputError && /row 2/i.test(error.message)
    );
    assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM assessment_questions")).rows[0].n, 0);
    const result = await service.importDraftQuestions(author, [first, second], NOW_DATE);
    assert.equal(result.createdCount, 2);
    const listed = await service.listQuestions(author);
    assert.deepEqual(new Set(listed.map(item => item.question.questionReference)),new Set(["BATCH-SAFE-1","BATCH-SAFE-2"]));
    assert.ok(listed.every(item => item.workflow.state === "DRAFT" && item.question.questionStatus === "INACTIVE"));
    assert.ok(listed.every(item => item.workflow.authorAccountId === author.accountId && item.workflow.approvedByAccountId === null));
    await assert.rejects(
      service.importDraftQuestions(author, [draft("BATCH-SAFE-3","A third valid draft that must roll back."), second], NOW_DATE),
      error => error instanceof QuestionBankConflictError && /row 2/i.test(error.message)
    );
    assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM assessment_questions")).rows[0].n, 2);
    const audits=await database.query("SELECT COUNT(*)::int AS n FROM platform_audit_events WHERE action_key='assessment.question.created'");
    assert.equal(audits.rows[0].n, 2, "Exactly one successful creation audit per imported draft");
  } finally {
    await database.close();
  }
});

test("M2.04 capacity metrics reflect publication, Worker reservations and retirement without leaking answers", async () => {
  const database=await db();
  try {
    const admin=await seedAdmin(database,"Z");
    const revoked=await seedAdmin(database,"V",{revoked:true});
    const framework=await seedFramework(database,"Z");
    const other=await seedFramework(database,"W");
    const service=new QuestionBankService(database);
    const version=(ref,prompt)=>common(ref,prompt,"MULTIPLE_CHOICE",{
      options:["Stop and assess","Proceed"],answerKey:"Stop and assess"
    });
    const created=await service.createQuestion(admin,{questionReference:"CAP-ONE",version:version(framework.frameworkReference,"Which safe approach is required before entering the first restricted site?")},NOW_DATE);
    const pending=await service.createQuestion(admin,{questionReference:"CAP-TWO",version:version(framework.frameworkReference,"Which safe approach is required before entering the second restricted site?")},NOW_DATE);
    const foreign=await service.createQuestion(admin,{questionReference:"CAP-OTHER",version:version(other.frameworkReference,"Which safe approach is required before entering another restricted site?")},NOW_DATE);
    const get=async ref=>(await service.listCapacityMetrics(admin)).find(r=>r.frameworkReference===ref);
    let before=await get(framework.frameworkReference);
    assert.equal(before.publishedQuestions,0);
    assert.equal(before.neverReservedPublishedQuestions,0);
    assert.equal(before.questionReservations,0);
    assert.equal(before.distinctWorkersWithReservations,0);
    await assert.rejects(service.listCapacityMetrics(revoked),QuestionBankAccessError);
    const live=await publish(database,service,admin,created);
    const unpublished=await get(framework.frameworkReference);
    assert.equal(unpublished.publishedQuestions,1);
    assert.equal(unpublished.neverReservedPublishedQuestions,1);
    assert.equal(unpublished.questionReservations,0);
    assert.equal((await get(other.frameworkReference)).publishedQuestions,0);
    await publish(database,service,admin,pending);
    assert.equal((await get(framework.frameworkReference)).publishedQuestions,2);
    const blueprintId=oid("assessment_blueprint","z");
    const blueprintVersionId=oid("blueprint_version","z");
    await database.query("INSERT INTO assessment_blueprints(blueprint_id,blueprint_reference,created_by_account_id,created_at,updated_at) VALUES($1,$2,$3,$4,$4)",
      [blueprintId,"CAP-BP-Z",admin.accountId,NOW]);
    await database.query("INSERT INTO assessment_blueprint_versions(blueprint_version_id,blueprint_id,version_no,framework_id,title,selectors_json,created_by_account_id,created_at) VALUES($1,$2,1,$3,'Capacity check',$4::jsonb,$5,$6)",
      [blueprintVersionId,blueprintId,framework.frameworkId,JSON.stringify([{count:1,questionType:"MULTIPLE_CHOICE",tagsAll:["core"]}]),admin.accountId,NOW]);
    const formId=oid("assessment_form","z");
    const worker="worker_capacity_metric_example";
    await database.transaction(async tx=>{
      await tx.query("INSERT INTO generated_assessment_forms(form_id,case_id,worker_account_id,blueprint_version_id,generation_nonce_hex,question_count,generated_at) VALUES($1,$2,$3,$4,$5,1,$6)",
        [formId,oid("assurance_case","z"),worker,blueprintVersionId,"a".repeat(64),NOW]);
      await tx.query("INSERT INTO generated_assessment_form_items(form_item_id,form_id,worker_account_id,position,question_id,question_version_id,created_at) VALUES($1,$2,$3,1,$4,$5,$6)",
        [oid("assessment_form_item","z"),formId,worker,created.question.questionId,created.version.questionVersionId,NOW]);
    });
    const afterReservation=await get(framework.frameworkReference);
    assert.equal(afterReservation.publishedQuestions,2);
    assert.equal(afterReservation.neverReservedPublishedQuestions,1);
    assert.equal(afterReservation.questionReservations,1);
    assert.equal(afterReservation.distinctWorkersWithReservations,1);
    assert.equal(afterReservation.questionsEverReserved,1);
    assert.equal((await get(other.frameworkReference)).questionReservations,0);
    assert.equal(JSON.stringify(afterReservation).includes("Stop and assess"),false,"Never return hidden answer keys or question prompts");
    await transition(service,admin,live,"PAUSE");
    const paused=await get(framework.frameworkReference);
    assert.equal(paused.publishedQuestions,1);
    assert.equal(paused.neverReservedPublishedQuestions,1);
    assert.equal(paused.questionReservations,1,"Historic Worker reservation cannot disappear after pausing publication");
    const resumed=(await service.listQuestions(admin)).find(r=>r.question.questionId===created.question.questionId);
    await transition(service,admin,resumed,"RESUME");
    assert.equal((await get(framework.frameworkReference)).publishedQuestions,2);
    assert.equal((await get(framework.frameworkReference)).neverReservedPublishedQuestions,1);
    await publish(database,service,admin,foreign);
    assert.equal((await get(other.frameworkReference)).publishedQuestions,1);
  } finally {await database.close();}
});
