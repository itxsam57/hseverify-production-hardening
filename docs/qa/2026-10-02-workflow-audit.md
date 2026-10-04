# HSE Verify workflow audit — 2026-10-02

Canonical repository: `itxsam57/hseverify-production-hardening`, branch `qa/masterplan-completion-20260926`. Base: `388fb489c7bacf7af6c8b72cdafe8e95e97d0425`.

## Expanded verification — 2026-10-03

Continued from canonical commit `89baa04b8cd62090a5e8406d9e2569462abe78c8` in an isolated worktree. These are scoped working-tree results, not a whole-product or production release certificate. The 218-scenario matrix in `2026-10-02-evidence.json` records passed, partial and unverified cases separately.

Fresh browser journeys passed:

- Company registration changes requested → new draft/documents → Admin review → activation.
- Initial identity changes requested → immutable revision → resubmission → Verifier approval; initial rejection and reason shown to Worker.
- All four evidence types through rejection, changes requested, correction and approval; verified identity correction through all three outcomes without changing permanent Worker ID.
- Company case changes requested → Worker certificate revision → Company requeue → Verifier approval → Assessment pending.
- Emergency exit → independent recovery review → same-attempt resume or unseen replacement → scoring/interview/credential/appeal.
- Replacement preserves original form, exposed questions, committed MCQ and uncommitted written draft.
- MCQ-only and written-only assessments through their applicable scoring, interview, Admin decision, credential issuance and appeal.
- Controlled Review and Section Review through versioned edits, flagging, locking, credential issuance and appeal.
- Written offline edit → encrypted persistence → delayed reload restoration → reconnect → credential/appeal. Early final submission is blocked until restoration finishes. Independent and opener-created tabs retain separate pending edits; an authoritative server conflict requires an explicit version choice.

Fixed during this continuation:

- Verified corrections were not queued and attempted duplicate permanent-ID issuance on approval.
- Initial more-info identity had no revision path; new migration preserves submitted parents and immutable lineage.
- Worker identity page omitted the responsible review outcome/reason.
- Offline answers existed only in memory and disappeared on reload; encrypted temporary browser storage now retains them with server revision checks.
- One tab could erase another tab’s pending offline answer; native tab ownership separates independently opened and copied/opener-created tab IDs while retaining reload recovery.
- Correction submission and review queueing were separate transactions. A real injected queue failure now rolls back submission, leaving a retryable draft; recovery through actual retry and Verifier approval passes.

Still being exercised: MCQ offline buffering, timing, complete replacement credentials, operative accommodations/privacy, remaining outcome and role combinations. Credential signing/expiry, full notification fan-out and live integrations remain open. Nothing here certifies every scenario.

## What passed

Two preserved, multi-role browser journeys: Worker registration/contact verification -> complete profile -> identity and qualification submissions -> Verifier approval -> assessment application -> worker sandbox payment **or** Company checkout/credit approval -> pinned MCQ/written assessment -> save/exit/resume -> human scoring -> matched/scheduled interview -> Assessor save/final recommendation -> Admin decision -> issued credential/PDF/public verification -> selected Passport sharing -> independent appeal review -> Living Record reassessment -> fresh application using fresh question capacity. Company funding also exercises insufficient-credit recovery before approval.

Other connected browser suites cover Company organization/invite/link/orders/review, company Team/policy/reports, Root staff/MFA isolation, notifications, privacy/accommodation/consent, advisory scoring/Case Replay, credential appeal, and built-in WebRTC media. Configuration authoring is checked separately via the Admin UI.

The visible device browser was also used to sign in as the disposable journey Worker and inspect the Passport: identity verified, profile 100%, qualification present, issued competency changed to reassessment required, retained history. These observations supplement automated Chromium; they do not prove every button manually.

## Fixed during this audit

