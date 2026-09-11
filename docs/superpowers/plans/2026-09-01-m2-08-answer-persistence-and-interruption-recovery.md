# M2.08 Answer Persistence and Interruption Recovery Implementation Plan

> **Execution contract:** implement task-by-task with Superpowers `executing-plans` and strict `test-driven-development`. No production code for a behavior may be written until its RED test has been committed and proven to fail for the expected missing-behavior reason.

**Status:** READY FOR DOCS INTEGRATION. Generated from the owner-approved narrow M2.08 design after removing prior scope drift.

**Goal:** Persist the current uncommitted Worker answer on the server, recover the latest server-acknowledged draft after interruption, support Save and exit / Emergency exit / Resume assessment, and atomically remove the matching draft when the answer is committed—without weakening any M2.07 invariant.

**Verified design baseline:** `main` at `768169e94831dbf29cb0335f11148ffb9dc79b92`.

**Canonical spec:** `docs/superpowers/specs/2026-09-01-m2-08-answer-persistence-and-interruption-recovery-design.md`.

## Global constraints

These are binding for every task:

- Attempt statuses remain exactly `IN_PROGRESS | SUBMITTED`.
- `assessment_attempt_answers` remains append-only and is never used for autosave.
- No `localStorage`, IndexedDB, service-worker, Web Crypto, or other persistent browser answer cache.
- No successor/replacement attempts or forms.
- No technical-issue ticket/report subsystem.
- No M2.09 proctoring/integrity behavior.
- No M2.10 scoring/review/result-publication behavior.
- No Previous navigation or committed-answer editing.
- Only a live active Worker with `worker.assessments.read` can read/save/commit a draft; Worker identity comes from the trusted authorization principal.
- Browser-supplied position and question-version values are stale guards only. Form/form-item/question lineage is resolved from the locked attempt.
- Only one current question is ever returned to the Worker.
- Draft content must never enter generic audit/timeline metadata, logs, exception text, analytics, notifications, or email.
- Existing M2.05 global Worker/question non-repeat protections and M2.07 committed-answer protections stay green.
- Use an isolated implementation branch created from the **post-docs-merge verified exact main head**. Never implement on this documentation branch or directly on `main`.

## Existing repository anchors

The plan extends these accepted files rather than inventing parallel boundaries:

- `database/migrations/0042_assessment_attempt_lifecycle.up.sql`
- `database/migrations/0042_assessment_attempt_lifecycle.down.sql`
- `src/lib/assessment-attempt/assessment-attempt-domain.ts`
- `src/lib/assessment-attempt/assessment-attempt-repository.ts`
- `src/lib/assessment-attempt/assessment-attempt-service.ts`
- `src/lib/assessment-attempt/assessment-attempt-client-view.ts`
- `src/app/worker/(portal)/assessments/[attemptId]/actions.ts`
- `src/app/worker/(portal)/assessments/[attemptId]/page.tsx`
- `src/components/worker/assessment-workspace.tsx`
- `src/app/worker/(portal)/available-assessments/page.tsx`
- `scripts/run-assessment-attempt-tests.mjs`
- `scripts/check-assessment-attempt-window.mjs`
- `scripts/m2-07-browser-qa.mjs`
- `.github/workflows/m2-07-browser.yml`

## Planned new files

- `database/migrations/0043_assessment_attempt_drafts.up.sql`
- `database/migrations/0043_assessment_attempt_drafts.down.sql`
- `src/lib/assessment-attempt/assessment-attempt-draft-domain.ts`
- `tests/platform/assessment-attempt-draft-contract.test.mjs`
- `tests/platform/assessment-attempt-draft-rollback.test.mjs`
- `tests/platform/assessment-attempt-draft-runtime.test.mjs`
- `tests/platform/assessment-attempt-draft-concurrency-runtime.test.mjs`
- `tests/platform/assessment-attempt-draft-action-boundary.test.mjs`
- `tests/platform/assessment-attempt-draft-ui-contract.test.mjs`
- `tests/platform/assessment-attempt-resume-runtime.test.mjs`
- `tests/platform/assessment-attempt-resume-ui-contract.test.mjs`
- `scripts/m2-08-browser-qa.mjs`
- `.github/workflows/m2-08-browser.yml`

