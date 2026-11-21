# M1.02.03 — real browser form validation, error and retry states (2026-11-10)

**SCOPED LOCAL QA PASS, NOT FULLY VERIFIED. FULLY VERIFIED 0/218; RELEASE NO-GO; complete pentest incomplete.**

Base tested QA source: `4b6f683a7be6b9e273b9df91c5f75d72270bb73a`. Worktree `hseverify-m10203-feedback-20261110`, branch `qa/verify-m10203-feedback-20261110`. Only isolated synthetic PGlite/Chromium Next development instances and local sandbox payment/storage were used. Do not rebind old-source evidence to a later merge SHA.

## Reproduced test-fixture/coverage defect

- Original `tests/browser/error-recovery-controls.browser.test.mjs` used shared `/tmp/independent-audit-credentials.json`, risking wrong synthetic credentials and collision between unrelated local testers. Corrected to `HSE_AUDIT_CREDENTIALS_PATH` **inside its unique disposable PGlite directory**, removed on cleanup. No real production credentials are used.
- Original registration validation was desktop-only and the Worker/Company retry-error tests did not assert the 320px and 390px layout. Explicit source-coverage probe RED: `.autopilot/artifacts/M10203_TEST_COVERAGE_RED.log`. Added real viewport checks. This is a **test isolation and missing acceptance coverage defect**, NOT a proven production leak or vulnerability.

## Actual real Chromium results

1. `consumer-validation.browser.test.mjs`: real Worker registration and Company application invalid submit, all required field feedback and `aria-invalid`/described-by, keyboard-visible focus, no overflow at **1365/390/320** — **1/1 PASS**.
2. `error-recovery-controls.browser.test.mjs`: deliberately break only disposable `credential_appeals` and `billing_checkouts` tables; real signed-in Worker Dashboard and Company Billing error boundaries display safe generic messages, no SQL/stack/secret leak, Retry buttons remain usable with no client exception and no horizontal overflow at **390/320/1280** — **1/1 PASS**. The backend intentionally remains unavailable; **restoration-to-success after repaired infrastructure is not proven by this test**.
3. `worker-file-upload-validation.browser.test.mjs`: real Worker form rejects files over the limit, unsupported type, MIME spoofing and unsafe paths, preventing invalid storage reservations — **1/1 PASS**. Local filesystem test adapter, not production object-store provider.
4. `company-billing-validation.browser.test.mjs`: real Company form creates/captures sandbox checkout exactly once, handles repeated cached capture, rejects invalid refund with persistent actionable feedback, accepts correct retry and clears stale error; reload and ledger/audit checks — **1/1 PASS**. **Sandbox only**, no payment provider settlement signoff.

**4 distinct real browser tests PASS, 4/4 local test commands exit0.** Full logs: `.autopilot/artifacts/M10203_{BASELINE,EXPANDED,worker-file-upload-validation,company-billing-validation}*.log`. Strict TypeScript PASS, ESLint exit 0 with 9 existing warnings, source syntax checks and dedicated GitHub workflow parsed by actionlint v1.7.12. Tracked machine-readable receipts: `docs/qa/evidence/M1_02_03_QA4B_LOCAL_RESULTS.tsv`.

## CI and remaining acceptance

Added `.github/workflows/m1-02-feedback-states.yml`: **two separately isolated GitHub-hosted Chromium jobs** for form/billing states and error-boundary recovery, exact source SHA checkout with browser logs retained. Actual GitHub job/merge status must be observed, not assumed.

**Missing scenario dimensions:** all 218 scenario pages' actual empty/loading/error/denial/retry/success states, authenticated cross-role/tenant/API attempts for each page, real provider timeouts/interruption, restored-service Worker/Company retry-to-success, final staging mobile/keyboard accessibility, realistic load/recovery and Owner UAT. Do not promote M1.02.03 to FULLY_VERIFIED.

**Next:** guarded commit and real Chromium rerun on exact committed SHA; push QA PR (based on QA4b while PR72 QA b516 is newer), verify no conflicts and all GitHub tests, signed merged SHA. Then resume the first unfinished M1.02.03 empty/loading/recovery criterion or next actionable frozen test, always release NO-GO.