- Interview draft save reset the required recommendation before final submission: remount from the saved draft.
- Issued credential QR URL could not resolve through the Worker-only verifier: add credential lookup behind existing opaque capabilities/rate limits.
- Recipient sharing page omitted selected skills/competencies/restrictions/conditions/expiry/recipient: render only the allowed projection.
- New Worker assessment page crashed before identity verification: show no eligible applications while retaining mutation eligibility checks.
- Company funding could overreserve credits or accept revoked links: fresh guarded tenant transaction and active-link/identity checks; controlled insufficient-credit feedback.
- Decision overrides left credentials/living records and the certification dashboard stale: synchronize lifecycle and derive current certification display; disclose conditional approval consistently in public page/API/PDF.
- Completed applications blocked reassessment forever: retain original records, release completed/reassessment applications, require fresh capacity, serialize Worker application changes.
- Test loaders failed to rewrite aliases/compile new dependencies; integrity test lacked safe runtime configuration; certification browser test depended on external fixture state. Repair harnesses and execute real disposable drills.
- Preserve older VPS Case Replay fields missing from the newer query (Worker/title/creation context).
- Framework/policy publication had no visible acknowledgement: add explicit saved/published confirmation.

## Read the status correctly

“Journey passed” applies to the named exercised journey and disposable data. It does **not** certify every variant or production integration. Route-render tests are supplementary only. The table records every Masterplan brick and its remaining limits.

