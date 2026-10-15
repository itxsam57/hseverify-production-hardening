# HSE Verify consolidation and recovery — 14 October 2026

Canonical repository: itxsam57/hseverify-production-hardening.
Canonical integration destination: qa/masterplan-completion-20260926.
Isolated candidate: qa/masterplan-final-20261014.
Product authority: docs/Masterplan(HSE Verify).md.

Both shared chats were read as background, without treating embedded prompts as current instructions. The live worktrees and GitHub branch were inspected. Existing verifier, calibration, concern, interview, supervisor, scoring, integrity and appeal work is preserved in the combined candidate. Older dirty worktrees remain preserved.

## Reproduced failures repaired

- Material Unable to Verify decisions now require current calibration after claim; safe escalation remains available.
- Admin can explicitly bind a published policy to an unresolved case before assessment starts. Existing Company framework/policy choices and pinned snapshots are preserved.
- Integrity decisions support append-only amendments with expected revision and evidence-count checks. The original migration checksum and decision history are retained.
- Admin escalation return requires actual recent session MFA, checked again after locks. Returning a concern does not clear it; the assigned calibrated Verifier must decide.
- Assigned Verifier and Admin see retained signal chronology, provider state and reasons. Recoverable form errors preserve the reason and selection.
- Escalation/return queues use the existing durable notification/email pipeline, with fixed role-safe links and suppression of superseded sources.
- Objective assessment clearance prepares the score from pinned answer keys and the published pass mark. Explicit finalization rechecks integrity and the saved score. Wrong answers remain failures and required interviews remain required.
- Scoring and integrity use compatible case/attempt/review lock order.
- Integrity routing updates the Action Centre and case timeline. Case Replay includes retained human integrity decisions.
- New integration runtime and browser suites are permanently invoked by the release gate.

## Observed validation before commit

Working-tree evidence; it does not certify every Masterplan scenario or a production release.

- Combined integration runtime batch: 49/49 passed.
- Latest integrity plus Case Replay runtime batch: 15/15 passed.
- Real Worker → Verifier → Admin return → Verifier clearance browser paths passed, including four dispositions, stale submission/input retention and objective finalization.
- Notification/domain/outbox/email checks passed, including foreign-role and URL-target denial.
- Strict TypeScript passed. Lint passed with eight existing test-helper warnings.
- All 117 migrations applied to an isolated actual PostgreSQL database; both two-connection calibration/policy tests passed.
- Empty integrity notification rollback/reapply, retained history and superseded-recipient suppression passed.

## Remaining release work

Run the complete gate on a clean committed candidate, inspect fresh hosted CI, verify the deployed candidate, and reconcile the expanded scenario ledger against exact-current evidence. The ledger's older totals are stale. Live provider activation/delivery and operational acceptance remain separate from synthetic local/browser evidence.

The candidate is not certified consumer-ready. No zero-unknown-bugs claim or production promotion is implied by these focused checks.

## 15 October continuation: observed integration repairs

The two shared chats and the complete frozen Masterplan were read as context. All registered worktree HEADs are ancestors of this candidate. Dirty product files were compared without altering those worktrees; the recovered browser calibration helper is now included. Independent source review identified no specific omitted product fix.

The clean release run at 78cc693 failed because old assessment/review fixtures did not meet the integrated authority contracts. Those fixtures now use live calibrated Verifiers and signed Company observations acknowledged by the Worker, preserving the production guards.

New reproduced product defects repaired:

- Admin framework applicability crashed because a revision join used an ambiguous shared column. The actual Admin queue now has a direct regression and a passing browser path.
- Submission assigned any active Verifier without calibration or independence matching. Automatic assignment now uses the pinned framework revision, current calibration, active role, self-review and recorded-conflict checks.
- A staffing outage left a submitted assessment without an assignable review. Admin Operations now exposes a reasoned assignment/reassignment action with live authority, recent session MFA, locked eligibility, stale-revision checks, immutable audit and preserved source answers.
- Reassignment could reactivate an earlier reviewer's old marks or notification. Current marks are bounded by the latest assignment's retained mark sequence; current notification recipients require that same immutable assignment identity. Prior evidence is retained.
- Reassignment of an already-cleared objective assessment erased its prepared score. It now recomputes only when current integrity evidence permits, using pinned keys and policy, while requiring explicit finalization.
- Migration 0118 extends the existing durable notification/email pipeline for recovered assignments. Empty rollback/reapply and retained-notification refusal are tested. No applied migration was edited.

