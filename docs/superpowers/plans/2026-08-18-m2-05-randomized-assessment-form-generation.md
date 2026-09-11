# M2.05 Randomized Assessment Form Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build immutable assessment blueprints and server-authoritative randomized assessment forms with permanent Worker-level stable-question non-repetition and answer-safe delivery.

**Architecture:** Extend the existing M2.03/M2.04 schema with append-only blueprint/form tables. Keep blueprint administration, form generation, and delivery in separate focused services. Generation runs in one database transaction, derives Worker/framework from the Assurance Case and locked policy snapshot, filters active current Question Bank versions, excludes every stable question previously shown to that Worker, ranks candidates using a cryptographic nonce, persists exact question-version pins and order, and converges under duplicate concurrent requests.

**Tech Stack:** Next.js 16 App Router, TypeScript strict mode, PostgreSQL/PGlite SQL, Node `crypto`, React server actions, Node test runner, GitHub Actions hard-browser/engineering gates.

**Spec:** `docs/superpowers/specs/2026-08-18-m2-05-randomized-assessment-form-generation-design.md`

## Global Constraints
- M2.05 does not own attempt runtime, answer persistence, scoring, results, retakes, proctoring, interviews, credentials, or catalogue eligibility.
- Once a stable `question_id` appears in a persisted generated form for a Worker, that stable question is permanently excluded for that Worker even after question revision.
- Different Workers may receive the same stable question.
- Form generation requires an immutable M2.03 case policy snapshot whose framework matches the exact blueprint version.
- Only active stable questions and their current exact question versions are selectable.
- Persisted form order is authoritative and must never be re-randomized for delivery.
- Correct answers, written rubrics, fingerprints, creator ids, and generation nonce never cross the delivery DTO boundary.
- Blueprint versions, generated forms, and generated form items are append-only.
- Every mutation revalidates a live Admin session where Admin authority is required.
- No dead or decorative controls.

---

### Task 1: Schema and selector domain

**Files:**
- Create: `database/migrations/0039_randomized_assessment_forms.up.sql`
- Create: `database/migrations/0039_randomized_assessment_forms.down.sql`
- Create: `src/lib/assessment-generation/assessment-blueprint-domain.ts`
- Create: `tests/platform/randomized-assessment-form-contract.test.mjs`

**Interfaces:**
- Produces `BlueprintSelector`, `BlueprintVersionInput`, `NormalizedBlueprintVersion`, `normalizeBlueprintReference()`, `normalizeBlueprintVersion()`, and opaque id generators.
- Database tables: `assessment_blueprints`, `assessment_blueprint_versions`, `generated_assessment_forms`, `generated_assessment_form_items`.

- [ ] **Step 1: Write failing contract/domain tests**

Assert migration/table names, stable/exact question pins, unique `(case_id, blueprint_version_id)`, append-only guards, history-preserving down migration, supported selector filters, count 1-100, total 1-500, normalized/deduplicated `tagsAll`, and rejection of unknown selector keys.

- [ ] **Step 2: Run RED**

Run:
```bash
node --test tests/platform/randomized-assessment-form-contract.test.mjs
```
Expected: FAIL because migration/domain files do not exist.

- [ ] **Step 3: Implement migration and selector normalization**

Required selector type:
```ts
export type BlueprintSelector = Readonly<{
  count: number;
  questionType?: QuestionType;
  domainReference?: string;
  difficulty?: QuestionDifficulty;
  tagsAll: readonly string[];
}>;
```

Normalization must reject unknown keys, invalid enum values, blank optional strings, duplicate/blank tags, count outside 1-100, empty selector array, and total count above 500.