| Brick | Planned feature | Result | Exercised evidence | Missing / not verified |
|---|---|---|---|---|
| M1.01 | Repository, environments and CI/CD | Partial | Types, lint, deterministic build in test configuration; migration runtime suites | GitHub CI and production rollback need release evidence |
| M1.02 | Design system and global UX | Browser checked | Desktop/mobile all-role layout, consumer validation, retry controls | Visual checks cover routes, not every component/state |
| M1.03 | Authentication and portal isolation | Journey passed | Worker registration/contact verification; company registration; Root staff provisioning/MFA and isolated sessions | Live OTP delivery unverified |
| M1.04 | Authorization and tenant isolation | Runtime/browser passed | Tenant scope/concurrency and role isolation; protected actions | No independent penetration test |
| M1.05 | Audit and notification foundations | Partial | All-role bell, deep link/read persistence; queue/email runtime | New assessment application/funding events do not yet produce all planned notifications; live delivery unverified |
| M1.06 | Secure storage and upload pipeline | Partial | Uploads, quarantine/scan/access runtime; actual identity/evidence UI submissions | Documents/camera use synthetic fixtures; live scanner unverified |
| M1.07 | Worker onboarding and Identity Engine | Journey passed | Profile 100%, identity evidence, Verifier approval, permanent Worker ID; independent approve/reject/corrections | Production liveness unverified |
| M1.08 | Company registration and verification | Journey passed | Company register/correction/review/activation browser suite | Live delivery unverified |
| M1.09 | Sites, departments and team | Journey passed | Company site/department create/edit/archive/restore and Team workflows | Not every permission/archival variant exercised through UI |
| M1.10 | Worker invitations and company codes | Journey passed | Company invite -> Worker accepts -> active link -> scoped Order | Bulk CSV and every code-expiry/default combination not fully journey-tested |
| M1.11 | Employment, experience, skill and leaving-letter records | Partial | Worker qualification/evidence submit -> review -> passport; evidence runtime | Every employment/leaving-letter/supervisor variant not fully journey-tested |
| M1.12 | Public verification foundation | Journey/runtime passed | Credential QR route -> opaque safe projection; 29 public tests; neutral misses/rate limits/concern validation | Actual concern upload -> staff resolution journey not fully exercised |
| M2.01 | Assurance Order and Case Engine | Journey passed | Draft -> validate -> submit -> per-Worker case -> scoped review; funded Worker case -> final completed order | Not every mixed-funding/multi-worker variant through UI |
| M2.02 | Evidence verification queues | Journey passed | Independent and company-scoped review -> Worker outcome -> next assessment/interview | Every evidence kind and escalation combination not through UI |
| M2.03 | Frameworks and Effective Policy | Partial | Effective policy runtime and company override workflow; Admin authoring suite | Risk/expiry rule propagation not comprehensively journey-proven |
| M2.04 | Question Bank | Partial | Question runtime; Admin create/revise/deactivate/reactivate authoring suite | Bulk import, retirement/capacity and approval variants need full UI coverage |
| M2.05 | Randomized assessment form generation | Runtime/journey passed | Unseen generation/exposure/runtime; real Worker starts pinned MCQ/written form | Every selector distribution/replacement variant not through full journey |
| M2.06 | Assessment catalogue and eligibility | Journey passed | Verified qualification -> apply -> self-payment OR Company credit approval -> available assessment; insufficient credit recovery | Payment remains sandbox; reapplication uses fresh capacity |
| M2.07 | Candidate assessment window | Journey passed | Prechecks -> MCQ -> written answer -> submit via actual browser controls | Fullscreen/camera use browser permissions/fake media; all progression modes not journey-tested |
| M2.08 | Answer persistence and interruption recovery | Journey/runtime passed | Written save/exit/resume preserves answer; 56 draft/recovery tests and 17 attempt tests | Offline device replacement through a complete second credential not fully exercised |
| M2.09 | Integrity Engine | Partial | Integrity runtime and limited-monitoring browser check; case evidence retained | Not a human multi-camera/screen enforcement certification |
| M2.10 | Written scoring and Review Engine | Journey passed | Worker written submission -> human rubric -> interview; advisory AI -> human decision -> Case Replay | Live AI provider and all appeal/calibration combinations unverified |
| M2.11 | Interview scheduling and assignment | Journey passed | Scoring -> matched Assessor -> candidate selects slot -> readiness/waiting -> admission | Live reminders/edge timezone and availability variants unverified |
| M2.12 | Interview console and playbook | Journey passed | Assessor starts/pauses/questions/saves/ends/finalizes; Worker/Assessor WebRTC media suite | Media simulated locally; WAN/TURN/recording lifecycle not certified |
| M2.13 | Decision Engine | Journey/runtime passed | Admin decision -> Case/Order -> credential/living; override status synchronization | All state-pair UI transitions not exercised; revoked credential cannot silently reactivate |
| M3.01 | Credential and QR issuance | Partial | Issued credential -> passport -> public route/API/PDF; privacy-safe current status | Issuance signature is an unkeyed SHA-256 digest, not an authenticated signature; issuance expiry remains null |
| M3.02 | Digital Passport and Living Record | Journey passed | Competency -> sharing -> appeal -> versioned reassessment state, visibly checked on device | Automatic expiry and full renewal lifecycle unverified |
| M3.03 | Scoped share links | Journey passed | Selected fields -> secure recipient page; revocation/access-log domain/runtime | Every expiry/permission combination not through UI |
| M3.04 | Company Action Centre and analytics | Journey passed | Company order/action-centre/dashboard and reports workflow | Every analytics filter/readiness scenario not independently checked |
| M3.05 | Billing and subscriptions | Sandbox journey passed | Checkout -> captured credit -> Worker funding approval; billing runtime/refunds/reconciliation | No live payment/subscription webhook/refund journey |
| M3.06 | Reports and delivery | Partial | Company report/export workflow and authorized runtime | Scheduled external delivery and every PDF/CSV layout not visually verified |
| M3.07 | Appeals, renewal, suspension and revocation | Partial | Worker appeal -> independent Admin review -> accepted reassessment -> retained Living Record; fresh application after appeal | Second complete reassessment-to-replacement-credential/renewal journey not yet proven |
| M3.08 | Admin operational completeness | Partial | Root provisioning, Admin decisions/privacy/replay/health/configuration workflows | Every Admin CRUD/governance operation not journey-tested |
| M3.09 | Privacy and accessibility operations | Journey passed | Worker privacy/accommodation -> Admin review -> Worker; consent versions retained | Real screen-reader use and retention-provider jobs unverified |
| M3.10 | Production integrations | Blocked live | Provider gateway/health runtime; built-in WebRTC browser handshake | Real email/SMS/payment/liveness/malware credentials and production execution evidence missing |
| M3.11 | Load, security and recovery certification | Local drills passed | Executed concurrency/tenant/physical PGlite restore/incident drills -> protected Admin readiness UI | This is disposable local test evidence, not production load/penetration/backup certification |
| M3.12 | Production launch and operational handover | Partial | Production handover browser/runtime on disposable fixture | Production deployment/monitoring/alerts/support acceptance not performed |

## Consolidation and safety

The current VPS audit worktree started detached at the canonical remote SHA with inherited application/billing/interview/decision edits. Those edits are retained in this change. The older local QA worktree was compared without resetting or overwriting it: most differences were formatting or superseded fixes/tests; its useful Case Replay context was restored. Its dirty worktree remains on `qa/preserved-local-completion-20261002`. No older/main codebase was substituted.

Only source, tests, migrations and review documentation are consolidated. Runtime databases, real credentials, generated build output and test logs are not source deliverables. Local test logs remain available on the device under `.autopilot/artifacts/`. The evidence index records final repaired checks; earlier failed attempts are retained there rather than hidden.