The exact number of test files may be reduced if one existing M2.07 test file is the clearer home for a behavior, but no production boundary may be created merely to satisfy this map.

---

## Task 0 — Integrate the approved docs and establish a clean implementation baseline

**Files:** documentation/governance only.

### Step 0.1 — Verify the docs-only PR diff

Required result:

```text
Only:
.engineering/CONTINUATION.json
docs/superpowers/specs/2026-09-01-m2-08-answer-persistence-and-interruption-recovery-design.md
docs/superpowers/plans/2026-09-01-m2-08-answer-persistence-and-interruption-recovery.md
```

The obsolete expanded-scope precision amendment must be removed.

### Step 0.2 — Run exact-head repository gates on the docs branch

At minimum inspect the PR's exact-head required checks and existing permanent audit check. Do not merge while checks are pending/failing or while review threads are unresolved.

### Step 0.3 — Merge with expected-head protection

Merge the docs PR only at the exact reviewed head.

### Step 0.4 — Verify resulting exact `main`

Require the existing Engineering Gate and permanent Independent full-system audit on the exact merge head. Record run IDs/digests in `.engineering/CONTINUATION.json` if repository governance requires it.

### Step 0.5 — Create isolated implementation branch

Create:

```text
feat/m2-08-answer-recovery
```

from the freshly verified exact `main` head.

No production edits before this branch exists.

---

## Task 1 — RED: draft schema and draft-form domain contract

**Files:**

- Create `tests/platform/assessment-attempt-draft-contract.test.mjs`
- Create `tests/platform/assessment-attempt-draft-rollback.test.mjs`
- Later create `database/migrations/0043_assessment_attempt_drafts.up.sql`
- Later create `database/migrations/0043_assessment_attempt_drafts.down.sql`
- Later create `src/lib/assessment-attempt/assessment-attempt-draft-domain.ts`

### Step 1.1 — Write schema/domain tests first

The RED tests must require all of these missing contracts:

```text
assessment_attempts status vocabulary remains IN_PROGRESS | SUBMITTED only
assessment_attempt_drafts exists
one row maximum per attempt
row binds attempt/form/form_item/position/question/question_version/question_type
revision is integer >= 1
latest mutation key is bounded and non-empty
latest mutation digest is fixed SHA-256 representation
created_at / updated_at are present
MULTIPLE_CHOICE draft is null or a selected text value
TRUE_FALSE draft is null or boolean
SHORT_TEXT exact string <= 2,000 Unicode code points
LONG_TEXT exact string <= 20,000 Unicode code points
INTEGER exact edit string <= 128 Unicode code points
DECIMAL exact edit string <= 128 Unicode code points
draft cannot bind an item outside the attempt form
down migration removes M2.08 draft structures only
rollback preserves M2.07 attempts/committed answers
reapply succeeds
```

The domain test must prove draft normalization is separate from `normalizeAssessmentAnswer` and preserves:

- empty string;
- leading/trailing whitespace;
- cleared `null` selection;
- integer edit states `-`, `+`;
- decimal edit states `.`, `1.`, `-`.

It must reject:

- a multiple-choice value outside pinned options;
- wrong type for true/false;
- over-bound strings by Unicode code point count;
- non-string numeric edit state.

### Step 1.2 — Verify RED

Run only the new tests:

```bash
node --test \
  tests/platform/assessment-attempt-draft-contract.test.mjs \
  tests/platform/assessment-attempt-draft-rollback.test.mjs
```

Expected: FAIL for the missing `0043` migration/domain behavior, not for syntax/import mistakes.

Record the failing output before writing production files.

### Step 1.3 — GREEN: implement the minimum migration/domain

Create the migration pair and draft domain only after RED is confirmed.

Preferred schema shape: explicit typed nullable value columns rather than unconstrained JSON, with a database check that the stored representation matches `question_type`. Preserve raw string edit state losslessly.

Do **not** change `ASSESSMENT_ATTEMPT_STATUSES` in `assessment-attempt-domain.ts`.

### Step 1.4 — Verify GREEN and regressions

```bash
node --test \
  tests/platform/assessment-attempt-draft-contract.test.mjs \
  tests/platform/assessment-attempt-draft-rollback.test.mjs
npm run test:m2-07
npm run typecheck
npm run lint
```

Then refactor only if all remain green.

---

