# M2.08 Answer Persistence and Interruption Recovery Design

## Status

**OWNER APPROVED — 2026-09-01.**

This is the canonical M2.08 design approved by the owner after scope-correction review. It is based on verified `main` commit `768169e94831dbf29cb0335f11148ffb9dc79b92`.

The approval authorizes implementation planning and subsequent implementation only inside the boundary defined here. Any older M2.08 document that adds persistent browser answer storage, new attempt lifecycle states, successor/replacement forms, or a technical-issue reporting subsystem is superseded by this specification.

## Goal

Make an active Worker assessment resilient to ordinary interruption without weakening any accepted M2.07 guarantee.

A Worker must be able to type the current uncommitted answer, have that in-progress work autosaved to a server-authoritative draft, reload or return later, and recover the latest draft that the server actually acknowledged. The Worker must also have a clear **Save and exit** path and a separate **Emergency exit** path that never traps them.

Autosave is never answer submission. `Next` and final `Submit assessment` remain the only operations that create an immutable committed answer and advance the attempt.

## Locked M2.07 contracts

M2.08 extends M2.07; it does not redesign it.

The following remain mandatory:

- `assessment_attempt_answers` is the append-only committed-answer ledger.
- Attempt statuses remain exactly `IN_PROGRESS | SUBMITTED` in M2.08.
- A Worker receives exactly one current pinned question at a time.
- Future questions, complete form item arrays, answer keys, rubrics, correctness, scoring, pass/fail, and reviewer-only data never enter Worker responses or browser state.
- Worker identity comes only from the live trusted authorization principal.
- The authoritative current form item comes from the locked attempt/form lineage, never browser-supplied form or question authority.
- A committed answer is inserted before progression.
- A committed answer cannot be edited, deleted, or replaced.
- There is no Previous/back-editing control.
- Final submission leaves the Assurance Case at `Assessment in progress`; M2.10 owns later scoring/review state.
- M2.05 generated-form immutability/non-repeat behavior and M2.06 ownership/eligibility behavior remain unchanged.
- Existing M2.07 targeted, Chromium, regression, Engineering, and Independent full-system audit gates remain required.

## Scope boundary

M2.08 owns only:

1. one mutable server draft for the active uncommitted question;
2. server-authoritative draft autosave;
3. raw edit-state preservation for all six existing question types;
4. optimistic draft revisions and stale-tab/device conflict protection;
5. recovery of the latest server-acknowledged current draft after reload, browser restart, session interruption, or another device login;
6. truthful saving/saved/error UI state;
7. explicit **Save and exit** behavior;
8. explicit **Emergency exit** behavior that never traps the Worker;
9. a Worker-visible **In progress / Resume assessment** entry point for owned `IN_PROGRESS` attempts;
10. atomic removal of the matching draft when its answer becomes immutably committed;
11. migration, rollback, security, browser, and regression evidence for those behaviors.

M2.08 explicitly does **not** own:

- persistent `localStorage`, IndexedDB, service-worker, Web Crypto, or other browser answer caching;
- offline claims that unsent keystrokes are durable;
- new `INTERRUPTED`, `RECOVERABLE`, `ABANDONED`, or successor attempt statuses;
- replacement/successor assessment forms or retake/reassessment orchestration;
- technical-issue ticket/report workflows;
- webcam, microphone, screen capture, focus/window enforcement, proctoring, integrity incidents, or anti-cheat scoring;
- answer correctness, scoring, pass/fail, rubric review, reviewer allocation, result publication, or `Review pending` transition;
- Previous navigation or committed-answer editing.

M2.09 and M2.10 remain separate Governor bricks.

## Architectural decision

M2.08 uses **server-authoritative durable draft persistence beside the immutable M2.07 committed-answer path**.

Three meanings remain distinct:

- **React edit state** — what is currently visible while the page is open; temporary and not described as durable.
- **Server draft** — the latest uncommitted current-question value that the server accepted; mutable, revisioned, recoverable.
- **Committed answer** — immutable M2.07 evidence created only by `Next` or final `Submit assessment`.

The browser does not keep a persistent answer cache. This avoids leaving candidate answer material behind on shared devices and avoids creating a second recovery authority. Cross-device recovery therefore has one simple truth: the latest server-acknowledged draft.