Migration must add audit actions:
```text
assessment.blueprint.created
assessment.blueprint.revised
assessment.blueprint.status.changed
assessment.form.generated
```
without removing any existing action key.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/platform/randomized-assessment-form-contract.test.mjs
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add database/migrations/0039_randomized_assessment_forms.* src/lib/assessment-generation/assessment-blueprint-domain.ts tests/platform/randomized-assessment-form-contract.test.mjs
git commit -m "feat(m2.05): add randomized assessment form schema"
```

---

### Task 2: Blueprint Admin service

**Files:**
- Create: `src/lib/assessment-generation/assessment-blueprint-service.ts`
- Create: `tests/platform/assessment-blueprint-runtime.test.mjs`

**Interfaces:**
- Consumes M2.03 `assurance_frameworks` and existing `AuthorizationPrincipal`/audit repositories.
- Produces `AssessmentBlueprintService.createBlueprint()`, `.reviseBlueprint()`, `.setStatus()`, `.listBlueprints()`.

- [ ] **Step 1: Write failing runtime tests**

Create migrated PGlite fixtures proving:
```text
create active blueprint -> immutable version 1
stale expectedCurrentVersionId -> conflict
8 concurrent revisions -> exactly one winner and exactly two versions
inactive/missing framework -> input error
revoked Admin session -> access error
version UPDATE/DELETE -> rejected
status toggle -> stable row changes, versions unchanged
audit actions append for create/revise/status
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/platform/assessment-blueprint-runtime.test.mjs
```
Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement minimal service**

Follow M2.04 live-Admin session revalidation. Revision must lock the stable blueprint row and require the exact expected current version id before inserting the next immutable version. Map PostgreSQL `23505` to a blueprint conflict error without leaking SQL details.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/platform/assessment-blueprint-runtime.test.mjs
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assessment-generation/assessment-blueprint-service.ts tests/platform/assessment-blueprint-runtime.test.mjs
git commit -m "feat(m2.05): add assessment blueprint service"
```

---

### Task 3: Server-authoritative form generation

**Files:**
- Create: `src/lib/assessment-generation/assessment-form-generation-service.ts`
- Create: `tests/platform/randomized-assessment-form-runtime.test.mjs`

**Interfaces:**
- Consumes `assurance_cases`, `assurance_case_policy_snapshots`, exact blueprint versions, `assessment_questions`, and `assessment_question_versions`.
- Produces `AssessmentFormGenerationService.generateForCase(principal, { caseId, blueprintVersionId }, now?)` and immutable generated form DTO containing ids/order but no answer content.

- [ ] **Step 1: Write failing runtime tests**

Seed real M2.03/M2.04 rows and prove:
```text
same Worker + two cases/forms => zero repeated stable question ids
a revised question remains excluded by stable question id
different Workers may receive the same stable question
framework mismatch => denied/no form
missing case policy snapshot => denied/no form
inactive stable question/current-version mismatch => not selectable
selector tagsAll/questionType/domain/difficulty filters are all enforced
insufficient unseen pool => failure and zero partial form rows
8 concurrent generation calls for same case+blueprint => one form id/one item set
stored positions are contiguous 1..N and exact question version ids match generation-time current versions
form/item UPDATE and DELETE => rejected
audit metadata excludes nonce/answer/rubric
```

- [ ] **Step 2: Run RED**

```bash
node --test tests/platform/randomized-assessment-form-runtime.test.mjs
```
Expected: FAIL because generation service does not exist.

- [ ] **Step 3: Implement minimal generation transaction**

Candidate exclusion query must use prior form ownership:
```sql
SELECT DISTINCT item.question_id
FROM generated_assessment_forms form
JOIN generated_assessment_form_items item ON item.form_id = form.form_id
WHERE form.worker_account_id = $1
```

Ranking input must contain the 32-byte nonce plus selector index, stable question id, and exact question version id. Use `createHash('sha256')` for rank and `randomBytes(32)` for nonce. Do not use `Math.random()`.

