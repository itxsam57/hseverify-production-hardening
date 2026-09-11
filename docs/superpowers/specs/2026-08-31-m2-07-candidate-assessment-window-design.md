# M2.07 Candidate Assessment Window Design

## Status

Approved architecture captured from the M2.07 design review on 2026-08-31. This document is the implementation contract for M2.07 and is based on verified `main` commit `a3ee0381bc482e5ba49c728f80b9cdc0eb01b6cb`.

## Goal

Build the first real Worker assessment attempt lifecycle: an eligible Worker can begin the immutable generated assessment form for an Assurance Case, see exactly one question at a time, submit a type-safe answer, advance only after that answer is committed server-side, and finish with an immutable submitted attempt. The browser must never receive future questions, answer keys, rubrics, scoring data, or the complete generated form.

## Existing contracts this design extends

- `src/lib/assessment-catalogue/assessment-catalogue-eligibility-service.ts` exposes only cases owned by the live Worker, requires `worker.assessments.read`, requires `case_status = 'Assessment pending'`, and pins `caseId + catalogueVersionId + blueprintVersionId`.
- `src/lib/assessment-generation/assessment-form-generation-service.ts` creates or returns one immutable generated form for a case/blueprint, requires the case to be `Assessment pending`, verifies the policy framework, and permanently excludes questions previously exposed to that Worker.
- `src/lib/assessment-generation/assessment-form-delivery-service.ts` reconstructs the immutable generated form from pinned question versions rather than current-question state.
- `src/lib/question-bank/question-bank-domain.ts` defines exactly six question types: `MULTIPLE_CHOICE`, `TRUE_FALSE`, `SHORT_TEXT`, `LONG_TEXT`, `INTEGER`, and `DECIMAL`.
- `src/lib/question-bank/question-delivery-service.ts` demonstrates the safe delivery projection: prompt/options and descriptive metadata are deliverable; answer keys and rubrics are deliberately absent.
- `src/lib/assurance/assurance-order-domain.ts` defines `Assessment pending`, `Assessment in progress`, and `Review pending` as distinct Assurance Case states.

## Scope boundary

M2.07 owns:

1. beginning a Worker-owned eligible assessment;
2. the persistent assessment-attempt aggregate;
3. the persistent committed answer rows;
4. one-question-only server projection;
5. type-specific answer validation;
6. atomic answer commit and forward progression;
7. final attempt submission after the last committed answer;
8. the Worker assessment window required to exercise this lifecycle;
9. audit/timeline evidence for beginning and submitting the attempt;
10. the case transition from `Assessment pending` to `Assessment in progress` when the attempt begins.

M2.07 does **not** own:

- autosave of uncommitted text, interruption recovery, reconnect UX, or emergency recovery controls; those remain M2.08;
- webcam/microphone/screen integrity controls, violation detection, secure-window enforcement beyond server-side question secrecy, or incident reporting; those remain M2.09;
- scoring, pass/fail calculation, rubric assessment, reviewer allocation, result publication, or transition to `Review pending`; those remain M2.10;
- assessment timers, because the current blueprint contract contains no authoritative duration setting;
- retake/reassessment orchestration.

Finishing the last answer changes the **attempt** to `SUBMITTED` but does not advance the Assurance Case to `Review pending`. M2.10 owns that downstream transition after scoring/review prerequisites exist.

## Attempt aggregate

A new server-owned assessment-attempt aggregate is created from the trusted Worker principal and the exact eligible case/catalogue/blueprint/form lineage.

The attempt persists:

- `attemptId`;
- `caseId`;
- `workerAccountId`;
- `catalogueVersionId`;
- `blueprintVersionId`;
- `formId`;
- `status`: `IN_PROGRESS | SUBMITTED`;
- `currentPosition`;
- `questionCount`;
- `startedAt`;
- `submittedAt`, null until final submission;
- `createdAt` and `updatedAt`.

`currentPosition` is one-based. While `IN_PROGRESS`, it identifies the only question that may be delivered. On final submission it remains equal to `questionCount`; the `SUBMITTED` status, not `questionCount + 1`, represents completion.

The database enforces one attempt per immutable generated form. Repeated begin requests for the same Worker/case/catalogue/blueprint converge on the same attempt rather than creating duplicates.

An attempt is never addressed by Worker identity supplied by the client. Worker ownership always comes from the authenticated principal and is rechecked against the Assurance Case/form lineage inside the mutation transaction.

## Begin transaction

`begin` accepts only the case and catalogue version selected from the Worker’s eligible assessment surface. The server re-resolves eligibility and blueprint lineage instead of trusting browser-supplied metadata.

Within one transaction the service must:

1. verify a live active Worker session with `worker.assessments.read`;
2. lock the Worker-owned Assurance Case and require `Assessment pending`, unless the same attempt already exists and is being returned idempotently;
3. re-resolve the selected active catalogue version and policy-matching blueprint;
4. generate or load the immutable M2.05 form for the case/blueprint;
5. create the attempt if absent, or load the existing attempt if present;
6. transition the Assurance Case from `Assessment pending` to `Assessment in progress` exactly once;
7. set case owner to `worker` and a next action that clearly states the Worker must complete the assessment;
8. append the assurance timeline/audit evidence in the same transaction;
9. return only the attempt shell and current-question projection.