## Task 2 — RED: repository draft read / CAS save / idempotency

**Files:**

- Modify `src/lib/assessment-attempt/assessment-attempt-repository.ts`
- Create `tests/platform/assessment-attempt-draft-runtime.test.mjs`
- Create `tests/platform/assessment-attempt-draft-concurrency-runtime.test.mjs`
- Modify `scripts/run-assessment-attempt-tests.mjs` only after RED if needed to compile/run the new runtime test dependencies.

### Step 2.1 — Write repository/runtime behavior tests first

Use the existing runtime-test compilation pattern from `scripts/run-assessment-attempt-tests.mjs` and real PGlite/database behavior rather than mocks where practical.

RED behaviors:

1. no draft returns `null`/first-write state;
2. first save inserts revision `1`;
3. matching expected revision updates and increments revision;
4. exact retry of latest mutation key + same payload returns the current accepted snapshot without another increment;
5. same mutation key + different payload fails closed;
6. stale expected revision fails without overwriting;
7. clearing a previously non-empty draft persists the cleared value;
8. stored draft projection does not expose the mutation digest;
9. delete-current-draft removes only the exact attempt/current-item draft;
10. draft methods never accept Worker authority independently of the owned attempt/service path.

### Step 2.2 — Verify RED

```bash
node scripts/run-assessment-attempt-tests.mjs --drafts
```

If the runner does not yet know `--drafts`, the new direct test command may be used for the first RED proof; only after RED may the runner be extended.

### Step 2.3 — GREEN: add repository primitives

Add narrowly named methods, for example:

- `findCurrentDraft(...)`
- `saveCurrentDraftCompareAndSwap(...)`
- `deleteCurrentDraft(...)`

Do not embed authorization decisions in repository helpers.

The repository may compute/persist the mutation digest in a server-only helper; do not return it in the client snapshot.

### Step 2.4 — GREEN verification

```bash
node scripts/run-assessment-attempt-tests.mjs --drafts
npm run test:m2-07
npm run typecheck
npm run lint
```

---

## Task 3 — RED: service authorization, authoritative lineage, and stale guards

**Files:**

- Modify `src/lib/assessment-attempt/assessment-attempt-service.ts`
- Modify/create runtime tests from Task 2

### Step 3.1 — Add failing service tests

Add RED cases for `saveCurrentDraft(principal, input)`:

- active owning Worker can save the current draft;
- another Worker gets the existing coarse access failure;
- Root/Admin/Verifier/Company principals fail closed;
- expired/revoked session fails closed;
- submitted attempt fails conflict;
- stale position fails conflict;
- stale questionVersionId fails conflict;
- server resolves form/form-item/question identity from the locked current item and never trusts a client form/item/question ID;
- already committed current position cannot receive a draft;
- draft option/type validation uses the pinned question type/options;
- stale revision fails conflict;
- exact latest mutation retry is idempotent;
- mutation key reuse with changed payload fails conflict;
- draft value never appears in audit/timeline writes or thrown error text.

### Step 3.2 — Verify RED

```bash
node scripts/run-assessment-attempt-tests.mjs --drafts
```

Expected failures must be the missing service boundary.

### Step 3.3 — GREEN: implement service save command

Reuse the existing `assertLiveWorker`, `normalizeAssessmentAttemptReference`, owned transaction, and locked current-item path.

Inside one transaction:

```text
assert live Worker
lock owned attempt
require IN_PROGRESS
load authoritative current item
check position/questionVersion stale guards
check no committed answer at current position
normalize draft-form value with pinned type/options
CAS repository save
return safe draft snapshot
```

No generic audit event for each autosave.

### Step 3.4 — Verify GREEN

```bash
node scripts/run-assessment-attempt-tests.mjs --drafts
npm run test:m2-07
npm run typecheck
npm run lint
```

---

## Task 4 — RED: owned view returns only current server draft

**Files:**

- Modify `src/lib/assessment-attempt/assessment-attempt-domain.ts`
- Modify `src/lib/assessment-attempt/assessment-attempt-client-view.ts`
- Modify `src/lib/assessment-attempt/assessment-attempt-service.ts`
- Extend `tests/platform/assessment-attempt-browser-contract.test.mjs`
- Extend draft runtime tests

### Step 4.1 — RED tests