If connectivity fails before a change reaches the server, the UI must say that the newest change is not yet saved. M2.08 guarantees recovery of acknowledged server drafts, not recovery of keystrokes that never reached durable storage.

## Server draft aggregate

Introduce a dedicated mutable table, `assessment_attempt_drafts`.

There is at most one draft per attempt because M2.07 permits editing only the authoritative current question.

The draft persists at least:

- `attemptId`;
- `formId`;
- `formItemId`;
- `position`;
- `questionId`;
- `questionVersionId`;
- `questionType`;
- one draft-form value;
- monotonically increasing `revision`;
- latest accepted mutation/idempotency key;
- a safe payload digest used only for idempotent retry comparison;
- `createdAt`;
- `updatedAt`.

The database must bind the row to the same attempt/form/item/question/version lineage used by M2.07 committed answers. Application transactions additionally require that the draft position is still the locked attempt's current position.

A draft row must never be accepted for a submitted attempt, a foreign Worker, a non-current form item, or a position that already has a committed answer.

### Draft values are deliberately not committed-answer values

Autosave preserves edit state, including states that are intentionally not yet submit-valid. It must not call final committed-answer normalization as a prerequisite for saving.

Draft representation is narrow and type-specific:

- `MULTIPLE_CHOICE`: pinned option string or no selection (`null`); any selected value must be one of the delivered pinned options.
- `TRUE_FALSE`: boolean or no selection (`null`).
- `SHORT_TEXT`: exact editable string, including empty string and leading/trailing whitespace, maximum 2,000 Unicode code points.
- `LONG_TEXT`: exact editable string, including empty string and leading/trailing whitespace, maximum 20,000 Unicode code points.
- `INTEGER`: exact bounded input string, maximum 128 Unicode code points, so partial states such as `-`, `+`, or digits in progress survive autosave.
- `DECIMAL`: exact bounded input string, maximum 128 Unicode code points, so partial states such as `-`, `.`, `1.`, or other in-progress decimal editing states survive autosave.

Final validation and normalization remain exclusively on the M2.07 commit path. An incomplete draft can be saved and recovered but still rejected by `Next`/`Submit assessment` until it is a valid final answer.

Clearing a previously saved value must itself be persistable. Recovery must not resurrect an older non-empty value merely because the current draft is empty or unselected.

## Draft-save command

The assessment-attempt service gains a server draft-save boundary. The client supplies only stale/concurrency guards and the draft value; it never supplies Worker authority or trusted form lineage.

A save request contains only:

- `attemptId`;
- echoed current `position`;
- echoed current `questionVersionId`;
- draft-form value;
- `expectedRevision` or first-write sentinel;
- client-generated mutation/idempotency key.

Inside one transaction the server must:

1. verify the live active Worker principal and `worker.assessments.read` permission;
2. lock the owned attempt;
3. require `IN_PROGRESS`;
4. resolve the authoritative current generated-form item;
5. require the echoed position/question version to match that item;
6. prove no committed answer already owns that current position;
7. validate only draft-form shape/bounds for the pinned question type/options;
8. load the current draft revision;
9. apply compare-and-swap against `expectedRevision`;
10. treat an exact retry of the latest accepted mutation key and payload as idempotent;
11. reject reuse of that mutation key with a different payload;
12. insert/update the draft and increase revision only when all preconditions hold;
13. return only the safe current draft value, revision, and saved timestamp.

A delayed request from an older revision is stale even if it arrives last. It never overwrites newer server state.

### Mutation digest

The server may persist a SHA-256 digest of the normalized draft-save mutation payload to distinguish an exact idempotent retry from mutation-key reuse with different content. That digest is server-only operational state. It is not returned to the Worker and is not copied into generic audit/timeline metadata.

## Concurrency and stale-tab/device arbitration

Draft `revision` is monotonically increasing.

Required behavior:

- two tabs that start from the same revision cannot silently overwrite each other;
- the first valid compare-and-swap may win, while the other receives a controlled conflict;
- delayed requests from an old revision cannot overwrite a newer value;
- exact retry of the latest accepted mutation converges idempotently;
- same mutation key with different content fails closed;
- a tab on an old question cannot save after another request commits and advances the attempt;
- a submitted attempt can never accept another draft.

