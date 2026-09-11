# M2.07 Candidate Assessment Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first durable Worker assessment-attempt lifecycle so an eligible authenticated Worker can begin one immutable generated form, receive exactly one pinned question at a time, durably commit a type-safe answer before progression, and submit the attempt without exposing future questions or scoring secrets.

**Architecture:** Extend the existing M2.05 form-generation and M2.06 eligibility contracts rather than creating a parallel assessment path. A new `assessment-attempt` server domain owns attempt/answer persistence and one-question projection; begin runs form generation, attempt creation, Assurance Case transition, timeline, and audit in one database transaction. Worker launch is a POST server action from Available Assessments; `/worker/assessments/[attemptId]` is read/resume only and never creates state on GET.

**Tech Stack:** Next.js 16 App Router/server actions, React 19, TypeScript strict mode, PostgreSQL/PGlite migrations, Node `node:test`, existing Engineering Factory browser/CI harness.

**Spec:** `docs/superpowers/specs/2026-08-31-m2-07-candidate-assessment-window-design.md`

## Global Constraints

- Verified implementation base is `a3ee0381bc482e5ba49c728f80b9cdc0eb01b6cb`; all M2.07 work stays on `feat/m2-07-assessment-window` until gated.
- Worker identity is derived only from the trusted authorization principal; client-supplied Worker IDs are forbidden.
- Only `worker.assessments.read` authorizes Worker attempt reads/mutations.
- The browser receives one current pinned question only; it never receives later question IDs/prompts, complete form arrays, answer keys, rubrics, correctness, scores, pass/fail, or reviewer metadata.
- Supported question types remain exactly `MULTIPLE_CHOICE`, `TRUE_FALSE`, `SHORT_TEXT`, `LONG_TEXT`, `INTEGER`, `DECIMAL`.
- A committed answer is immutable in M2.07; no back navigation or answer editing.
- Begin is the only M2.07 Assurance Case status transition: `Assessment pending` -> `Assessment in progress`.
- Final answer sets only the attempt to `SUBMITTED`; it does not move the Assurance Case to `Review pending`.
- No assessment timer is introduced because no authoritative duration exists in the current blueprint contract.
- M2.08 owns autosave/interruption/emergency recovery; M2.09 owns proctoring/integrity; M2.10 owns scoring/review/results.
- Strict RED -> GREEN -> REFACTOR applies: no production behavior is added before its automated test fails for the expected missing-behavior reason.

---

### Task 1: Persistence contract and answer domain

**Files:**
- Create: `database/migrations/0042_assessment_attempt_lifecycle.up.sql`
- Create: `database/migrations/0042_assessment_attempt_lifecycle.down.sql`
- Create: `src/lib/assessment-attempt/assessment-attempt-domain.ts`
- Create: `tests/platform/assessment-attempt-contract.test.mjs`
- Create: `tests/platform/assessment-attempt-rollback.test.mjs`

**Interfaces:**
- Produces `AssessmentAttemptStatus = "IN_PROGRESS" | "SUBMITTED"`.
- Produces `AssessmentAttemptRecord` with `attemptId`, `caseId`, `workerAccountId`, `catalogueVersionId`, `blueprintVersionId`, `formId`, `status`, `currentPosition`, `questionCount`, `startedAt`, `submittedAt`, `createdAt`, `updatedAt`.
- Produces `AssessmentAnswerInput = string | boolean | number` and `NormalizedAssessmentAnswer = { textValue: string | null; booleanValue: boolean | null; numericValue: number | null }`.
- Produces `normalizeAssessmentAnswer(questionType, rawValue, options)` and stable attempt/answer ID normalizers/creators.

- [ ] **Step 1: Write the RED migration/domain contract test**

Require `0042` to create `assessment_attempts` and `assessment_attempt_answers`; require FKs to Assurance Case, auth account, catalogue version, blueprint version, generated form, generated form item, question and pinned question version; require `UNIQUE(form_id)`, `UNIQUE(attempt_id, form_id)`, and `UNIQUE(attempt_id, position)`; require generated form items to expose `UNIQUE(form_id, form_item_id)` for the composite answer FK. Assert status/position/submitted-at checks and exactly-one-typed-value checks exist. Assert the domain exports only the two statuses and all six type-specific normalization rules.

Run:

```bash
node --test tests/platform/assessment-attempt-contract.test.mjs
```