Require an `IN_PROGRESS` client view to expose only safe draft state beside the existing current question:

```ts
currentDraft: {
  value: string | boolean | null;
  revision: number;
  updatedAt: string;
} | null
```

or an equivalently bounded representation.

Tests must prove:

- reload returns exact whitespace/partial numeric draft;
- no draft yields empty/unselected UI state;
- another Worker cannot read it;
- submitted receipt exposes no stale draft;
- serialized client view does not add form arrays, later questions, answer keys, rubrics, correctness, scores, pass/fail, reviewer data, mutation keys/digests, formItemId/questionId lineage beyond existing safe current-question fields.

### Step 4.2 — Verify RED

Run the focused browser-contract + runtime tests.

### Step 4.3 — GREEN

Extend the existing `view()`/client projection only. Do not add a separate recovery API for GET.

### Step 4.4 — Verify GREEN

```bash
npm run test:m2-07
node scripts/run-assessment-attempt-tests.mjs --drafts
npm run typecheck
npm run lint
```

---

## Task 5 — RED: commit transaction atomically deletes matching draft

**Files:**

- Modify `src/lib/assessment-attempt/assessment-attempt-repository.ts`
- Modify `src/lib/assessment-attempt/assessment-attempt-service.ts`
- Extend `tests/platform/assessment-attempt-answer-runtime.test.mjs`
- Extend `tests/platform/assessment-attempt-concurrency-runtime.test.mjs`

### Step 5.1 — Write failing commit/rollback tests

Required RED cases:

1. invalid committed answer leaves the draft unchanged;
2. successful `Next` inserts immutable answer, deletes matching draft, then advances;
3. successful final `Submit assessment` deletes final draft and marks submitted;
4. explicit submitted answer is commit authority even if an older draft differs;
5. failed committed-answer insert leaves draft and position unchanged;
6. forced draft-delete failure rolls the whole transaction back so committed answer/progression do not persist;
7. forced progression failure rolls the transaction back so answer and draft deletion do not persist;
8. stale autosave from the prior position after commit cannot recreate the old draft;
9. M2.07 exact committed-answer replay remains idempotent and cannot recreate/delete an unrelated current draft;
10. no committed answer is ever updated/deleted.

### Step 5.2 — Verify RED

```bash
node scripts/run-assessment-attempt-tests.mjs --answers
node scripts/run-assessment-attempt-tests.mjs --concurrency
```

### Step 5.3 — GREEN: narrow transaction extension

In the existing `submitCurrentAnswer()` transaction preserve order:

```text
normalize explicit submitted answer
insert committed answer
delete matching current-question draft
advance position OR mark submitted
return authoritative view
```

Because the existing `DatabaseClient.transaction()` wraps the whole service mutation, any downstream failure must roll all three mutations back.

### Step 5.4 — Verify GREEN + M2.07 locks

```bash
npm run test:m2-07
npm run check:m2-07
npm run typecheck
npm run lint
```

---

## Task 6 — RED: active attempt listing for Resume assessment

**Files:**

- Modify `src/lib/assessment-attempt/assessment-attempt-repository.ts`
- Modify `src/lib/assessment-attempt/assessment-attempt-service.ts`
- Create `tests/platform/assessment-attempt-resume-runtime.test.mjs`
- Later modify `src/app/worker/(portal)/available-assessments/page.tsx`

### Step 6.1 — RED runtime tests

Require a service method such as `listOwnedInProgress(principal)` to:

- derive Worker from the live principal;
- return only that Worker's `IN_PROGRESS` attempts;
- join only safe catalogue/case descriptive metadata needed by the page;
- require related Assurance Case consistency with `Assessment in progress` and the attempt reference where applicable;
- exclude `SUBMITTED` attempts;
- exclude foreign attempts;
- expose current position/question count but **not draft answer content** on the listing page;
- reject non-Worker/revoked principals.

### Step 6.2 — Verify RED

Run the new runtime test directly or through the extended M2.07 runner.

### Step 6.3 — GREEN repository/service projection

Implement the minimum read-only query and safe projection. No GET-side mutation.

### Step 6.4 — Verify GREEN

Run the new resume runtime test plus `npm run test:m2-07`, typecheck and lint.

---

## Task 7 — RED: server-action draft boundary

**Files:**