For a true same-question conflict, the UI fetches the authoritative current server draft and presents a deliberate choice such as **Use saved version** or **Replace saved version with this tab**. Replacing must be a new compare-and-swap against the latest revision; there is no blind force-write.

If the authoritative attempt has already advanced, local edit state from the old question is discarded from the active UI and cannot be written into the new position.

## Recovery projection

`getOwnedView()` remains a read-only authenticated operation. For an `IN_PROGRESS` attempt it may return the existing single current-question projection plus that question's current server draft.

The client projection may expose only:

- current question fields already accepted in M2.07;
- current draft value or `null`;
- current draft revision or first-write state;
- server `updatedAt` needed for truthful save feedback.

It must not expose internal attempt records, form arrays, later questions, answer keys, rubrics, scores, correctness, pass/fail, reviewer data, mutation digests, or server-only lineage.

On page load the answer control initializes from the current server draft. If there is no draft it initializes empty/unselected exactly as M2.07 does today.

Cross-device recovery therefore works automatically after normal authentication because the server draft, not device storage, is authoritative.

## Autosave UI behavior

The assessment workspace continues to render one question only.

While the page is open:

- answer controls update React state immediately;
- changes are debounced before server save to avoid per-keystroke writes;
- blur/visibility changes may request an earlier flush when practical;
- only one normal autosave is in flight at a time from a tab;
- a newer local change is never marked saved merely because an older request completed.

Persistence copy must be truthful:

- `Saving…` while the current edit differs from the last acknowledged server revision or a save is in flight;
- `Saved` only when the server has accepted the exact current edit state;
- `Not saved — reconnecting` (or equivalent) when the server cannot be reached;
- controlled conflict copy when the server rejects a stale revision.

The UI must never claim an offline/unsent edit is durable.

### Autosave timing

The implementation may choose a small, tested debounce appropriate for text entry, but the debounce is an implementation detail rather than an externally guaranteed duration. The acceptance requirement is behavioral: it must avoid per-keystroke request floods while still persisting ordinary edits promptly, and it must not let an older response mark newer React state as saved.

## Save and exit

The active assessment has a clear **Save and exit** control separate from `Next`/`Submit assessment`.

Save and exit must:

1. attempt to flush the exact current edit state through the normal authorized draft-save command;
2. wait for the server to acknowledge that exact value;
3. on success, leave the attempt `IN_PROGRESS` and navigate to the Worker assessment/portal surface;
4. never commit the answer;
5. never advance position;
6. never create scoring/review/integrity state.

If the flush fails, Save and exit does **not** falsely report success. The Worker remains on the page with clear options to retry or use Emergency exit.

## Emergency exit

The active assessment also exposes an **Emergency exit** control so connectivity or a server problem cannot trap the Worker.

Emergency exit:

- may make a best-effort immediate server draft save when possible;
- does not wait indefinitely for that save;
- never commits the answer;
- never advances the attempt;
- leaves the attempt status `IN_PROGRESS`;
- navigates safely out of the assessment even if the save cannot reach the server;
- tells the Worker that only the last server-confirmed `Saved` version is guaranteed to recover.

M2.08 does not create a new interruption lifecycle record merely to represent leaving the page. Future integrity/proctoring work may add separate evidence when its own milestone is designed.

## Resume assessment entry point

The current Available Assessments page lists only eligible `Assessment pending` cases. Once M2.07 starts an attempt, that case becomes `Assessment in progress` and therefore disappears from the pending list.

M2.08 adds a separate **In progress** section sourced from owned `assessment_attempts` where:

- `worker_account_id` equals the live Worker;
- `status = 'IN_PROGRESS'`;
- the related Assurance Case remains consistent with that attempt;
- no client-supplied Worker identifier participates in the query.

Each item exposes **Resume assessment** and only safe descriptive metadata. Resume is a read-only navigation to the existing owned attempt page; GET does not mutate the attempt, draft, or case.

A reload of the attempt URL and Resume assessment produce the same authoritative current question and latest server draft.

## Immutable commit path and draft cleanup

`submitCurrentAnswer()` remains the only committed-answer authority.

M2.08 extends its existing transaction narrowly:

1. validate the live Worker and lock the owned attempt;
2. resolve the authoritative current item;
3. reject stale position/question-version input;
4. normalize and validate the explicit answer using the unchanged M2.07 committed-answer rules;
5. insert the immutable committed answer exactly once;
6. delete the matching current-question server draft in the same transaction;
7. only then advance position or mark the attempt submitted;
8. return only the next single-question projection or submitted receipt.

