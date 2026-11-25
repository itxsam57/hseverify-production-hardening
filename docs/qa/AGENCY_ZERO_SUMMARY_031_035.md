# ZERO — Five-batch Agency QA reconciliation 031–035

Frozen app candidate SHA: `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. Only isolated test fixtures, no production, shared stage, real provider or product source modifications.

**Five related batches attempted, exactly 20 frozen original scenario IDs. Selected original source tests: 19/20 PASS, 1/20 FAIL (stale test harness). A separate real-database test for failed original source: 1/1 PASS. TECH FULLY VERIFIED: 0/218. OWNER TESTING READY: NO.**

| Batch | Family | Original units | Selected PASS | Selected FAIL | TECH FULL |
|---|---|---:|---:|---:|---:|
| [ZERO-031](AGENCY_ZERO_BATCH_031_REPORT.md) | Save/exit, offline autosave, resume | 5 | 5 | 0 | 0 |
| [ZERO-032](AGENCY_ZERO_BATCH_032_REPORT.md) | Replacement & retained history | 3 | 3 | 0 | 0 |
| [ZERO-033](AGENCY_ZERO_BATCH_033_REPORT.md) | Integrity evidence/privacy | 5 | 5 | 0 | 0 |
| [ZERO-034](AGENCY_ZERO_BATCH_034_REPORT.md) | Written scoring & calibration | 5 | 4 | 1 | 0 |
| [ZERO-035](AGENCY_ZERO_BATCH_035_REPORT.md) | AI advisory & escalation | 2 | 2 | 0 | 0 |

## Three review disciplines (scoped, never agency accreditation)

**ENGINEER — 19/20 selected original sources PASS; 1 test-contract failure.** Real isolated Chromium recovery/resume and separate replacement journeys both reached scoring/credential/revocation/appeal; replay idempotency and draft ownership checked with real database. Integrity and calibration role browsers passed. One legacy scoring mock used a query-only DB incompatible with current transaction-required service. A modern real database scoring workflow passed independently, but the legacy test stays red until fixed and retested.

**CYBERSECURITY — targeted assertions passed, full pentesting INCOMPLETE.** Tests exercised Worker/role draft isolation, stale-session denial, immutable answer drafts/old attempts, submitted signal escalation, accommodation PII suppression, scoring immutability, revoked review authority, failed/expired calibration gating and advisory-only AI. Complete authenticated API/tenant permissions matrix, active pen, provider/media adapters, attack replay, monitoring infrastructure, load, concurrency and operational recovery still lack complete independent evidence. App-wide high/critical unknown.

**REVIEWER — evidence reconciliation completed, independent final feature signoff NOT DONE.** Twenty exact frozen IDs, <=5 per batch, each anchored to raw source test output and private SHA256 receipts. Both failed mocked test and modern passing real DB evidence are retained. Some source assertions cover only a slice of the original workflow; no cross-role/manual UI verification certificate was awarded.

## Known unresolved issue

- **M2.10.03 old harness FAIL:** query-only fake DB does not implement `.transaction`. Do not label as a production bug; separate real PGlite test PASS does not resolve test maintenance failure. Independent complete written-scoring recipient and human review outcomes still untested.
- Prior `M1.11.02` 465-second independent Worker browser review timeout remains unresolved.

## Original scenario coverage gaps (not completed)
- `M2.08.01`: Selected UI contract validates Save and exit action ordering; full actual browser user input, autosave acknowledgment, session renewal and cold Resume after exited state require more independent evidence.
- `M2.08.02`: Selected UI state-machine contract checks autosave, retry and no local storage, but genuine physical offline/online network drop and real MCQ/written latest-draft sync in browser remain unverified.
- `M2.08.03`: Selected real database service view restores one server draft, but abrupt crash/navigation, active timer and separate-browser reload state not all checked here.
- `M2.08.04`: Selected real service rejects foreign Worker/non-Worker/revoked draft saves; bound-device and concurrent-auth-session attempts with full browser state need further attacker replay checks.
- `M2.08.05`: Full actual Worker browser emergency exit→Verifier recovery approval→resume→scoring/credential/share/appeal passed on isolated fixtures; independent manual usability, real media interruption, device change, denial/retry and multi-tenant permission pentest still needed.
- `M2.08.06`: Full actual Worker browser emergency exit→Verifier replacement approval→new form→credential/share/appeal passed; additional denied replacement, hardware/device failure and replacement-concurrent callback scenarios not checked.
- `M2.08.07`: Chosen service test verifies committed previous answer replay cannot delete next draft; it does NOT itself demonstrate ALL original exposure versions, original attempt and all answer record immutability through replacement. The related replacement browser journey passed in M2.08.06; direct multi-attempt DB comparison remains open.
- `M2.08.08`: Selected real database parallel identical final-submission case yields one receipt/transition; lost HTTP response, browser refresh, two-device retry and receipt rendering have not been independently exercised.
- `M2.09.01`: Selected objective submission with retained concern routes to human review; all GREEN/YELLOW/RED thresholds, policy variations, notifications and no-automatic-guilt UI must be audited.
- `M2.09.02`: Selected browser integrity owner boundary passed; every fullscreen/tab/paste/network/device event type with actual monitoring capabilities, attack replay and timeline timestamp correctness is not comprehensively evidenced.
- `M2.09.03`: Selected capture service degrades and recovers correctly in synthetic runtime; physical camera/mic/screen, liveness provider outage, remote capture and retention/privacy compliance remain unverified.
- `M2.09.04`: Actual Worker signal and submitted answer reach Verifier reasoned integrity form; all independent human CLEAR/ADDITIONAL_EVIDENCE/FAIL dispositions and Worker/Company status propagation need complete role review.
- `M2.09.05`: Actual monitoring privacy browser case strips accommodation disclosure; full PII fuzzing, OCR/text labels, storage adapter and all notifications/exports require adversarial review.
- `M2.10.01`: Selected real browser verifies written-scoring route only, not full authorized reviewer answer/rubric disclosure matrix for every reviewer role and tenant.
- `M2.10.02`: Reasoned score amendment preserves immutable original in DB, but actual UI marks entry, double-commit, rejection, post-final cross-role notifications and appeal require full end-to-end validation.
- `M2.10.03`: Original selected legacy mocked scoring lifecycle FAILED because query-only test double lacks required transaction interface. A different real PGlite scoring workflow PASSED 1/1, but that does not repair the old test or prove all next-owner case routing. Keep original FAIL pending harness modernization and full human review.
- `M2.10.04`: Selected real scoring service conflict blocks reviewer and routes to Admin with retained draft; stale reviewer second-tab, tenant transfer, independent reassignment, owner notification and permission changes remain to test.
- `M2.10.05`: Live browser calibrated expiry/FAILED gate blocked Verifier and showed Worker hold; full expiry clock controls, shift/calibration race, separate Admin actor, retries and accessibility signoff pending.
- `M2.10.06`: Browser AI scoring assistance remained advisory and Admin replay reconstructed case. Provider outage, misleading AI input/prompt injection, bias, private data sent to provider, retries and role restrictions still require contract/security tests.
- `M2.10.07`: Actual browser Unable-to-verify→Admin escalation→independent return and private notes passed; exhaustive stale notes, leak attempts, concurrency, all reason codes and notification/read receipts remain unverified.

## Next exact continuation

- Run **ZERO-036** next: interview scheduling, <=5 original scenario units.
- Preserve earlier ZERO-001–035 reviewer/pentest/adapter gaps. Repair old M2.10.03 harness without changing runtime behavior, rerun exact original source test, investigate earlier M1.11.02 timeout. Do not repeat selected prior green tests without cause or candidate change.
- Logs and SHA256: `docs/qa/AGENCY_ZERO_EVIDENCE.json`; strict attempt/cursor: `docs/qa/AGENCY_ZERO_CURSOR.json`. Raw logs remain private on workstation.

Recorded UTC: 2026-11-22T19:58:08.716828+00:00