Expected: FAIL because migration/domain files do not exist.

- [ ] **Step 2: Implement the minimal domain**

`normalizeAssessmentAnswer` must implement these exact rules:

```ts
MULTIPLE_CHOICE -> trimmed string exactly present in pinned options
TRUE_FALSE      -> boolean
SHORT_TEXT      -> trimmed non-empty string, <= 2_000 Unicode code points
LONG_TEXT       -> trimmed non-empty string, <= 20_000 Unicode code points
INTEGER         -> Number.isSafeInteger(value)
DECIMAL         -> typeof value === "number" && Number.isFinite(value)
```

It returns only the matching typed column populated and throws `AssessmentAttemptAnswerInputError` for invalid shape/value. It never accepts correctness/score/rubric data.

- [ ] **Step 3: Implement migration `0042`**

Create the attempt and answer tables with database checks matching the spec. Store text, boolean and numeric answers in separate nullable columns. Keep `current_position` one-based and, for submitted attempts, equal to `question_count`. The down migration drops only M2.07-owned objects and any M2.07-added supporting constraint on `generated_assessment_form_items`.

- [ ] **Step 4: Verify GREEN and rollback**

Run:

```bash
node --test tests/platform/assessment-attempt-contract.test.mjs tests/platform/assessment-attempt-rollback.test.mjs
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add database/migrations/0042_assessment_attempt_lifecycle.* src/lib/assessment-attempt/assessment-attempt-domain.ts tests/platform/assessment-attempt-contract.test.mjs tests/platform/assessment-attempt-rollback.test.mjs
git commit -m "feat: add M2.07 attempt persistence contract"
```

---

### Task 2: Transaction-compatible form generation and begin lifecycle

**Files:**
- Modify: `src/lib/assessment-generation/assessment-form-generation-service.ts`
- Create: `src/lib/assessment-attempt/assessment-attempt-repository.ts`
- Create: `src/lib/assessment-attempt/assessment-attempt-service.ts`
- Create: `tests/platform/assessment-attempt-begin-runtime.test.mjs`
- Create: `scripts/run-assessment-attempt-tests.mjs`

**Interfaces:**
- `AssessmentFormGenerationService.generateForCase(...)` keeps its existing public behavior.
- Add `AssessmentFormGenerationService.generateForCaseUsing(database, principal, input, now)` as the non-owning transaction operation. Existing `generateForCase` wraps it in `this.database.transaction(...)`; M2.07 begin calls it with the already-open transaction client.
- `AssessmentAttemptRepository` produces `findByForm`, `findOwned`, `lockOwned`, `insertAttempt`, `loadCurrentPinnedItem`, `findCommittedAnswer`, `insertCommittedAnswer`, `advancePosition`, `markSubmitted`.
- `AssessmentAttemptService.begin(principal, { caseId, catalogueVersionId }, now)` returns `AssessmentAttemptView`.
- `AssessmentAttemptView = { attempt: AssessmentAttemptRecord; currentQuestion: CurrentAssessmentQuestion | null; submitted: boolean }`.
- `CurrentAssessmentQuestion` contains only attempt ID, current position/count, pinned question ID/version/type, prompt, options, domain/difficulty/tags.

- [ ] **Step 1: Write RED begin runtime tests**

Cover:

```text
owning live Worker + eligible pending case -> begin succeeds
wrong role/revoked session/cross-Worker case -> generic access failure
repeated begin -> same form and same attempt
concurrent begin burst -> one attempt only
begin -> case becomes Assessment in progress exactly once
begin failure after form selection -> form/attempt/case/timeline/audit all roll back
returned view contains position 1 only and no later question/answerKey/rubric/score
```

Run:

```bash
node scripts/run-assessment-attempt-tests.mjs --begin
```

Expected: FAIL because attempt repository/service do not exist and form generation cannot yet share the outer transaction.

- [ ] **Step 2: Refactor M2.05 form generation without behavior drift**

Extract the body that currently runs inside `this.database.transaction` into `generateForCaseUsing(database, principal, input, now)`. Preserve all existing M2.05 invariants: one form per case/blueprint, framework match, unseen-question exclusion, random allocation, immutable item pins and audit. Existing M2.05 tests must remain green before M2.07 service code is added.

Run:

```bash
node --test tests/platform/assessment-form-generation-runtime.test.mjs 2>/dev/null || true
npm run typecheck
```

If the repository uses a dedicated M2.05 runner, execute that runner instead of inventing a replacement command.

- [ ] **Step 3: Implement repository and begin service**

Inside one transaction, `begin` must:

```text
1. validate live Worker role/session/worker.assessments.read
2. lock owned Assurance Case
3. require Assessment pending unless the same owned attempt already exists
4. re-resolve M2.06 catalogue eligibility for the selected case/catalogue version
5. call generateForCaseUsing(transactionDatabase, ...)
6. return existing attempt for that form or insert one
7. update case to Assessment in progress with Worker owner/next-action
8. insert assurance timeline event `assessment_attempt_started`
9. append trusted audit action `assessment.attempt.started`
10. load exactly the current pinned item and return the safe projection
```

Do not call an independently committing nested form-generation transaction.

- [ ] **Step 4: Verify GREEN plus M2.05 regression**

Run:

```bash
node scripts/run-assessment-attempt-tests.mjs --begin
npm run typecheck
npm run lint
```

Also run the existing M2.05 form-generation targeted tests/runner discovered by the repository.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assessment-generation/assessment-form-generation-service.ts src/lib/assessment-attempt tests/platform/assessment-attempt-begin-runtime.test.mjs scripts/run-assessment-attempt-tests.mjs
git commit -m "feat: begin atomic Worker assessment attempts"
```

---

### Task 3: Commit-before-next answer progression and concurrency safety

**Files:**
- Modify: `src/lib/assessment-attempt/assessment-attempt-repository.ts`
- Modify: `src/lib/assessment-attempt/assessment-attempt-service.ts`
- Create: `tests/platform/assessment-attempt-answer-runtime.test.mjs`
- Create: `tests/platform/assessment-attempt-concurrency-runtime.test.mjs`
- Modify: `scripts/run-assessment-attempt-tests.mjs`

**Interfaces:**
- Add `AssessmentAttemptService.getOwnedView(principal, attemptId, now): Promise<AssessmentAttemptView>`.
- Add `AssessmentAttemptService.submitCurrentAnswer(principal, { attemptId, position, questionVersionId, answer }, now): Promise<AssessmentAttemptView>`.
- The browser-supplied `position` and `questionVersionId` are stale-request guards only; the locked attempt/form item is authoritative.

- [ ] **Step 1: Write RED answer-type runtime tests**

For each of the six canonical types, prove one valid value commits and invalid values fail without state movement. Explicitly test multiple-choice option membership, short/long Unicode code-point limits, integer safe range, decimal finite-only, and that no correctness calculation/audit answer content exists.

Run:

```bash
node scripts/run-assessment-attempt-tests.mjs --answers
```

Expected: FAIL because submit behavior is missing.

- [ ] **Step 2: Implement minimal locked progression**

`submitCurrentAnswer` transaction sequence:

```text
lock owned IN_PROGRESS attempt
load exact generated form item at current_position
compare stale guards
normalize answer against pinned question type/options
check existing answer at requested position
  identical existing answer -> idempotently return current authoritative view
  different existing answer -> conflict
