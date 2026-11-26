# ZERO-048 — Reports technical evidence

**5 of at most five original related workflow units attempted.** Selected source case results after original test correction and 18/18 nested-suite reconciliation: **5 PASS**, **0 FAIL/UNPROVEN**. **0 newly TECH FULLY VERIFIED.**

Source application SHA: `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. QA tooling SHA at run: `0e279442606953230c694bb243c50ee3713439da`. Original app/prod/staging were not modified. Local synthetic fixtures; real browser cases where indicated.

| Original scenario | Selected source test | Outcome |
|---|---|---|
| `M3.06.01` | Worker UI captures owned records and versioned settings, schedules and downloads actual private CSV PDF and print (51542.954816ms) | SCOPED PASS (after documented QA correction or nested TAP reconciliation) |
| `M3.06.02` | Eight Company and seven Worker report kinds export populated authoritative sources through real generation and private storage | SCOPED PASS (after documented QA correction or nested TAP reconciliation) |
| `M3.06.03` | An authenticated Company can request, generate and download actual scoped CSV, PDF and printable reports | SCOPED PASS |
| `M3.06.04` | Actual private storage errors have bounded retries, final lease expiry and owner recovery | SCOPED PASS |
| `M3.06.05` | Actual report generation enqueues its artifact-backed owner email and the registered transport confirms one local HTTP delivery | SCOPED PASS |

## Three discipline reviews — not independent certification

**ENGINEER:** Selected checks performed in the actual source application and/or isolated DB, with real input/role assertions where present. The original first source failed on an invalid required Content-Length assertion and was then corrected and rerun PASS 1/1; the nested catalogue parent/children suite passed 18/18 and was reconciled after being misclassified by a one-test-only counter. Complete route inventory, cross-role connected effects, maintainability and responsive UI are not fully audited.

**CYBERSECURITY:** Selected negative, permission, file or race assertions were exercised only to the extent verified in each case source. No entire attack-surface, penetration-scope, independent replay, security race, provider contract or load assurance is implied. High/critical vulnerability count for full app: **UNKNOWN**.

**REVIEWER:** Original ID, title, selected test log and result accounted for, but full original Masterplan workflow/visual/code independent signoff has **not** been completed. No claim of accredited third-party review.

## Outstanding per-case test scope

- `M3.06.01`: No direct older source-case link; discovered related case must be mapped/reviewed. Investigate selected test result FAIL_OR_UNPROVEN without discarding other evidence.
- `M3.06.02`: No direct older source-case link; discovered related case must be mapped/reviewed. Investigate selected test result FAIL_OR_UNPROVEN without discarding other evidence.
- `M3.06.03`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M3.06.04`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M3.06.05`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.

## Raw test evidence (workstation-private; SHA256)

- `M3.06.01`: `private-workstation:artifacts/agency-zero/ZERO-048/M3.06.01.log` — SHA256 `5d613b49085b2c1f450e99d5276015147501a3e7fcf2959807a4b7060aea5e41`, selected run exit 1, TAP {'tests': 1, 'pass': 0, 'fail': 1, 'skipped': 0}.
- `M3.06.02`: `private-workstation:artifacts/agency-zero/ZERO-048/M3.06.02.log` — SHA256 `4068d2eec5375af8d4d217fca2e8ade23984d8982c6f4ce287c09722bf2a1e64`, selected run exit 0, TAP {'tests': 18, 'pass': 18, 'fail': 0, 'skipped': 0}.
- `M3.06.03`: `private-workstation:artifacts/agency-zero/ZERO-048/M3.06.03.log` — SHA256 `06eb335f9f0edd7812c3a272d9ca8dac58182297092f7a03d49cabf64b27efd6`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M3.06.04`: `private-workstation:artifacts/agency-zero/ZERO-048/M3.06.04.log` — SHA256 `18348509c94e9bbc6b324e3bcab495df34fa16b1ef071f5b4720d07964f0ba4e`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M3.06.05`: `private-workstation:artifacts/agency-zero/ZERO-048/M3.06.05.log` — SHA256 `88114d0dd3bae6c969c016f2bbb771702cc41c6044eebe0c706f72b7b9775957`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.

## Exact continuation

This batch is recorded as attempted/incomplete, **not confirmed**. Save raw evidence; do not repeat passed scoped tests without a changed candidate or reason. Continue next separate related batch while the unfinished security and independent reviews stay in the original unresolved queue.

Recorded UTC: 2026-11-23T02:07:44.260053+00:00

## Actual transport/header diagnosis and QA-only correction (no app runtime edit)

The original Worker browser download test **FAILED** expecting HTTP `Content-Length` for a response that Next.js legitimately sent with `Transfer-Encoding: chunked` (and `Content-Encoding: gzip` for CSV/print). The response route configures byte length, but HTTP/1.1 compression/streaming removed it. A private diagnostic executed the remaining full Worker report browser workflow and **passed 1/1**, proving all generated response bodies matched the immutable stored artifacts. It logged: CSV 234 bytes, PDF 15732 bytes, printable HTML 1059 bytes; chunked transfer for all three, gzip for CSV and print. The QA test was corrected to compare Content-Length only when present on uncompressed bodies, while preserving all payload equality, hash, permission, private-cache, safe-print and download assertions. The **original** selected browser source then passed **1/1**, no skips. No production file was modified. Original failed test, derivative diagnostic, and corrected original rerun are separately hash-anchored in the evidence register.

- QA test source SHA256 `76561483a045ec9ff38abbdfa31aa8680f69ebf608fe5ee14078e407358b3e56`; corrected original source log SHA256 `264b00fe7f5476ab8e964241e417c73da5a0f4fc6ffe4a7f4711b667f8db1e02`; diagnostic log SHA256 `4a478f0c3a651cbf785c529c759bd8777e1600b76258055e2ed08b810f591b8f`.

## Nested report catalogue interpretation

`M3.06.02` used **one parent original report workflow** with 17 nested checks: **18/18 TAP PASS, 0 fail, 0 skip**. The generic single-test parser initially marked it unproven despite no failed assertion. Manual evidence reconciliation confirms the exact parent title and all 18 clean checks in the unchanged original log (SHA256 `4068d2eec5375af8d4d217fca2e8ade23984d8982c6f4ce287c09722bf2a1e64`). This counts one original scenario source workflow, not 18 separately completed scenario IDs.

## Original workflow coverage still NOT fully verified

- `M3.06.01`: Real Worker browser CSV/PDF/print generated genuine authorized bytes, SHA256, escaped printable markup, scheduled/email/history flows and full rerun passed after fixing an invalid HTTP Content-Length assertion; all six report types, every permission/retry/schedule/role and live email delivery are not fully reviewed.
- `M3.06.02`: One parent report catalogue workflow passed 18/18 TAP checks, including eight Company and seven Worker report kinds. Real end-user rendered reports, full source-data permutations, mixed counts, large input/caching/performance and all tenant roles remain unverified.
- `M3.06.03`: Company browser CSV/PDF/print downloads and scoped filters passed. Full preview, every saved filter combination, PDF readability, print, accessibility and every authorization edge need independent multi-role checks.
- `M3.06.04`: Actual report private-storage failure, bounded retry, lease expiry and owner recovery passed. Real cloud storage outages, malware scanning, production worker retries, operational restoration and realistic load not yet verified.
- `M3.06.05`: Selected report produced bytes and local HTTP email transport confirmed delivery. Real external email provider inbox, recipient authorization after revocation, timezone-specific schedules, failure/retry and privacy link expiry remain unverified.

**ENGINEER:** selected scoped checks PASS. **CYBERSECURITY:** limited checks only, live adapter+penetration pending. **REVIEWER:** original feature, cross-role UI and independent final expert approval not done. **TECH FULL: 0.**
