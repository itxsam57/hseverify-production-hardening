# ZERO-018 — Assurance Orders and Cases technical evidence

**5 of at most five original related workflow units attempted.** Selected source case results: **5 PASS**, **0 FAIL/UNPROVEN**. **0 newly TECH FULLY VERIFIED.**

Source application SHA: `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. QA tooling SHA at run: `fb12d8a80c8a134110114da779451fab9ddca2f7`. Original app/prod/staging were not modified. Local synthetic fixtures; real browser cases where indicated.

| Original scenario | Selected source test | Outcome |
|---|---|---|
| `M2.01.01` | M2.01 real runtime creates one durable Assurance Case and Action Centre obligation per Worker | SCOPED PASS |
| `M2.01.02` | M2.01 repeated READY validation is idempotent but still rejects subsequently revoked Worker links | SCOPED PASS |
| `M2.01.03` | M2.01 concurrent submit race produces exactly one submission and no duplicate cases/actions | SCOPED PASS |
| `M2.01.04` | M2.01.04 competing funded Worker approvals never overreserve one purchased Company credit | SCOPED PASS |
| `M2.01.05` | Actual Worker request and Company approval deliver actionable bells through the built worker | SCOPED PASS |

## Three discipline reviews — not independent certification

**ENGINEER:** Selected checks performed in the actual source application and/or isolated DB, with real input/role assertions where present. All selected checks passed. Complete route inventory, cross-role connected effects, maintainability and responsive UI are not fully audited.

**CYBERSECURITY:** Selected negative, permission, file or race assertions were exercised only to the extent verified in each case source. No entire attack-surface, penetration-scope, independent replay, security race, provider contract or load assurance is implied. High/critical vulnerability count for full app: **UNKNOWN**.

**REVIEWER:** Original ID, title, selected test log and result accounted for, but full original Masterplan workflow/visual/code independent signoff has **not** been completed. No claim of accredited third-party review.

## Outstanding per-case test scope

- `M2.01.01`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M2.01.02`: Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M2.01.03`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M2.01.04`: Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M2.01.05`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.

## Raw test evidence (workstation-private; SHA256)

- `M2.01.01`: `private-workstation:artifacts/agency-zero/ZERO-018/M2.01.01.log` — SHA256 `7bfa56ba915c5639b2820845df580e0d5a674aa43886bcd716d85e08ad790a1a`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M2.01.02`: `private-workstation:artifacts/agency-zero/ZERO-018/M2.01.02.log` — SHA256 `9d150b3e79b490142f4ee2d6b8be2f298d5e721e88fa192c1f60f99e67372054`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M2.01.03`: `private-workstation:artifacts/agency-zero/ZERO-018/M2.01.03.log` — SHA256 `da2f5eaf8ac811e3bbf8e36944e3038b04cecc29a3c5435ecb8b58894e696e30`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M2.01.04`: `private-workstation:artifacts/agency-zero/ZERO-018/M2.01.04.log` — SHA256 `9038e3abf6ce67c3af1ca505ee8064eea6c0ab2f7d5a65e3fe656a586294e8f1`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M2.01.05`: `private-workstation:artifacts/agency-zero/ZERO-018/M2.01.05.log` — SHA256 `21ce921a11388d3ccea25764fa4e863e26c80233991a1ea42b6198314db4c34c`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.

## Exact continuation

This batch is recorded as attempted/incomplete, **not confirmed**. Save raw evidence; do not repeat passed scoped tests without a changed candidate or reason. Continue next separate related batch while the unfinished security and independent reviews stay in the original unresolved queue.

Recorded UTC: 2026-11-22T19:04:37.825355+00:00

## Original-Masterplan coverage mismatches: explicit unverified requirements

- `M2.01.01`: Selected durable Case/Action Centre creation test does not exercise actual Company draft save/edit/add linked Workers UI.
- `M2.01.02`: Selected repeated READY/revoked Worker link check does not cover all invalid/unlinked/ineligible Worker and missing-funding UI explanations.
- `M2.01.03`: Selected concurrent submit idempotency does not prove multi-worker Site/Deadline scope or exact recipient state.
- `M2.01.05`: Selected Worker funding request → Company approval bell test does not prove mixed funding through assessment to final Credential.

These gaps remain **NOT VERIFIED** even if the selected related source test passed. The 218 numerator is unchanged.