Migration 0076 preserves original applications/cases and adds COMPLETED. Its downgrade fails closed if multiple historical applications would violate the old unique-open rule; do not force that downgrade or delete history.

## Production acceptance still open

Live provider credentials/execution, authenticated credential signing, configured issuance expiry, complete application/funding notification fan-out, a second complete reassessment/replacement-credential journey, and production rollout/load/penetration/WAN-media/backup acceptance remain open. This QA consolidation is not a production-ready declaration.

### Continued gate repair — 2026-10-03

The full engineering gate at a819df3 stopped at M1.12: a lexical authority check misclassified SELECT of credential_issuances/issued_at as issuance. The guard now distinguishes reads from workflow commands and credential-table writes. Six adversarial source-guard cases are included in the public-verification runner. Focused public-verification suite passed 35/35; the full gate must be rerun at the new checkpoint. No whole-product readiness claim follows from this scoped result.

The next full gate at 6c333fe passed the M2 source/runtime stages but stopped in secure-access tests (five incorrect TypeErrors). Root cause: the core test rewrote shared emitted modules while other test processes imported them. The secure-access runner now serializes its three files; all 20 cases pass, including oversized/malformed/invalid-UTF8 body rejection. Production request validation remains unchanged. Schema-qualified/quoted credential-write guard variants also passed nine focused cases. Broader application checks remain in progress.

### Candidate boundary and MCQ recovery continuation — 2026-10-03

A real registration/profile/Verifier-to-assessment journey reproduced forbidden Question Bank version IDs in candidate HTML. The current-question allowlist now excludes bank IDs, difficulty and tags; current and review screens omit difficulty. Browser mutation forms send attempt/position; the existing authenticated owner/device transaction resolves the pinned question. Optional internal expected-version checks remain for server callers. Draft CAS, current-position checks, immutable question/answer history and same-answer replay remain protected.

The full Controlled Review journey passed through question revisions/flags, human scoring, interview, Admin decision, credential, scoped sharing and independent appeal. M2.07 runtime suite passed 17/17; M2.08 passed 56/56, including requests without browser bank IDs. Typecheck and scoped lint passed. The MCQ-only offline journey passed selection, offline buffering, reload, acknowledged reconnect, final submission, interview, credential/share/appeal. Written offline recovery must be revalidated after the buffer key now uses attempt/position.

The broader application check also exposed an outdated identity transition expectation; it now allows the guarded more-info revision path while denying direct Worker self-transition. Focused identity suite passed 9/9. The broader gate is still incomplete; these results do not establish consumer readiness.

### Reconnected verification — 2026-10-04

Recovered checkpoint `196bbe9` after workstation restart. The prior written-opener and full-gate logs were interrupted and are not passes. Fresh written-opener recovery correctly retained the encrypted answer and reported a server-version conflict after the duplicated tab saved. The browser test omitted the explicit conflict choice in its opener variant; both concurrent-tab variants now require the same choice. The repaired registration-to-credential/share/appeal journey passed with final database assertions. Product conflict protection is unchanged.

The fresh full engineering run passed its M2 source/runtime stages, then environment validation rejected absent test session-secret and auth-pepper configuration. The validator remains intact. A new exact-checkpoint run uses isolated disposable test configuration. The privacy workflow still requires complete staff intake/outcome verification; its existing test only proves request creation, accommodation approval and consent history.

### 2026-10-04 resumed verification and privacy intake repair

The full configured engineering gate passed after resuming the interrupted run. It started at `852e961` and ended after `024a42b`, which only changed first-branch compliance and its regression tests. This is execution evidence with mixed HEAD provenance, not exact-SHA project certification. Opener recovery, SECTION_REVIEW, MCQ offline recovery, independent evidence revisions, Company workforce handoffs, and accommodation approval passed in browser runs at `852e961`.

First-branch compliance now uses the owner's canonical QA branch instead of the older repository default. The actual guard accepts introduced valid commits and rejects a newly introduced commit without cycle attribution. Both GitHub compliance runs and both targeted TDD workflows passed at `024a42b`.

A fresh browser reproduction showed that a Worker privacy request had no Admin intake queue. The additive repair exposes existing requests to authorized Admin operations, records processing and reasoned rejection atomically with immutable reviewer history, rejects stale decisions, and returns the review reason to the Worker. The permanent browser journey now verifies OPEN -> PROCESSING -> REJECTED and both Worker-visible reasons; real database tests verify failed-review rollback and immutable history.