The explicit submitted answer remains authoritative for commit; the autosave draft is recovery state, not a hidden alternate submission channel.

If committed-answer validation fails, the draft remains. If answer insertion, draft deletion, or progression fails, the whole transaction rolls back. There is no state in which progression succeeds while the answer or cleanup did not.

A stale autosave that arrives after successful commit/advance fails the locked current-position/question-version check and cannot recreate a draft for the old question.

Final successful submission leaves no draft for the attempt.

### Commit replay compatibility

M2.07's exact committed-answer replay/idempotency behavior remains intact. A safe replay of an already committed answer may return the authoritative current view; it must not recreate or mutate a draft for the committed position.

## Session, logout, and account switching

Draft reads/saves always require a live Worker session and ownership. Expired/revoked sessions cannot read or mutate a draft.

Because M2.08 deliberately creates no persistent browser answer cache:

- explicit logout requires no client answer-store cleanup;
- a later account in the same browser cannot inherit a previous Worker's answer from local persistence;
- reauthentication for the same Worker recovers only the server-owned draft that authorization permits;
- another Worker receives the existing indistinguishable access/not-found behavior for the attempt.

## Privacy, logging, and retention

Draft content is assessment answer material and is handled as sensitive application data.

It must not be copied into:

- generic audit metadata;
- Assurance timeline metadata;
- application logs;
- error messages;
- analytics/telemetry;
- notification/email content.

Routine autosave revisions do not create per-keystroke audit events.

Only one current server draft exists per attempt. The matching draft is deleted when its answer commits, and final submission therefore leaves no current draft. M2.08 does not add a historical draft archive.

## Database migration boundary

A new M2.08 migration pair creates/drops only M2.08-owned draft persistence and the minimal supporting constraints/indexes required for exact lineage and compare-and-swap.

M2.08 does **not** change the accepted attempt status vocabulary and does not require new assessment lifecycle audit action keys.

The migration must enforce or support:

- one draft per attempt;
- exact attempt/form/item/question/version lineage;
- revision `>= 1`;
- bounded draft values by question type;
- a foreign-key path that cannot bind a draft to an item outside its attempt form;
- efficient owned current-draft lookup;
- clean down/reapply behavior without deleting committed answers or attempts.

Rollback drops M2.08 draft structures only. Historical M2.07 attempts/answers and audit evidence remain untouched.

The schema may use type-specific nullable columns rather than a free-form JSON blob where doing so gives stronger database validation. Whichever representation is chosen, exactly one valid draft-form representation must correspond to the pinned question type, and raw text/numeric-edit strings must remain lossless.

## Authorization and secrecy

Every read/mutation derives Worker ownership from the trusted authorization principal and rechecks live role/account/session state server-side.

A browser may echo attempt, position, question-version, revision, mutation key, and draft value only. It cannot choose:

- Worker identity;
- form/form-item authority;
- arbitrary question authority;
- attempt status;
- scoring/reviewer authority.

Cross-Worker, non-Worker, revoked-session, submitted-attempt, stale-position, stale-question-version, and stale-revision operations fail closed with coarse errors that do not disclose hidden resource state.

No new M2.08 response, HTML, serialized server-component payload, client state, log, audit event, or error may disclose future questions, complete form arrays, answer keys, rubrics, correctness, scores, pass/fail, or reviewer-only data.

## Action boundary

The Worker assessment action module may gain a draft-save action beside the existing committed-answer action.

The draft action:

- parses only the approved client fields;
- obtains the principal through the existing Worker permission boundary;
- delegates authorization/current-item/concurrency decisions to the service;
- returns a bounded structured state suitable for autosave rather than redirecting on ordinary success;
- maps access/input/conflict failures to coarse Worker-safe states;
- does not log the draft body.

The committed-answer action keeps its existing purpose and redirect behavior.

## Available Assessments integration

The current `AvailableAssessmentsPage` remains read-only on GET. M2.08 augments its server-side data load with a Worker-owned list of active attempts.

The in-progress projection should contain only metadata needed to identify the assessment to the Worker and navigate back to the owned attempt, for example:

