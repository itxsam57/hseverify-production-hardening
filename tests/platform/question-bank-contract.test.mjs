import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const paths={migration:"database/migrations/0036_question_bank.up.sql",domain:"src/lib/question-bank/question-bank-domain.ts",service:"src/lib/question-bank/question-bank-service.ts",delivery:"src/lib/question-bank/question-delivery-service.ts",admin:"src/app/admin/(portal)/question-bank/page.tsx",actions:"src/app/admin/(portal)/question-bank/actions.ts",audit:"src/lib/audit/audit-domain.ts"};
const source=p=>{assert.equal(existsSync(p),true,`${p} must exist`);return readFileSync(p,"utf8");};

test("M2.04 owns stable questions and immutable version history",()=>{const m=source(paths.migration);for(const table of ["assessment_questions","assessment_question_versions"])assert.match(m,new RegExp(table));assert.match(m,/current_version_id/);assert.match(m,/current_content_fingerprint/);assert.match(m,/append-only/i);assert.doesNotMatch(m,/ON\s+DELETE\s+CASCADE/i);});

test("M2.04 supports exactly the six canonical question types",()=>{const d=source(paths.domain);for(const type of ["MULTIPLE_CHOICE","TRUE_FALSE","SHORT_TEXT","LONG_TEXT","INTEGER","DECIMAL"])assert.match(d,new RegExp(`"${type}"`));});

test("M2.04 validates answer shapes and written rubrics server-side",()=>{const d=source(paths.domain);for(const marker of ["normalizeMultipleChoice","normalizeTrueFalse","normalizeInteger","normalizeDecimal","normalizeWrittenRubric"])assert.match(d,new RegExp(marker));assert.match(d,/criteria/);assert.match(d,/maxScore/);});

test("M2.04 admin mutation is fixed-role and audited",()=>{const actions=source(paths.actions),audit=source(paths.audit);assert.match(actions,/requirePlatformPermission/);assert.match(actions,/expectedRole:\s*["']admin["']/);assert.match(actions,/platform\.operations\.manage/);for(const action of ["assessment.question.created","assessment.question.revised","assessment.question.status.changed"])assert.match(audit,new RegExp(action.replaceAll(".","\\.")));for(const field of ["createdByAccountId","versionNo","contentFingerprint","currentVersionId"])assert.doesNotMatch(actions,new RegExp(`formData\\.get\\([\"']${field}[\"']\\)`));});

test("M2.04 delivery projection cannot leak answers, rubrics or internal scoring authority",()=>{const delivery=source(paths.delivery);assert.match(delivery,/QuestionDeliveryProjection/);assert.match(delivery,/questionType/);assert.match(delivery,/prompt/);assert.match(delivery,/options/);for(const secret of ["answerKey","answer_key","rubric","contentFingerprint","content_fingerprint","createdByAccountId"])assert.doesNotMatch(delivery,new RegExp(secret));});

test("M2.04 does not steal M2.05 form-generation or M2.07 attempt authority",()=>{const all=`${source(paths.domain)}\n${source(paths.service)}\n${source(paths.delivery)}`;assert.doesNotMatch(all,/generated_assessment_forms|assessment_attempts|submitAnswer|scoreAttempt|randomizeForm|worker_question_history/i);});
