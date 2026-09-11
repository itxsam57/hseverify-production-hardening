import { createHash } from "node:crypto";

export const ATTEMPT_NOW_DATE = new Date("2026-08-31T20:10:00.000Z");
export const ATTEMPT_NOW = ATTEMPT_NOW_DATE.toISOString();
export const ATTEMPT_FUTURE = "2099-01-01T00:00:00.000Z";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableId(prefix, seed) {
  return `${prefix}_${digest(`${prefix}:${seed}`).slice(0, 24)}`;
}

export async function seedWorkerPrincipal(db, seed) {
  const accountId = `account_m207_answer_${digest(seed).slice(0, 20)}`;
  const sessionId = `session_m207_answer_${digest(`session:${seed}`).slice(0, 20)}`;
  const email = `m207-${digest(seed).slice(0, 12)}@example.com`;
  await db.query(
    `INSERT INTO auth_accounts(
       account_id,email_normalized,display_name,account_status,password_hash,
       email_verified_at,password_set_at,created_at,updated_at
     ) VALUES($1,$2,$3,'active',$4,$5,$5,$5,$5)`,
    [accountId, email, `M2.07 Worker ${seed}`, "scrypt$16384$8$1$salt$hash", ATTEMPT_NOW]
  );
  await db.query(
    `INSERT INTO auth_account_roles(account_id,role,created_at) VALUES($1,'worker',$2)`,
    [accountId, ATTEMPT_NOW]
  );
  await db.query(
    `INSERT INTO auth_sessions(
       session_id,account_id,active_role,token_hash,csrf_token_hash,created_at,last_seen_at,
       expires_at,revoked_at,revocation_reason
     ) VALUES($1,$2,'worker',$3,$4,$5,$5,$6,NULL,NULL)`,
    [sessionId, accountId, `token-${seed}`, `csrf-${seed}`, ATTEMPT_NOW, ATTEMPT_FUTURE]
  );
  return Object.freeze({
    accountId,
    sessionId,
    activeRole: "worker",
    accountStatus: "active",
    email,
    displayName: `M2.07 Worker ${seed}`,
    createdAt: ATTEMPT_NOW,
    lastSeenAt: ATTEMPT_NOW,
    expiresAt: ATTEMPT_FUTURE,
    tenantMembership: null
  });
}

function questionStorage(question) {
  switch (question.questionType) {
    case "MULTIPLE_CHOICE":
      return {
        options: question.options ?? ["Alpha", "Bravo", "Charlie"],
        answerKey: question.answerKey ?? "Alpha",
        rubric: null
      };
    case "TRUE_FALSE":
      return { options: null, answerKey: question.answerKey ?? true, rubric: null };
    case "INTEGER":
      return { options: null, answerKey: question.answerKey ?? 7, rubric: null };
    case "DECIMAL":
      return { options: null, answerKey: question.answerKey ?? 2.5, rubric: null };
    case "SHORT_TEXT":
    case "LONG_TEXT":
      return {
        options: null,
        answerKey: null,
        rubric: question.rubric ?? {
          maxScore: 1,
          criteria: [{ description: "Relevant response", points: 1 }]
        }
      };
    default:
      throw new Error(`Unsupported fixture type: ${question.questionType}`);
  }
}