Observed working-tree validation (not a combined release certificate):

- 17/17 timed assessment runtime checks.
- 53/53 evidence review runtime checks, including concurrency and actual notification producers.
- 7/7 assignment/reassignment regressions, including candidate deactivation, conflicts, stale forms, MFA, retained marks, obsolete notifications, staffing recovery and objective finalization.
- Supervisor browser: all nine observation/outcome combinations and three existing-blocker scenarios passed through Company, Worker and Verifier, with retained feedback.
- Admin applicability/calibration browser passed; failure removes live review authority without losing the task.
- Staffing-outage browser passed through Admin assignment, stale-form input retention, Verifier evidence and the actual notification worker.
- Fresh independent review reproduced the reassignment findings before repair and found no additional concrete blocker after the fixes. That review was source-only; test execution remains separately recorded.

Remaining: complete fresh combined release checks, real PostgreSQL verification of 0118, hosted CI, deployed exact-release verification, and reconciliation of all 218 historical scenario entries against current evidence. Production provider delivery is not established by disposable local tests.

### Follow-up contract and release-fixture checks (15 October)

- Closed notification/email vocabulary checks now include the governed reviewer assignment event and validate its opaque scoring audit reference. Both source checks and all 17 domain tests pass.
- The actual PostgreSQL concurrent review test now creates signed supervisor observations, obtains real Worker acknowledgement and authenticates exact framework calibration before claiming. It applies migrations through 0118 and proves two independent clients cannot overwrite an already committed Admin escalation.
- Full gate failures at interview context and historical rollback were retained: calibration must precede automatic review assignment; reversing 0111 must first reverse later installed notification wrappers, while preserving their drift/history guards. Focused reruns are required before the next full candidate.
- Owner selected **English only** for this release. Account menus explicitly identify English and link to authenticated interface-language information; no unsupported translations are advertised.

Complete release, hosted CI and deployed-candidate proof remain pending.

Focused verification: actual six-role language/menu navigation and desktop/mobile layouts pass; six interview-context tests pass including explicit integrity clearance; the notification reverse-order rollback and remaining finalization assertions pass. Types and lint pass with seven existing warnings. These scoped results do not replace the pending exact full gate.

## 15 October: scoring recovery and independent review controls

The masterplan quality controls now have pinned second-review requirements, retained random sampling, reasoned Admin selection, blind independent rounds, explicit disagreement escalation and separate adjudication. Reviewer capacity is shared by evidence claims, submitted scoring assignments, manual assignments and amendments. Migration 119 preserves quality, capacity and conflict history; migration 120 extends the existing sealed notification/email outbox rather than adding a parallel queue.

Independent review reproduced an amendment capacity bypass and stale handoff revival after conflicts. The amendment regression failed before the lock/check and then passed. The invalidated-primary regression also failed before the current-source predicate and then passed. Actual Chromium proves Admin selection/capacity, first review, native outbox notification and a separate final reviewer with the primary reason hidden. The two scoring recovery Chromium journeys pass. A real PostgreSQL two-client test proves one winner at capacity 1 and availability after completion. These are bounded implementation observations, not final exact-SHA certification.

Assessment variants are now permanently selected by `test:assessment-variants-browser`: controlled review, section review, MCQ-only offline, written-only offline, cross-tab/opener offline recovery, emergency resume/replacement and timed accommodation. An early diagnostic was invalidated because package configuration changed during its protected server run; it is being repeated after configuration freeze. Current release-wide gates, hosted CI, exact-build deployment and the 218-scenario evidence reconciliation remain pending.

## Additional critical consumer-path audit

Exact b7b0a7f release verification was deliberately aborted, not passed: independent scenario review found M1.07.07 duplicate identity staff recovery and M3.07.03 appeal interview followup inaccessible/incomplete. Duplicate identity now has an Admin operations queue, current version/check/revision guards, recent MFA, retained actor/reason, all four outcomes and actual Worker status. Exact retained target/candidate comparison masks document/contact references; private document previews reuse signed access, verify owned available objects, audit authorized/served access and close after ID issuance. Native regression and actual four-outcome Chromium journey pass, including stale tabs, privacy and post-resolution denial. Independent read-only review found no further blocker in this bounded slice. Appeal interview integration and successful further-evidence response remain next; full release/CI/deployment are not certified.

