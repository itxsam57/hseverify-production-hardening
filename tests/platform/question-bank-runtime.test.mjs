import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const runtime = process.env.HSE_QUESTION_BANK_RUNTIME_DIST;
assert.ok(runtime, "HSE_QUESTION_BANK_RUNTIME_DIST is required");
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
    "0038_m2_04_audit_action_constraint_fix"
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
      assert.equal(made.question.questionStatus, "ACTIVE");
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
    await service.createQuestion(admin, { questionReference: "DUP-1", version: first }, NOW_DATE);
    const duplicate = common(
      framework.frameworkReference,
      "Which immediate action is correct after finding an uncontrolled hazard?",
      "MULTIPLE_CHOICE",
      { options: ["Walk away", "Stop work", "Notify supervisor"], answerKey: "Stop work" }
    );
    await assert.rejects(
      service.createQuestion(admin, { questionReference: "DUP-2", version: duplicate }, NOW_DATE),
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
    await service.setStatus(live, made.question.questionId, "INACTIVE", NOW_DATE);
    const events = await database.query(
      `SELECT action_key FROM platform_audit_events WHERE target_reference=$1 ORDER BY audit_sequence`,
      [made.question.questionId]
    );
    assert.deepEqual(events.rows.map((row) => row.action_key), [
      "assessment.question.created",
      "assessment.question.status.changed"
    ]);
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