export async function seedInProgressAttempt(db, principal, seed, questions) {
  if (!Array.isArray(questions) || questions.length < 1) {
    throw new Error("Attempt fixture requires questions.");
  }

  const frameworkId = stableId("framework", seed);
  const blueprintId = stableId("assessment_blueprint", seed);
  const blueprintVersionId = stableId("blueprint_version", seed);
  const catalogueEntryId = stableId("assessment_catalogue", seed);
  const catalogueVersionId = stableId("catalogue_version", seed);
  const tenantId = stableId("tenant", seed);
  const orderId = stableId("assurance_order", seed);
  const targetId = stableId("assurance_target", seed);
  const caseId = stableId("assurance_case", seed);
  const formId = stableId("assessment_form", seed);
  const attemptId = stableId("assessment_attempt", seed);
  const creator = principal.accountId;

  await db.query(
    `INSERT INTO assurance_frameworks(
       framework_id,framework_reference,title,framework_status,created_by_account_id,created_at,updated_at
     ) VALUES($1,$2,$3,'ACTIVE',$4,$5,$5)`,
    [frameworkId, `M207-${digest(seed).slice(0, 10).toUpperCase()}`, `M2.07 ${seed}`, creator, ATTEMPT_NOW]
  );

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO assessment_blueprints(
         blueprint_id,blueprint_reference,blueprint_status,current_version_id,
         created_by_account_id,created_at,updated_at
       ) VALUES($1,$2,'INACTIVE',NULL,$3,$4,$4)`,
      [blueprintId, `M207-BP-${digest(seed).slice(0, 10).toUpperCase()}`, creator, ATTEMPT_NOW]
    );
    await tx.query(
      `INSERT INTO assessment_blueprint_versions(
         blueprint_version_id,blueprint_id,version_no,framework_id,title,
         selectors_json,created_by_account_id,created_at
       ) VALUES($1,$2,1,$3,$4,$5::jsonb,$6,$7)`,
      [
        blueprintVersionId,
        blueprintId,
        frameworkId,
        `M2.07 Blueprint ${seed}`,
        JSON.stringify([{ count: questions.length, tagsAll: [] }]),
        creator,
        ATTEMPT_NOW
      ]
    );
    await tx.query(
      `UPDATE assessment_blueprints
       SET current_version_id=$2,blueprint_status='ACTIVE',updated_at=$3 WHERE blueprint_id=$1`,
      [blueprintId, blueprintVersionId, ATTEMPT_NOW]
    );
  });

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO assessment_catalogue_entries(
         catalogue_entry_id,catalogue_reference,catalogue_status,current_version_id,
         created_by_account_id,created_at,updated_at
       ) VALUES($1,$2,'INACTIVE',NULL,$3,$4,$4)`,
      [catalogueEntryId, `M207-CAT-${digest(seed).slice(0, 10).toUpperCase()}`, creator, ATTEMPT_NOW]
    );
    await tx.query(
      `INSERT INTO assessment_catalogue_versions(
         catalogue_version_id,catalogue_entry_id,version_no,title,description,framework_id,
         blueprint_version_id,minimum_verified_qualifications,created_by_account_id,created_at
       ) VALUES($1,$2,1,$3,NULL,$4,$5,0,$6,$7)`,
      [catalogueVersionId, catalogueEntryId, `M2.07 Catalogue ${seed}`, frameworkId, blueprintVersionId, creator, ATTEMPT_NOW]
    );
    await tx.query(
      `UPDATE assessment_catalogue_entries
       SET current_version_id=$2,catalogue_status='ACTIVE',updated_at=$3 WHERE catalogue_entry_id=$1`,
      [catalogueEntryId, catalogueVersionId, ATTEMPT_NOW]
    );
  });

  const items = [];
  for (const [index, question] of questions.entries()) {
    const questionSeed = `${seed}:q:${index + 1}`;
    const questionId = stableId("assessment_question", questionSeed);
    const questionVersionId = stableId("question_version", questionSeed);
    const formItemId = stableId("assessment_form_item", questionSeed);
    const prompt = question.prompt ?? `M2.07 ${question.questionType} fixture ${seed} question ${index + 1}.`;
    const storage = questionStorage(question);
    const contentFingerprint = digest(`${question.questionType}:${prompt}:${JSON.stringify(storage.options)}`);

    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO assessment_questions(
           question_id,question_reference,question_status,current_version_id,current_content_fingerprint,
           created_by_account_id,created_at,updated_at
         ) VALUES($1,$2,'INACTIVE',NULL,NULL,$3,$4,$4)`,
        [questionId, `M207-Q-${digest(questionSeed).slice(0, 12).toUpperCase()}`, creator, ATTEMPT_NOW]
      );
      await tx.query(
        `INSERT INTO assessment_question_versions(
           question_version_id,question_id,version_no,question_type,prompt,options_json,
           answer_key_json,rubric_json,framework_id,domain_reference,difficulty,tags_json,
           content_fingerprint,created_by_account_id,created_at
         ) VALUES($1,$2,1,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,'Core','MEDIUM','[]'::jsonb,$9,$10,$11)`,
        [
          questionVersionId,
          questionId,
          question.questionType,
          prompt,
          storage.options === null ? null : JSON.stringify(storage.options),
          storage.answerKey === null ? null : JSON.stringify(storage.answerKey),
          storage.rubric === null ? null : JSON.stringify(storage.rubric),
          frameworkId,
          contentFingerprint,
          creator,
          ATTEMPT_NOW
        ]
      );
      await tx.query(
        `UPDATE assessment_questions
         SET current_version_id=$2,current_content_fingerprint=$3,question_status='ACTIVE',updated_at=$4
         WHERE question_id=$1`,
        [questionId, questionVersionId, contentFingerprint, ATTEMPT_NOW]
      );
    });
    items.push(Object.freeze({
      formItemId,
      position: index + 1,
      questionId,
      questionVersionId,
      questionType: question.questionType,
      options: storage.options
    }));
  }

  await db.query(
    `INSERT INTO assurance_orders(
       order_id,tenant_id,created_by_membership_id,order_name,order_reference,
       requested_identity_checks,requested_evidence_checks,assessment_framework_references,
       interview_required,order_status,validation_errors,scope_version,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,FALSE,'DRAFT','[]'::jsonb,1,$6,$6)`,
    [orderId, tenantId, `membership_${digest(seed).slice(0, 24)}`, `M2.07 Order ${seed}`, `M207-ORDER-${digest(seed).slice(0, 10)}`, ATTEMPT_NOW]
  );
  await db.query(
    `INSERT INTO assurance_order_workers(
       target_id,order_id,tenant_id,worker_link_id,worker_account_id,funding_method,
       target_status,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,'company','eligible',$6,$6)`,
    [targetId, orderId, tenantId, `worker_link_${digest(seed).slice(0, 24)}`, principal.accountId, ATTEMPT_NOW]
  );
  await db.query(
    `INSERT INTO assurance_cases(
       case_id,order_id,target_id,tenant_id,worker_link_id,worker_account_id,
       case_status,owner_kind,next_action,assessment_reference,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$6,'Assessment in progress','worker',
              'Complete the assessment for this Assurance Case.',$7,$8,$8)`,
    [caseId, orderId, targetId, tenantId, `worker_link_${digest(seed).slice(0, 24)}`, principal.accountId, attemptId, ATTEMPT_NOW]
  );

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO generated_assessment_forms(
         form_id,case_id,worker_account_id,blueprint_version_id,generation_nonce_hex,
         question_count,generated_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [formId, caseId, principal.accountId, blueprintVersionId, digest(`nonce:${seed}`), questions.length, ATTEMPT_NOW]
    );
    for (const row of items) {
      await tx.query(
        `INSERT INTO generated_assessment_form_items(
           form_item_id,form_id,position,question_id,question_version_id,created_at
         ) VALUES($1,$2,$3,$4,$5,$6)`,
        [row.formItemId, formId, row.position, row.questionId, row.questionVersionId, ATTEMPT_NOW]
      );
    }
  });

  await db.query(
    `INSERT INTO assessment_attempts(
       attempt_id,case_id,worker_account_id,catalogue_version_id,blueprint_version_id,
       form_id,status,current_position,question_count,started_at,submitted_at,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$5,$6,'IN_PROGRESS',1,$7,$8,NULL,$8,$8)`,
    [attemptId, caseId, principal.accountId, catalogueVersionId, blueprintVersionId, formId, questions.length, ATTEMPT_NOW]
  );

  return Object.freeze({
    attemptId,
    caseId,
    orderId,
    tenantId,
    formId,
    catalogueVersionId,
    blueprintVersionId,
    items: Object.freeze(items)
  });
}

export async function countRows(db, table, where = "TRUE", params = []) {
  const result = await db.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE ${where}`, params);
  return result.rows[0].count;
}