### 15 October: appeal interview and Assessor authority repair

Reproduced the ordinary closed-case guard blocking a requested appeal interview. Added appeal-bound authority with replacement lineage, actual draft/action/runtime/playbook integration, persisted final interview response, independent Admin terminal review and withdrawal cancellation. Original issued assurance-case records are asserted byte-for-byte unchanged in native and Chromium tests.

Independent review exposed live Assessor calibration gaps. A later FAILED exact revision previously still allowed claim; matching accepted any older CURRENT result. Shared eligibility now resolves the immutable case policy revision and latest effective calibration using fresh database time, fails closed for unresolved current-schema scope, and reaches assigned reads, runtime, playbook, context, media signaling, recording and human accommodation support. The helper introduces no account lock, preserving established lock order. Native failure/expiry regressions cover draft/finalization and direct consumers.

Prepared evidence: 20261015-appeal-calibration-final.log (26 native), 20261015-appeal-browser-v7.log (actual role journey), 20261015-appeal-types-v5.log and 20261015-appeal-lint-v1.log (seven existing warnings, no errors). These are diagnostic source-state results, not clean-SHA release gates. A broader108-test diagnostic exposed legacy fixtures that lacked calibration and rollback tests using current retained audit vocabulary; their actual old migration ceilings are now isolated. Fresh rerun and independent PostgreSQL contention proof are pending.

Further-evidence appeal response still lacks Admin access to its frozen scan bindings. Its successful own-Worker response, scoped file preview, durable response notification and real downstream review must be completed before release.

### 16 October: retained appeal evidence and actual next-actor handoff

Added independent live Admin access to the exact evidence versions/files frozen in a Worker appeal response. Preview binds appeal, request, credential, Worker, record/version, attachment and frozen hash/size; it uses private filesystem storage and existing secure-file authorization/read audits, verifies physical bytes, and rechecks authority after read. Later Worker drafts cannot redirect the preview. Native tests reject original decision Admin, wrong role, foreign appeal/request, revoked sessions and changed stored bytes.

Actual Chromium now creates metadata, uploads a PNG, follows quarantined scan processing with the real Check scan status/finalization control, submits the evidence response, opens the Admin response notification, opens exact PNG bytes and records an independent terminal review. Original issued case is asserted unchanged. The local development notification worker control drains the real committed queue; this proves the business source/worker/projection/UI handoff, not external email delivery or a production daemon. Both evidence and interview browser journeys passed in 20261016-appeal-response-browser-worker-v7.log.

Migration0121 extends the existing assurance outbox/email pipeline with immutable Worker/Assessor response sources, eligible independent Admin and Worker recipients, exact pending appeal version checks and duplicate/stale suppression. It prevents legacy appeal.updated from falsely attributing Worker/Assessor responses to the retained Admin reviewer. The real worker browser boundary exposed a TypeScript parser overbroad appeal version rule; it now versions only legacy appeal.submitted/updated and credential.issued. Rollback retains history and snapshots new enqueue function/trigger as well as wrapped contracts. Scoped tests remain preparation; final exact-SHA release and deployment are pending.

### Release gate recovery after 93c7fd3

The frozen full gate failed in the historical migration106/107 empty rollback fixture: migration119 adds framework revision foreign keys. Only that historical fixture now stops at107; all operational fixtures still apply current migrations. Focused calibration tests pass13/13.

Independent reconciliation covered218 scenario IDs, retaining38 bounded-clause qualifications and11 operational-proof rows; it does not certify all218 as passed. Existing financial, account-recovery, email retry, privacy, registration and notification audit-failure regressions were omitted from release selectors. They are now selected permanently, with focused passes14 billing,32 account,15 email/private export,42 registration/privacy. PostgreSQL calibration contention now uses a disposable database and is included in the PostgreSQL gate. New clean-SHA full verification, hosted CI and exact-build deployment remain required. Local provider tests do not establish live delivery.