The existing form-generation behavior currently owns its own transaction. M2.07 must factor the reusable generation operation so it can run against the attempt transaction’s `DatabaseClient`; it must not nest an independently committing form-generation transaction inside begin. If any required write fails, form creation, attempt creation, case transition, timeline, and audit all roll back together.

## Current-question projection

The browser receives exactly one `CurrentAssessmentQuestion` at a time:

- `attemptId`;
- `position`;
- `questionCount`;
- `questionId`;
- `questionVersionId`;
- `questionType`;
- `prompt`;
- `options` only when applicable;
- non-sensitive descriptive metadata only if already present in the existing safe form projection.

The projection is reconstructed server-side from the immutable generated form item at `currentPosition`. It never serializes the remaining form items.

The following must never be present in a Worker response, page payload, action result, browser state, or HTML source:

- later question prompts or IDs;
- complete form item arrays;
- `answerKey`;
- written `rubric` criteria or points;
- score, correctness, pass/fail, or reviewer-only metadata.

The generated form remains immutable even if the underlying question is later made inactive or a newer question version becomes current. M2.07 reads the question version pinned by the form item, matching the existing `AssessmentFormDeliveryService` behavior.

## Candidate answer contract

A submitted answer is tied to the **current pinned form item**, not to an arbitrary question ID supplied by the browser. The client may echo `position` and `questionVersionId` only as stale-request guards; the server resolves the authoritative item from the locked attempt/form.

Canonical persisted answer values are type-matched primitives:

- `MULTIPLE_CHOICE`: string exactly matching one option in the pinned delivered options after trimming outer whitespace;
- `TRUE_FALSE`: boolean;
- `SHORT_TEXT`: non-empty string, maximum 2,000 Unicode code points; trim leading/trailing whitespace but preserve internal whitespace and line breaks;
- `LONG_TEXT`: non-empty string, maximum 20,000 Unicode code points; trim leading/trailing whitespace but preserve internal whitespace and line breaks;
- `INTEGER`: finite JavaScript-safe integer;
- `DECIMAL`: finite number.

No answer endpoint accepts `answerKey`, rubric, correctness, score, or arbitrary JSON objects.

A committed answer row persists:

- `answerId`;
- `attemptId`;
- `formId`;
- `formItemId`;
- `position`;
- `questionId`;
- `questionVersionId`;
- `questionType`;
- exactly one typed value column: text, boolean, or numeric according to `questionType`;
- `committedAt`.

There is at most one committed answer for each attempt position. In M2.07, a committed answer is final for that position; answer editing/back-navigation is not introduced.

## Commit-before-next progression

`submitCurrentAnswer` is a server transaction over a locked attempt.

The command must:

1. require an active Worker principal and Worker ownership;
2. require attempt status `IN_PROGRESS`;
3. resolve the authoritative current form item from `currentPosition`;
4. reject a stale request whose echoed position/question version does not match the locked current item;
5. normalize and validate the answer against the pinned question type/options;
6. insert the committed answer exactly once;
7. only after the answer insert succeeds, advance `currentPosition` to the next item;
8. if the committed answer was the final item, keep `currentPosition = questionCount`, set attempt status to `SUBMITTED`, set `submittedAt`, and do not reveal another question;
9. append final submission audit/timeline evidence when the attempt becomes submitted;
10. return either the single next-question projection or a submitted receipt.

A database uniqueness constraint plus the locked attempt/conditional write make duplicate clicks, retries, or concurrent requests safe. A second identical request after the first commit never skips a question or creates a second answer. A stale or different answer after progression fails closed rather than overwriting committed evidence.

The service never calculates correctness during this command.

## Assurance Case behavior

Beginning the attempt is the only M2.07 case-state transition:

`Assessment pending` -> `Assessment in progress`

The transition is atomic with successful form/attempt creation and carries Worker ownership/next-action plus timeline/audit evidence.

Final attempt submission leaves the Assurance Case in `Assessment in progress`. This is intentional. `Review pending` is a separate canonical state and requires M2.10 scoring/review behavior that does not exist yet. M2.07 must not manufacture that downstream meaning.

## Authorization and isolation

Every read or mutation derives the Worker from the trusted authorization principal. A Worker receives indistinguishable not-found/access behavior for another Worker’s attempt or case.

Server-side checks cover all of the following even when the route/UI already hides the action:

- active session;
- active Worker role;
- `worker.assessments.read` permission;
- Assurance Case `worker_account_id` equals principal account ID;
- generated form `worker_account_id` equals principal account ID;
- attempt `worker_account_id` equals principal account ID;
- case/form/blueprint/catalogue lineage is internally consistent.

Company, reviewer, assessor, and admin principals cannot execute Worker attempt commands through direct action/API calls merely because they know an ID.

