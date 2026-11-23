# ZERO-016 — Evidence and supervisor observation technical evidence

**3 of at most five original related workflow units attempted.** Selected source case results: **3 PASS**, **0 FAIL/UNPROVEN**. **0 newly TECH FULLY VERIFIED.**

Source application SHA: `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. QA tooling SHA at run: `fb12d8a80c8a134110114da779451fab9ddca2f7`. Original app/prod/staging were not modified. Local synthetic fixtures; real browser cases where indicated.

| Original scenario | Selected source test | Outcome |
|---|---|---|
| `M1.11.06` | M1.11.06 leaving letter replacement preserves versioned exact employment binding and per-file private previews | SCOPED PASS |
| `M1.11.07` | Company signed observation -> Worker acknowledgement -> Verifier outcomes -> retained feedback | SCOPED PASS |
| `M1.11.08` | M1.11 inactive skill cannot be inactivated again or reopened through a revision | SCOPED PASS |

## Three discipline reviews — not independent certification

**ENGINEER:** Selected checks performed in the actual source application and/or isolated DB, with real input/role assertions where present. All selected checks passed. Complete route inventory, cross-role connected effects, maintainability and responsive UI are not fully audited.

**CYBERSECURITY:** Selected negative, permission, file or race assertions were exercised only to the extent verified in each case source. No entire attack-surface, penetration-scope, independent replay, security race, provider contract or load assurance is implied. High/critical vulnerability count for full app: **UNKNOWN**.

**REVIEWER:** Original ID, title, selected test log and result accounted for, but full original Masterplan workflow/visual/code independent signoff has **not** been completed. No claim of accredited third-party review.

## Outstanding per-case test scope

- `M1.11.06`: Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M1.11.07`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M1.11.08`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.

## Raw test evidence (workstation-private; SHA256)

- `M1.11.06`: `private-workstation:artifacts/agency-zero/ZERO-016/M1.11.06.log` — SHA256 `bc10b8fea72c8fe109188ec4be58a20171756e40b6332d530931ea2a9fa51b07`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M1.11.07`: `private-workstation:artifacts/agency-zero/ZERO-016/M1.11.07.log` — SHA256 `cb0b3ca32c9798e33735f130394ff043c6ef4a74fa51c19dff8c8f42511ebb34`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M1.11.08`: `private-workstation:artifacts/agency-zero/ZERO-016/M1.11.08.log` — SHA256 `d4ec8f8f55dda0d68c00509d62e476a314c9cf7a445e0c5071f304fb21b1da94`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.

## Exact continuation

This batch is recorded as attempted/incomplete, **not confirmed**. Save raw evidence; do not repeat passed scoped tests without a changed candidate or reason. Continue next separate related batch while the unfinished security and independent reviews stay in the original unresolved queue.

Recorded UTC: 2026-11-22T19:01:12.528155+00:00

## Original-Masterplan coverage mismatches: explicit unverified requirements

- `M1.11.08`: The test proves inactive Skill cannot be reopened, not that all report/competency calculations exclude inactive Skill. Verify actual Worker/Company skill counts.

These gaps remain **NOT VERIFIED** even if the selected related source test passed. The 218 numerator is unchanged.

## Follow-up exact-SHA evidence (R12 and R14; original results preserved)

- **M1.11.08 follow-up R12 (new tests, 2/2 scoped pass):** Independent real Chromium Worker/Verifier after an approved Skill shows 1 verified → 0 verified on Worker dashboard after mark inactive and cold reload. Three versions/old review decisions retained in PGlite; explicit trade-based Worker assessment availability becomes TRADE_REQUIRED and apply denied. Company workforce screens **do not display a verified-skill counter**, so no Company counter is proven. See [AGENCY_ZERO_R12_INACTIVE_SKILL_REPORT.md](AGENCY_ZERO_R12_INACTIVE_SKILL_REPORT.md). Original one-test history in this report unchanged.
- **M1.11.07 follow-up R14 (new tests, 5/5 scoped pass):** False signer, revoked Company session, revoked Worker read/acknowledgement, SQL overwrite/replay of signed/acknowledged source, and unacknowledged review queue bypass denied in real PGlite/service, with private SHA256 receipts. See [AGENCY_ZERO_R14_SUPERVISOR_SECURITY_REPORT.md](AGENCY_ZERO_R14_SUPERVISOR_SECURITY_REPORT.md). Prior full signed Company→Worker→Verifier 218-second browser historical result preserved, **not rerun**.
- **Still TECH FULLY VERIFIED 0/218.** Full independent scope penetration/a11y/adapter/reviewer signoff and candidate-final common gates pending. No numerator promotion.

## R15 scoped leaving-letter and Verifier handoff follow-up (source SHA unchanged)

- `M1.11.06` R15 **5/5 extra service/DB/security/adapter-handoff cases PASS** (one original scenario, five related test-case units): exact employment version SQL guard, foreign Worker copied-ID denial, pending replacement retention, clean-scan-only binding, Verifier queue exact-file identity. Raw TAP SHA256 `81fa59edc977ad24b2091224a7064fae77663309a3bbf94330683cff715946fe`; no rerun of prior real browser test. See `AGENCY_ZERO_R15_LEAVING_LETTER_SECURITY_REPORT.md`.
- TECH FULL 0/218; isolated DB/scan/queue tests are not full independent browser + security + provider/adapter review.