Before inserting any form, build the entire selection in memory and fail if any selector lacks capacity. Insert form + all items in one transaction. On the unique case/blueprint race, reread the winning form and return it.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/platform/randomized-assessment-form-runtime.test.mjs
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assessment-generation/assessment-form-generation-service.ts tests/platform/randomized-assessment-form-runtime.test.mjs
git commit -m "feat(m2.05): generate nonrepeating assessment forms"
```

---

### Task 4: Answer-safe form delivery

**Files:**
- Create: `src/lib/assessment-generation/assessment-form-delivery-service.ts`
- Create: `tests/platform/assessment-form-delivery.test.mjs`

**Interfaces:**
- Produces `AssessmentFormDeliveryService.getForm(formId)` for trusted server consumers.
- Returns only form/case/blueprint ids plus ordered question-safe fields.

- [ ] **Step 1: Write failing leakage test**

Generate a real form containing MCQ and written questions, serialize delivery DTO, and assert absence of these substrings/keys:
```text
answerKey
answer_key_json
rubric
rubric_json
contentFingerprint
content_fingerprint
nonce
createdByAccountId
created_by_account_id
```
Also assert exact order, question type, prompt, safe options, domain, difficulty, and tags are present.

- [ ] **Step 2: Run RED**

```bash
node --test tests/platform/assessment-form-delivery.test.mjs
```
Expected: FAIL because delivery service does not exist.

- [ ] **Step 3: Implement minimal safe query/DTO**

Select only the columns required by the public server DTO. Do not `SELECT *` and strip fields afterward.

- [ ] **Step 4: Run GREEN**

```bash
node --test tests/platform/assessment-form-delivery.test.mjs
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assessment-generation/assessment-form-delivery-service.ts tests/platform/assessment-form-delivery.test.mjs
git commit -m "feat(m2.05): add answer-safe form delivery"
```

---

### Task 5: Admin blueprint UI and browser path

**Files:**
- Create: `src/app/admin/(portal)/assessment-blueprints/actions.ts`
- Create: `src/app/admin/(portal)/assessment-blueprints/page.tsx`
- Modify: `scripts/hard-browser-qa.mjs`

**Interfaces:**
- Server actions call the blueprint service with the authenticated Admin principal.
- UI fields: blueprint reference, title, framework reference, selector JSON, expected current version for revision, activate/deactivate controls.

- [ ] **Step 1: Extend browser QA as RED**

Add a visible-control checkpoint after framework creation:
```text
open /admin/assessment-blueprints
create blueprint with selector JSON
see reference and version 1
reload and see persisted blueprint
revise with current version id and see version 2
deactivate and see Reactivate control
```

- [ ] **Step 2: Run RED on branch**

Use the existing Hard Browser QA workflow; expected failure is route/control not found.

- [ ] **Step 3: Implement page/actions**

Use established Admin page/card/form styles. Parse selector JSON server-side, surface domain/service errors to the page, and ensure every visible button executes a real server action.

- [ ] **Step 4: Run GREEN**

Hard Browser QA must pass this new checkpoint plus all prior checkpoints.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/(portal)/assessment-blueprints scripts/hard-browser-qa.mjs
git commit -m "feat(m2.05): add assessment blueprint admin UI"
```

---

### Task 6: Repository gate integration and final verification

**Files:**
- Create: `scripts/run-assessment-generation-tests.mjs`
- Modify: `scripts/run-engineering-gate.mjs`
- Create: `.github/workflows/m2-05-targeted.yml`

**Interfaces:**
- `run-assessment-generation-tests.mjs` executes contract, blueprint runtime, generation runtime, and delivery tests.
- Engineering verification invokes this M2.05 runner before the complete application gate.

- [ ] **Step 1: Add runner/workflow and prove it detects failure**

Temporarily point the runner at a deliberately missing test path in the workflow branch and confirm non-zero exit, then restore the real test list before commit.

- [ ] **Step 2: Run targeted suite**

```bash
node scripts/run-assessment-generation-tests.mjs
npm run typecheck
npm run lint
```
Expected: all exit 0.

- [ ] **Step 3: Run exact-head GitHub gates**

Require completed-success results for:
```text
M2.05 targeted TDD gate
Hard Browser QA
Engineering verification gate
Auth runtime diagnostic
Enrollment browser diagnostic
```

- [ ] **Step 4: Review diff against the M2.05 design**

Verify no M2.06 catalogue/eligibility or M2.07 attempt/scoring authority was introduced; no secret/scoring fields are delivered; no existing tests were deleted/weakened.

- [ ] **Step 5: Commit**

```bash
git add scripts/run-assessment-generation-tests.mjs scripts/run-engineering-gate.mjs .github/workflows/m2-05-targeted.yml
git commit -m "test(m2.05): gate randomized assessment forms"
```