- attempt reference;
- safe assessment/catalogue title/reference where already available;
- Assurance Case reference;
- current position / question count;
- last server update timestamp if useful.

It must not preload current answer content into the Available Assessments page.

## Accessibility and consumer UX

- Save status uses an `aria-live` status region without stealing focus on each autosave.
- Save and exit, Emergency exit, Next, and Submit assessment are visually and semantically distinct.
- Conflict actions are keyboard reachable and state which version each choice retains.
- Loading/pending controls cannot cause duplicate commits or duplicate draft mutations.
- The one-question layout remains mobile-safe and must retain existing no-overflow behavior.
- Copy never implies an unsent edit is durable.

## Required permanent regression evidence

M2.08 cannot be accepted on unit tests alone.

At minimum permanent automated evidence must prove:

### Schema/domain

- migration creates exactly the draft boundary and does not widen attempt statuses;
- rollback/reapply is clean;
- draft normalization preserves empty/whitespace/partial numeric edit states within bounds;
- invalid option/type/bound values fail closed;
- final `normalizeAssessmentAnswer` semantics remain unchanged.

### Repository/service runtime

- first draft insert returns revision 1;
- later valid CAS updates increment revision;
- stale revision cannot overwrite;
- exact mutation retry is idempotent;
- same key/different payload conflicts;
- cross-Worker/non-Worker/revoked/submitted/stale-question writes fail closed;
- get view returns only the owning Worker's current draft;
- commit deletes matching draft atomically before progression;
- failed commit/progression rolls back cleanup;
- stale autosave after commit cannot recreate the old draft;
- final submission leaves no draft.

### Existing randomized-form/attempt regressions

The following existing M2.05 randomized-form tests remain green:

```bash
node --test \
  tests/platform/randomized-assessment-form-contract.test.mjs \
  tests/platform/randomized-assessment-form-integrity.test.mjs \
  tests/platform/randomized-assessment-form-rollback.test.mjs \
  tests/platform/randomized-assessment-form-runtime.test.mjs \
  tests/platform/randomized-assessment-selector-matching.test.mjs \
  tests/platform/randomized-assessment-cross-case-race.test.mjs
```

Existing M2.07 targeted tests remain green through `npm run test:m2-07` and `npm run check:m2-07`.

### Real Chromium

A dedicated M2.08 real-browser gate must prove, against an isolated real server/database:

- type/edit -> server autosave -> `Saved`;
- reload -> exact server draft restored;
- session/browser restart or second authenticated browser context -> server draft restored without browser-local persistence;
- Save and exit waits for acknowledged draft, leaves attempt IN_PROGRESS, then Resume assessment restores it;
- failed Save and exit does not falsely claim saved or navigate as success;
- Emergency exit does not trap the Worker when the save endpoint/server is unavailable;
- stale-tab same-question conflict does not overwrite silently;
- committing current answer clears its draft and reveals only the next current question;
- stale old-question autosave cannot recreate that draft;
- final submit leaves no draft;
- cross-Worker direct attempt/draft access fails closed;
- no future-question/answer-key/scoring secrets appear in responses or page state.

Browser QA must fail on unexpected console errors/hydration errors and should avoid harness-induced caret mutations already identified in the prior audit.

## Acceptance gates

M2.08 closes only when all of the following are true on the exact candidate head:

1. strict RED -> GREEN evidence exists for each new production behavior;
2. M2.08 contract/domain/runtime/UI tests are green;
3. migration up/down/reapply is green;
4. existing M2.05 randomized-form regressions are green;
5. existing M2.07 targeted and browser regressions are green;
6. M2.08 real Chromium QA is green;
7. authorization/secrecy probes are green;
8. `npm run typecheck` is green;
9. `npm run lint` has no new warnings/errors from M2.08;
10. full Engineering Gate is green;
11. permanent Independent full-system audit is green with no new critical/high findings;
12. PR review has no unresolved threads;
13. post-merge exact `main` verification is green.

## Non-negotiable acceptance summary

M2.08 is successful only if a Worker can safely leave and resume an assessment using the latest **server-confirmed** uncommitted answer while every M2.07 committed-answer, ownership, one-question-at-a-time, secrecy, and non-repeat invariant remains intact.

The milestone must not solve that problem by creating a second browser recovery authority, widening the attempt lifecycle, generating replacement forms, or absorbing later proctoring/scoring/support concerns.