## Error behavior

Public-facing errors are deliberately coarse:

- invalid references: input error;
- wrong owner, wrong role, expired/revoked session, or hidden resource: generic access/not-found error without existence leakage;
- stale position/question version or concurrent progression: conflict error instructing the UI to reload current state;
- invalid answer shape/value: answer input error without exposing correctness;
- corrupted form/attempt invariants: fail closed and do not advance state.

No failure response contains the correct answer, rubric, hidden form positions, or future-question metadata.

## Worker assessment window

The Worker portal provides a dedicated assessment route/window reached from the existing available-assessments surface.

The M2.07 UI:

- starts/resumes through the server attempt service;
- displays one question only;
- renders controls for the six canonical question types;
- disables progression while a submission is in flight;
- shows position as `n of N` without revealing future content;
- requires a valid current answer before enabling/performing Next/Submit;
- uses `Submit assessment` wording on the final question;
- shows a clear submitted receipt after the server reports `SUBMITTED`;
- provides no previous-question navigation in M2.07;
- provides no client-side scoring/correctness feedback.

M2.08 adds robust interruption/autosave recovery. M2.07 may reload the committed server state for an already-created in-progress attempt, but it does not promise preservation of text the Worker typed but did not commit.

## Database model and integrity

`assessment_attempts` stores the attempt aggregate. It has foreign keys to the Assurance Case, Worker account, catalogue version, blueprint version, and generated form. It has a unique `form_id`. It also has a unique `(attempt_id, form_id)` key used to bind answers to the same form as their attempt.

`assessment_attempt_answers` stores committed answers. It contains `attempt_id`, `form_id`, and `form_item_id`. The generated-form-item table exposes a unique `(form_id, form_item_id)` key, and answers use a composite foreign key to that pair. Answers also use a composite foreign key `(attempt_id, form_id)` to the attempt. This makes it impossible for an answer row to reference a form item outside its attempt form.

The migration enforces:

- attempt status is only `IN_PROGRESS` or `SUBMITTED`;
- `question_count >= 1`;
- `current_position` is between 1 and `question_count`;
- `IN_PROGRESS` attempts have `submitted_at IS NULL`;
- `SUBMITTED` attempts have `submitted_at IS NOT NULL` and `current_position = question_count`;
- one attempt per immutable form;
- one answer per `(attempt_id, position)`;
- answer position is positive;
- answer rows reference their exact generated form item, question, and pinned question version;
- exactly one typed value column is populated according to `question_type`;
- text answers cannot be empty and cannot exceed their type limit;
- integer answers are integral and within the JavaScript safe-integer range;
- numeric answers are finite at the application boundary;
- foreign keys protect the case, Worker, catalogue version, blueprint version, generated form, generated form item, question, and question version lineage.

Application transactions add authorization and semantic checks such as live-session state and ensuring the case/catalogue/blueprint selection is currently eligible at first begin.

## Audit and timeline evidence

Successful begin and final submit are auditable with trusted actor binding and stable resource references. Audit metadata may contain IDs, position counts, timestamps, and state changes, but never candidate answer content, answer keys, rubrics, or future-question content.

The Assurance timeline records the begin state transition. Final attempt submission records an assessment-submitted event while retaining `Assessment in progress` as both the case’s actual status and the event’s resulting status; it does not falsely move the case to `Review pending`.

## Testing contract

Implementation follows strict RED -> GREEN -> REFACTOR TDD. Production code is not added until its behavior has first failed in an automated test for the expected reason.

Coverage includes:

- begin succeeds only for the eligible owning Worker;
- begin is idempotent under repeated/concurrent requests;
- wrong-role and cross-Worker access fail closed;
- case changes to `Assessment in progress` atomically with begin;
- form generation participates in that transaction rather than committing independently;
- only position 1 is projected initially;
- response/HTML/action payloads contain no later questions, answer keys, rubrics, or scores;
- all six answer types accept valid values and reject invalid values;
- multiple choice cannot submit a value outside the pinned options;
- stale position/question-version submissions cannot skip or overwrite answers;
- duplicate/concurrent submissions cannot create duplicate answers or advance twice;
- next question is returned only after answer persistence succeeds;
- final answer produces `SUBMITTED` attempt state and a submitted receipt;
- final submission does not transition the Assurance Case to `Review pending`;
- immutable pinned question versions continue to deliver even after current-question state changes;
- browser flow covers multiple-choice and written-question progression at minimum, including final submission;
- full existing regression and Engineering gates remain green.

## Acceptance criteria

M2.07 is complete only when a real authenticated Worker can select an eligible assessment, begin exactly one immutable attempt, answer every generated question one at a time, and submit the attempt without the browser ever receiving hidden future questions or scoring secrets; every answer is durably and uniquely committed before progression; unauthorized, cross-worker, stale, duplicate, and concurrent paths fail safely; the Assurance Case truth remains coherent; targeted tests, browser tests, and the repository’s complete Engineering gate are green on the exact PR head.