This repair does not certify completion of access/export/deletion/restriction operations or operative consent withdrawal. It deliberately exposes no completion control for an operation that has not been fulfilled. Those downstream privacy effects remain unverified work in the expanded Masterplan.

### Independent review: delayed offline restoration

At `7ae2908`, the full configured engineering gate passed with identical start/end SHA. Independent read-only review then blocked merge on an additional race: the answer field remained editable while IndexedDB recovery was pending. A separate browser reproduction delayed the read and typed before restoration; the retained offline answer was replaced without a conflict choice (`20261004-slow-recovery-lost-answer-red.txt`).

Answer controls now use native disabled state until recovery completes, across text, numeric and radio question types. The status announces restoration while controls are locked. The permanent delayed-read browser test asserts that editing is disabled and that recovered text survives final submission into the permanent assessment answer. The original timing reproduction and the opener-conflict journey both pass through credential, public/PDF verification, sharing and appeal, with strict types and focused lint passing. These are scoped repair checks; the whole expanded Masterplan remains incomplete.

### Scoped sharing consent withdrawal

After canonical merge `c04e3dd` (tree identical to tested `1ee9b04`), a new Worker -> anonymous recipient browser probe showed WITHDRAWN consent while the linked passport remained publicly accessible. The fix now revokes the exact owned share link in the same transaction that appends the withdrawal version. Missing/unowned links and invalid chronology fail before fulfilment; failed history append rolls back revocation. Repeated withdrawal retains the same two historical versions.

The permanent browser journey creates two real links, identifies the intended consent by its displayed share purpose, withdraws it, verifies denial for the anonymous recipient, and verifies that the other link stays accessible. Database assertions preserve GRANTED/WITHDRAWN history, confirm exact linked revocation and denied access logs, and keep unrelated access active. Runtime tests verify cross-owner/missing metadata denial, chronology, transaction rollback, and repeat safety. The earlier consent-history fixture was repaired to create its actual owned target instead of referencing a nonexistent link.

This verifies operative withdrawal for scoped share links. Company sharing, other consent categories, restriction/deletion/export fulfilment, actual adjusted assessment delivery, and full reassessment-to-replacement credentials remain separate expanded scenarios.

### Scoped withdrawal review follow-up
Independent review found that historical WITHDRAWN records left active links and that browser timestamps ahead of server time blocked withdrawal. Both cases failed focused database regressions. Creation now uses server time; withdrawal tolerates legacy future-dated links. Migration 0079 reconciles only latest withdrawn scoped consents with owned links, remains idempotent, and does not alter append-only history. Repeated withdrawal also reconciles access. A real browser journey sends a 2099 client creation timestamp and immediately withdraws one of two links; unrelated access remains active. Whole privacy fulfilment and Masterplan coverage remain incomplete.

### Reassessment continuation and enforced journeys
The expanded browser probe completes the accepted-appeal reassessment through sandbox funding, unseen assessment, human scoring, candidate interview, approved decision, distinct credential, anonymous public status and PDF. The permanent continuation additionally asserts question separation, completed order, new valid Living Record and retained original valid/reassessment-required history. It is invoked by `npm run test:masterplan-reassessment-browser`; this and the operative privacy journey now join the critical browser gate. This is evidence for a distinct credential after reassessment, not an assertion that renewal policy, replacement association or all lifecycle variants are complete.

### Accommodation decline and canonical CI continuity
The real browser decline branch passes after correcting an over-exact label selector in the probe. The Worker receives the reason; the declined request has no approved adjustment or case, and the existing approved overlay remains the only overlay. No product repair was needed.
The Masterplan workflow's PR filter incorrectly pointed to the older default QA branch. It now points to canonical QA and calls reusable exact-SHA private browser reassessment evidence. Durable factory state records requirements, capabilities, explicit limits and next action, preserving existing guarded Autopilot state. Actual adjusted delivery and whole Masterplan acceptance remain open.

Review correction: the first decline probe/permanent test had UI proof but the intended downstream decline assertion insertion did not apply. Review rejected0931aa3; revision adds explicit declined accommodation ID/status/reason/null case/null adjustment/zero overlay plus one approved overlay assertion. The earlier no-adjustment claim was premature pending this corrected run.