- Modify `src/app/worker/(portal)/assessments/[attemptId]/actions.ts`
- Create `tests/platform/assessment-attempt-draft-action-boundary.test.mjs`

### Step 7.1 — RED action contract tests

Require a dedicated `saveAssessmentDraftAction` (or equivalent) that accepts only:

- attemptId;
- position;
- questionVersionId;
- draft value encoded without converting partial numeric edit strings to numbers;
- expected revision/first-write sentinel;
- mutation key.

Tests must prove:

- no Worker ID/form ID/form-item ID/arbitrary question ID is accepted as authority;
- permission is required through the existing Worker authorization boundary;
- successful save returns a bounded safe state instead of redirecting;
- input/access/conflict errors map to coarse action states;
- same-question conflict can return the latest safe server draft/revision needed by conflict UI;
- draft body is not included in error strings/logging hooks;
- existing `submitAssessmentAnswerAction` remains the only commit action.

### Step 7.2 — Verify RED

```bash
node --test tests/platform/assessment-attempt-draft-action-boundary.test.mjs
```

### Step 7.3 — GREEN action adapter

Keep parsing/translation in the action and all authorization/current-lineage/concurrency authority in the service.

### Step 7.4 — Verify GREEN

Run the new test, M2.07 action-boundary test, typecheck, lint.

---

## Task 8 — RED: React autosave state machine and truthful persistence UX

**Files:**

- Modify `src/components/worker/assessment-workspace.tsx`
- Create a small hook/component only if it materially simplifies state correctness, e.g. `src/components/worker/use-assessment-draft-autosave.ts`
- Create `tests/platform/assessment-attempt-draft-ui-contract.test.mjs`
- Extend `tests/platform/assessment-attempt-ui-contract.test.mjs`

### Step 8.1 — RED UI contract

Require:

- answer initial value comes from `view.currentDraft`;
- all six types preserve draft-form edit state;
- integer/decimal draft encoding does not coerce partial input to a number before autosave;
- editing immediately marks local state unsaved/`Saving…`;
- debounced save is server-only; no persistent browser storage APIs are referenced;
- `Saved` appears only when the response acknowledges the exact latest edit state;
- an older save response cannot mark a newer edit as saved;
- network failure shows `Not saved — reconnecting` or equivalent;
- stale revision shows a controlled conflict state;
- conflict offers **Use saved version** and **Replace saved version with this tab** (or equivalent explicit choices);
- replacement issues a new CAS against the latest server revision; no force-write path;
- status region is accessible and does not steal focus;
- existing one-question-only layout and final button labels remain intact.

### Step 8.2 — Verify RED

Run the focused UI tests before changing the component.

### Step 8.3 — GREEN implementation

Use normal React state/effects/timers plus the server action. Do not add a browser persistence dependency.

A helper hook is acceptable only if it centralizes:

```text
current edit
last acknowledged edit/revision
pending mutation identity
stale/conflict state
debounce/flush
```

### Step 8.4 — Verify GREEN

```bash
node --test \
  tests/platform/assessment-attempt-draft-ui-contract.test.mjs \
  tests/platform/assessment-attempt-ui-contract.test.mjs
npm run test:m2-07
npm run typecheck
npm run lint
```

---

## Task 9 — RED: Save and exit / Emergency exit / Resume UI

**Files:**

- Modify `src/components/worker/assessment-workspace.tsx`
- Modify `src/app/worker/(portal)/available-assessments/page.tsx`
- Create `tests/platform/assessment-attempt-resume-ui-contract.test.mjs`
- Extend draft UI tests

### Step 9.1 — RED Save and exit contract

Require:

- control is visually/semantically separate from Next/Submit;
- it flushes the **exact current edit** through the normal draft-save path;
- navigation occurs only after that exact value is acknowledged;
- attempt remains IN_PROGRESS;
- no committed answer/progression occurs;
- failed flush leaves the Worker on the page and says it was not saved;
- no false success language.

### Step 9.2 — RED Emergency exit contract

Require:

- Emergency exit is always available while an attempt is active;
- it may trigger a best-effort immediate draft save;
- navigation cannot be blocked indefinitely by an unreachable save;
- no answer commit/progression/lifecycle mutation occurs;
- copy states that only the last server-confirmed Saved version is guaranteed recoverable.