insert answer
if not final -> conditional current_position = current_position + 1
if final -> status=SUBMITTED, submitted_at=now, current_position stays question_count
on final -> audit `assessment.attempt.submitted` + assurance timeline `assessment_attempt_submitted`
return exactly one next question or submitted receipt
```

No branch computes answer correctness.

- [ ] **Step 3: Write and observe RED concurrency tests**

Use parallel submissions against the same attempt to prove:

```text
same answer duplicate -> one row, one progression
same stale request after progression -> no second progression
different answer for already committed position -> conflict
parallel final submits -> one submitted transition/audit event
persistence failure -> current_position does not move
```

Run:

```bash
node scripts/run-assessment-attempt-tests.mjs --concurrency
```

Expected before concurrency guards: FAIL.

- [ ] **Step 4: Harden repository constraints/conditional writes until GREEN**

Use row locking plus uniqueness/conditional updates; do not fix concurrency only in React/client state.

Run:

```bash
node scripts/run-assessment-attempt-tests.mjs
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assessment-attempt tests/platform/assessment-attempt-answer-runtime.test.mjs tests/platform/assessment-attempt-concurrency-runtime.test.mjs scripts/run-assessment-attempt-tests.mjs
git commit -m "feat: commit assessment answers before progression"
```

---

### Task 4: Worker server actions and one-question assessment window

**Files:**
- Create: `src/app/worker/(portal)/available-assessments/actions.ts`
- Modify: `src/app/worker/(portal)/available-assessments/page.tsx`
- Create: `src/app/worker/(portal)/assessments/[attemptId]/actions.ts`
- Create: `src/app/worker/(portal)/assessments/[attemptId]/page.tsx`
- Create: `src/components/worker/assessment-workspace.tsx`
- Create: `tests/platform/assessment-attempt-ui-contract.test.mjs`
- Create: `tests/platform/assessment-attempt-action-boundary.test.mjs`

**Interfaces:**
- `beginAssessmentAction(formData)` reads only `caseId` and `catalogueVersionId`, derives principal with `requirePlatformPermission`, calls `begin`, then redirects to `/worker/assessments/{attemptId}`.
- `submitAssessmentAnswerAction(previousState, formData)` derives principal, parses only stale guards plus the raw current answer, calls `submitCurrentAnswer`, and redirects back to the same owned attempt on success; expected input/conflict errors return coarse UI state.
- `AssessmentWorkspace` receives only `AssessmentAttemptView`; no complete form is accepted as a prop.

- [ ] **Step 1: Write RED UI/action-boundary tests**

Assert Available Assessments has a real POST launch control only when an item exists; GET page code never calls `begin`; the assessment page fetches only owned view; server actions call permission/service boundaries; component props/source contain no `answerKey`, `rubric`, `score`, `correct`, or generated form array. Assert controls exist for all six question types and no Previous button exists.

Run:

```bash
node --test tests/platform/assessment-attempt-ui-contract.test.mjs tests/platform/assessment-attempt-action-boundary.test.mjs
```

Expected: FAIL because UI/action files are absent.

- [ ] **Step 2: Implement launch server action and Available Assessments button**

Replace the M2.06 “launch intentionally unavailable” copy with an accessible form/button such as `Start assessment`. Keep case/catalogue IDs hidden fields only; do not send Worker ID/blueprint/form IDs from the browser.

- [ ] **Step 3: Implement owned read page and client workspace**

Render:

```text
Assessment
Question n of N
[prompt]
[type-specific control]
Next  OR  Submit assessment
```

For `MULTIPLE_CHOICE`, render radio options; `TRUE_FALSE`, two radio options; `SHORT_TEXT`, text input/textarea; `LONG_TEXT`, textarea; `INTEGER`, numeric input with integer step; `DECIMAL`, numeric input. Disable submit while pending and use accessible error status. On `SUBMITTED`, render receipt only.

- [ ] **Step 4: Verify no-secrets contract and strict build checks**

Run:

```bash
node --test tests/platform/assessment-attempt-ui-contract.test.mjs tests/platform/assessment-attempt-action-boundary.test.mjs
npm run typecheck
npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/worker/(portal)/available-assessments src/app/worker/(portal)/assessments src/components/worker/assessment-workspace.tsx tests/platform/assessment-attempt-ui-contract.test.mjs tests/platform/assessment-attempt-action-boundary.test.mjs
git commit -m "feat: add one-question Worker assessment window"
```

---

### Task 5: Real browser proof and secret-leakage verification

**Files:**
- Create: `scripts/m2-07-browser-qa.mjs`
- Create: `.github/workflows/m2-07-browser.yml`
- Create: `tests/platform/assessment-attempt-browser-contract.test.mjs`

**Interfaces:**
- Browser harness provisions an eligible Worker case/catalogue/form lineage through authoritative test setup, signs in as Worker, starts from `/worker/available-assessments`, and drives the visible UI.

- [ ] **Step 1: Write RED browser contract**

Require the script/workflow to test at minimum:

```text
eligible card -> Start assessment
question 1 visible; question 2 prompt absent from HTML/page text/network action result
multiple-choice submit -> question 2 only after server commit
written answer submit -> progression
final question button says Submit assessment
final submit -> submitted receipt
refresh in-progress -> committed current position resumes
cross-Worker direct attempt URL -> denied/not-found without existence leak
HTML/action payload scan -> no answerKey/rubric/score/correctness/future prompts
```

Run:

```bash
node --test tests/platform/assessment-attempt-browser-contract.test.mjs
```

Expected: FAIL until the harness exists.

- [ ] **Step 2: Implement browser harness using existing Chromium helpers/patterns**

Reuse the repository’s existing M2.06/hard-browser infrastructure; do not add a second browser framework or dependency.

- [ ] **Step 3: Run local/CI-equivalent browser proof**

Run the repository-supported M2.07 browser script. Any failure is fixed at the server/UI root cause, not by weakening assertions.

- [ ] **Step 4: Commit**

```bash
git add scripts/m2-07-browser-qa.mjs .github/workflows/m2-07-browser.yml tests/platform/assessment-attempt-browser-contract.test.mjs
git commit -m "test: add M2.07 browser assessment proof"
```

---

### Task 6: Permanent M2.07 gates, status documentation, and exact-head verification

**Files:**
- Create: `scripts/check-assessment-attempt-window.mjs`
- Modify: `scripts/run-assessment-attempt-tests.mjs`
- Create: `.github/workflows/m2-07-targeted.yml`
- Modify: `package.json`
- Modify: `scripts/run-engineering-gate.mjs`
- Modify: `docs/IMPLEMENTATION_STATUS.md`
- Create: `.engineering/M2.07-WORK-CONTRACT.md`
- Create after evidence exists: `.engineering/M2.07-ACCEPTANCE.md`

**Interfaces:**
- `npm run check:m2-07` runs static architecture/schema/UI contract checks.
- `npm run test:m2-07` runs contract, rollback, begin, answer, concurrency, UI, action-boundary and browser-contract tests (not the live browser job itself).
- Engineering gate includes the permanent M2.07 check/test commands.

- [ ] **Step 1: Write RED permanent-gate contract/check**

The checker must fail if `0042`, attempt domain/service/repository, one-question page/actions, targeted workflow, browser workflow, or required package scripts are missing; it must reject secret-field strings from Worker delivery DTOs/components.

- [ ] **Step 2: Wire package scripts and Engineering gate**

Add only M2.07 commands; preserve every existing script and gate. Update implementation status only with facts proven by tests, never future milestone claims.

- [ ] **Step 3: Run targeted verification**

```bash
npm run check:m2-07
npm run test:m2-07
npm run typecheck
npm run lint
npm run verify:affected
```

Expected: all PASS on the exact branch head.

- [ ] **Step 4: Run inherited regression and full Engineering Factory gate**

```bash
npm run verify:full
```

Also require the exact-head GitHub checks for M2.07 targeted, M2.07 browser, inherited Hard Browser QA, and any required retrospective/engineering workflows. Do not merge on a stale SHA.

- [ ] **Step 5: Review the final diff against the spec**

Verify explicitly:

```text
no M2.08 autosave/recovery implementation
no M2.09 proctoring implementation
no M2.10 scoring/review/result implementation
no Review pending transition
no hidden future-question serialization
no answer key/rubric/score delivery
no Worker ID trust from browser
no GET mutation
one durable answer before every progression
```

- [ ] **Step 6: Commit final gate/status evidence**

```bash
git add package.json scripts/check-assessment-attempt-window.mjs scripts/run-assessment-attempt-tests.mjs scripts/run-engineering-gate.mjs .github/workflows/m2-07-targeted.yml docs/IMPLEMENTATION_STATUS.md .engineering/M2.07-WORK-CONTRACT.md .engineering/M2.07-ACCEPTANCE.md
git commit -m "chore: gate and document M2.07 assessment window"
```

---

## Plan self-review

- Spec coverage: every M2.07 requirement is assigned to Tasks 1-6; M2.08-M2.10 boundaries are explicit.
- Placeholder scan: no TBD/TODO/“similar to” execution gaps remain.
- Type consistency: `AssessmentAttemptView`, `CurrentAssessmentQuestion`, `AssessmentAttemptRecord`, `normalizeAssessmentAnswer`, `begin`, `getOwnedView`, and `submitCurrentAnswer` use one spelling/signature throughout.
- Transaction consistency: M2.05 form generation is explicitly refactored to accept the outer M2.07 transaction; nested independent commit is prohibited.
- Route safety: launch is POST-only; attempt GET is read/resume-only.
- Completion semantics: `SUBMITTED` retains `currentPosition = questionCount`; Assurance Case remains `Assessment in progress` until M2.10.