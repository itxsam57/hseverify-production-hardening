# ZERO — Five-batch agency evidence reconciliation 036–040

**Frozen app SHA:** `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. 5 requested related batches; 19 distinct original scenario units; selected source cases **19/19 PASS**; **0/218 technically fully verified**, **OWNER TESTING READY: NO**. No production/consumer/staging mutation.

| Batch | Area | Original units | Selected PASS | TECH FULL |
|---|---|---:|---:|---:|
| [ZERO-036](AGENCY_ZERO_BATCH_036_REPORT.md) | Interview matching & scheduling | 5 | 5/5 | 0 |
| [ZERO-037](AGENCY_ZERO_BATCH_037_REPORT.md) | Worker join window/consent gates | 1 | 1/1 | 0 |
| [ZERO-038](AGENCY_ZERO_BATCH_038_REPORT.md) | Assessor console and recovery | 5 | 5/5 | 0 |
| [ZERO-039](AGENCY_ZERO_BATCH_039_REPORT.md) | Recommendation/media/recording | 3 | 3/3 | 0 |
| [ZERO-040](AGENCY_ZERO_BATCH_040_REPORT.md) | Final decision and status lifecycle | 5 | 5/5 | 0 |

## Three review disciplines

**ENGINEER — SELECTED PASS 19/19:** Isolated real Chromium/PGlite original source tests exercised Worker/Assessor/Admin scheduling and conflict forms; live case UI, WebRTC reconnect, versioned playbook, technical hold/replacement, scorecard completion, one recommendation, audio consent/media shutdown, real decision guards, credential history and recent MFA. Code spot-check found tenant/active principal and calibration checks and persisted decisions, but exhaustive UI and source maintainability signoff not done.

**CYBERSECURITY — TARGETED PASS ONLY:** Selected cases assert wrong-Assessor/cross-recipient note confidentiality, disabled future/unassigned Worker joining, permissioned console, immutable interview versions, post-End media denial, no unauthorized scorecard completion, refused incomplete decision and forged/stale MFA override. Real video/audio hardware, unauthorized provider recording replay, authenticated pentest of every role/tenant/API, all recording/jurisdiction provider contracts and load/recovery are not fully verified. Open app-wide high/critical unknown.

**REVIEWER — RECEIPT RECONCILIATION DONE, INDEPENDENT FEATURE SIGNOFF PENDING:** All 19 frozen scenario IDs mapped 1:1 to one real source check; outputs PASS 1/1, 0 skipped, hash-bound to private workstation logs; batches sizes [5,1,5,3,5] <=5. Selected case can be narrower than original scenario; no full technical approval awarded.

## Important untested recommendation branches

M2.12.06 selected only `PASS`. The remaining **five recommendation outcomes** have actual browser source tests but were not selected for this capped batch. Full six-outcome contract remains **NOT VERIFIED** until the other outcomes run in separate legal-size batches.

## Exact original scope gaps (not passes)
- `M2.11.01` — Actual Admin profile/match browser validated mismatched language, workload ceiling and corrected assignment. Full trade/scope, calibration expiry, candidate roster and every zero-eligible/retry pathway require independent test.
- `M2.11.02` — Real Worker availability and Assessor scheduling forms survive refresh. Exact UTC offsets, daylight-saving transition, browser/server timezone divergence, simultaneous slot booking and worker/company calendar representation are not tested in this selected case.
- `M2.11.03` — Real Assessor reschedule form and Worker appointment persistence passed. Downstream multi-recipient notifications, deep-link authorization, old reminder invalidation and cancellation/retry with reason are not proven by this test.
- `M2.11.04` — Actual Assessor conflict release and separately signed-in successor passed without leaking private notes to Worker or Company. Forged parallel conflicts, historical recipient bell cleanup, cross-company concurrent assignment and every stale tab not yet independently verified.
- `M2.11.05` — Real service refused early no-show and protected late-ready Worker; no-show/technical hold histories and fresh schedule request passed. Live Worker/Assessor UI, recipient alerts, third-party video failure and realistic time-zone/operator clock tests remain open.
- `M2.11.06` — 390px Worker cannot join unassigned/future interview; device readiness gates admission. Real hardware camera/mic failure and recovery, link replay from second authenticated Worker, and physical screen/video tests remain unverified.
- `M2.12.01` — Owned console service projects approved evidence and only permitted reviewer reasons. Actual consent/readiness→Assessor claim/admit/start through live browser and comprehensive foreign-role/tenant media context access were not asserted by this one test.
- `M2.12.02` — Approved versioned mobile follow-up survives reload and Worker cannot open console. Full mandatory question set, note provenance, grading version freeze and accessibility across alternate role views remain unverified.
- `M2.12.03` — Worker/Assessor media disconnect/reconnect browser retained draft notes and partial scores across tabs/reload. Degraded bandwidth, stolen token/other device, real recording/upload/restart, provider latency and all interleaving write races remain untested.
- `M2.12.04` — Actual pause/resume, technical hold, replacement interview and Worker schedule preserve archived score/notes. All notification recipients, rejected replacement, appointment double-book and cross-tenant archived evidence security checks remain open.
- `M2.12.05` — Assessor browser blocks incomplete scorecard End and pending recommendation Submit; correct completion advances once. All score dimensions/rubric criteria, role/tenant authority, stale tab concurrent finalization and reminder/audit recipient outcomes need additional proof.
- `M2.12.06` — Only PASS recommendation was selected and executed in this <=5-case batch. The other five REQUIRED recommendation branches (CONDITIONAL_PASS, ADDITIONAL_EVIDENCE_REQUIRED, REASSESSMENT_REQUIRED, SECOND_INTERVIEW_REQUIRED, FAIL) have dedicated browser source cases but were NOT run in this batch; no inference of their success.
- `M2.12.07` — Actual Assessor End shut down both users media, final submission locked and advanced the case. Forged post-End signaling replay, unexpected socket reconnect, storage retention and media adapter/recording contracts not comprehensively pentested.
- `M2.12.08` — Required Worker audio consent and browser two-party audio recording final chunk privately retained at End. Jurisdiction-specific restriction, explicit refusal, withdrawal, retention/deletion policy, provider storage failure and unauthorized download still need end-to-end tests.
- `M2.13.01` — Selected real service denies APPROVED for missing mandatory interview or assessment. Positive APPROVED/CONDITIONAL_PASS issuance, actual signed credential/PDF/public status and all required inputs are not proved by that negative-only test.
- `M2.13.02` — Selected real service creates Worker-owned Additional Evidence task and resolves old Admin action. PENDING_REVIEW, INTERVIEW_PENDING, Actor assignment, authorization and full recipient bell/deep-link/Company visibility branches remain untested.
- `M2.13.03` — Selected real issued credential source retains old signed history when accepted reassessment is finalized. REJECTED and REASSESSMENT_REQUIRED terminal outcomes, appeal/correction deadlines, recipient notifications and company lifecycle are not yet proven here.
- `M2.13.04` — Selected real service preserved signed expiry and appended suspension history after expiry. Revocation/public QR/scoped share/Company/Worker cache coherence and forced expiry timing across providers not independently checked.
- `M2.13.05` — Actual browser denies stale session/forged MFA timestamp, accepts a real recent MFA login and records override. Exhaustive override evidence reference/reason/actor authorization, parallel decision race, original-state preservation and downstream recipient/public audit still require tests.

## Next checkpoint

- **ZERO-041** next; preserve ZERO-001–040 for deep expert, provider, UAT and staged authorized penetration follow-ups.
- Previously observed `M2.10.03` legacy scoring fake database lacks `.transaction`, despite another real PGlite test PASS; original legacy source remains red until repaired.
- Previously observed `M1.11.02` independent Worker evidence browser scenario timed out; not a pass.
- Raw execution log SHA256 per case and original source pin are in `docs/qa/AGENCY_ZERO_EVIDENCE.json`. Raw logs remain on the private QA workstation and are not exposed in GitHub.

Generated UTC: 2026-11-22T20:23:13.863210+00:00