Use a short bounded client-side best-effort window chosen during implementation and covered by tests; do not encode a server interruption/report workflow.

### Step 9.3 — RED Available Assessments / Resume UI

Require:

- `Available assessments` remains read-only on GET;
- a separate `In progress` section is rendered from the owned service projection;
- each item has `Resume assessment` linking to `/worker/assessments/{attemptId}`;
- no current draft answer body is rendered on the listing page;
- `SUBMITTED`/foreign attempts are absent.

### Step 9.4 — Verify RED, then GREEN minimally

After RED is proven, modify the component/page. Reuse existing design-system Button/panel/status classes; do not create a new navigation system.

### Step 9.5 — Verify GREEN

Run both new UI test files, existing M2.07 UI/browser-contract tests, typecheck and lint.

---

## Task 10 — Permanent M2.08 targeted gate

**Files:**

- Create or modify a focused checker such as `scripts/check-assessment-attempt-drafts.mjs`
- Extend `scripts/run-assessment-attempt-tests.mjs`
- Modify `package.json`
- Add permanent gate contract test if the repository pattern requires it.

### Step 10.1 — RED gate contract

Before package/script wiring, add a test that requires permanent commands, for example:

```json
"check:m2-08": "node scripts/check-assessment-attempt-drafts.mjs",
"test:m2-08": "node scripts/run-assessment-attempt-tests.mjs --m2-08"
```

The exact flag layout may be chosen to fit the existing runner, but the permanent gate must execute every M2.08 contract/runtime/UI test—not merely scan for checkpoint names.

### Step 10.2 — Verify RED

The gate-contract test must fail because the commands/wiring do not yet exist.

### Step 10.3 — GREEN wiring

Add the minimum scripts and runner entries. Do not duplicate M2.07 compilation logic.

### Step 10.4 — Verify GREEN

```bash
npm run check:m2-08
npm run test:m2-08
npm run check:m2-07
npm run test:m2-07
```

---

## Task 11 — Real Chromium M2.08 browser QA

**Files:**

- Create `scripts/m2-08-browser-qa.mjs`
- Create `.github/workflows/m2-08-browser.yml`
- Add/extend a workflow-contract test before workflow implementation.

### Step 11.1 — RED browser/workflow contract

The test must require a dedicated workflow/script that actually executes the M2.08 journeys at the exact head. It must not repeat the earlier hard-browser defect where checkpoint names across unexecuted scripts could satisfy a coverage contract.

### Step 11.2 — Browser scenarios

Use a real isolated database and Chromium to prove:

1. Worker begins/opens current question.
2. Worker types a draft; UI reaches `Saved` only after server acknowledgement.
3. Reload restores the exact draft including whitespace/partial numeric edit state where applicable.
4. A fresh authenticated browser context for the same Worker restores the server draft without local browser persistence.
5. Browser storage inspection confirms no M2.08 answer is persisted in localStorage/IndexedDB/service-worker caches by the feature.
6. Save and exit waits for successful save and returns to Worker assessment surface.
7. `In progress` lists the attempt; Resume restores the same current question/draft.
8. Induced save failure causes Save and exit to remain on page with truthful unsaved state.
9. Emergency exit leaves even while the save route/server request is failed/delayed and does not commit/advance.
10. Two same-Worker tabs starting at the same revision produce a controlled stale conflict; the loser never silently overwrites.
11. Explicit conflict resolution against latest revision behaves deterministically.
12. Next commits the answer, removes draft, advances exactly one position, and exposes only the next question.
13. Delayed old-position autosave after advance fails and cannot recreate the old draft.
14. Final submit leaves no draft.
15. Cross-Worker direct attempt/draft probes fail closed.
16. No future question arrays, answer keys, rubrics, correctness/scoring/pass-fail/reviewer data appear in HTML/network payloads retained by the QA.
17. No unexpected browser console error/hydration warning occurs.

For screenshots use Playwright `caret: "initial"` or otherwise avoid the prior audit's harness-induced caret hydration mutation.

### Step 11.3 — Workflow behavior

The workflow must:

- run on pull requests touching relevant M2.08/M2.07 files and on `main` as appropriate;
- run against the exact checked-out commit;
- retain results/screenshots/server logs/traffic summary as artifacts;
- fail on unexpected console/hydration/server errors;
- avoid recording draft answer content in logs beyond deliberately controlled synthetic QA data artifacts.

### Step 11.4 — Verify targeted + browser gate

Require both `npm run test:m2-08` and the real-browser workflow green at the exact feature head.

---

## Task 12 — Full regression, rollback, security, and closure

### Step 12.1 — Exact M2.05 randomized-form regression

Run the six existing tests exactly:

```bash
node --test \
  tests/platform/randomized-assessment-form-contract.test.mjs \
  tests/platform/randomized-assessment-form-integrity.test.mjs \
  tests/platform/randomized-assessment-form-rollback.test.mjs \
  tests/platform/randomized-assessment-form-runtime.test.mjs \
  tests/platform/randomized-assessment-selector-matching.test.mjs \
  tests/platform/randomized-assessment-cross-case-race.test.mjs
```

No successor/replacement-form code should exist in the diff.

### Step 12.2 — M2.07 regression locks

```bash
npm run check:m2-07
npm run test:m2-07
```

Also run the accepted M2.07 real-browser QA against the exact candidate head.

### Step 12.3 — Migration rollback/reapply

Prove `0043` up -> down -> up using the repository's migration test pattern. Confirm M2.07 attempts/answers survive the cycle unchanged.

### Step 12.4 — Static/security checks

```bash
npm run typecheck
npm run lint
npm run audit:production
```

Inspect the final diff for forbidden scope markers:

```text
IndexedDB
localStorage
CryptoKey
INTERRUPTED
RECOVERABLE
successor/replacement assessment form
technical issue report/ticket
scoring/pass-fail/reviewer implementation
```

Legitimate mentions in the approved docs/tests that assert absence are allowed; production implementation must not add those capabilities.

### Step 12.5 — Full Engineering Gate

Run the repository's full Engineering Gate on the exact candidate head and retain artifact/run evidence.

### Step 12.6 — Independent full-system audit

Run the permanent Independent full-system audit against the same exact head. Require zero new critical/high findings and inspect all findings rather than stopping after the first.

### Step 12.7 — PR review closure

Before merge:

- exact head unchanged since verification;
- no unresolved review threads;
- all required targeted/browser/full gates green;
- diff still matches the owner-approved M2.08 scope.

### Step 12.8 — Merge with expected-head protection

Merge only the exact verified feature head.

### Step 12.9 — Post-merge exact-main verification

On resulting `main`:

- rerun/confirm Engineering Gate;
- rerun/confirm Independent full-system audit;
- run M2.08 targeted gate;
- run M2.08 browser gate when configured for main;
- verify M2.07 locks remain green.

Only after fresh evidence may M2.08 be marked accepted/merged/post-merge verified.

---

## Acceptance checklist

M2.08 is complete only when all are true:

- [ ] One server draft maximum exists only for the authoritative current uncommitted question.
- [ ] Draft normalization preserves cleared/whitespace/partial numeric edit states without weakening committed-answer normalization.
- [ ] CAS revision + latest-mutation idempotency prevents stale overwrite.
- [ ] Cross-Worker/non-Worker/revoked/submitted/stale requests fail closed.
- [ ] Reload/cross-device recovery returns the latest server-acknowledged draft only.
- [ ] No persistent browser answer cache exists.
- [ ] `Saved` means server acknowledged the exact current edit.
- [ ] Save and exit flushes successfully before leaving and never commits/advances.
- [ ] Emergency exit never traps the Worker and never commits/advances.
- [ ] Available Assessments has an owned In progress / Resume assessment section without rendering draft bodies.
- [ ] Commit inserts immutable answer, deletes matching draft, then advances/submits atomically.
- [ ] Stale old-position autosave cannot recreate a draft after commit.
- [ ] Final submission leaves no draft.
- [ ] M2.05 randomized-form and M2.07 attempt regressions remain green.
- [ ] M2.08 real Chromium QA is green with no unexpected console/hydration errors.
- [ ] No future questions, keys, rubrics, scores, pass/fail, reviewer data, or draft bodies leak into unauthorized outputs/logs/audit metadata.
- [ ] No new lifecycle states, successor forms, technical-issue subsystem, proctoring, or scoring implementation entered M2.08.
- [ ] Exact-head full Engineering + Independent audit are green before merge.
- [ ] Exact-main post-merge verification is green before closure.
