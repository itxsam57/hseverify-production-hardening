# ZERO-015 — Evidence and supervisor observation technical evidence

**5 of at most five original related workflow units attempted.** Selected source case results: **4 PASS**, **1 FAIL/UNPROVEN**. **0 newly TECH FULLY VERIFIED.**

Source application SHA: `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. QA tooling SHA at run: `b023940c283d203586772699127b9ae4ff1084a7`. Original app/prod/staging were not modified. Local synthetic fixtures; real browser cases where indicated.

| Original scenario | Selected source test | Outcome |
|---|---|---|
| `M1.11.01` | Company organization, Worker invitation/link, Assurance Order and case-scoped Verifier review work end-to-end | SCOPED PASS |
| `M1.11.02` | tests/browser/independent-worker-review-e2e.browser.test.mjs (464959.821243ms) | TIMEOUT |
| `M1.11.03` | M1.11.03 actual Worker bell and Open skill correction v1 to approved v2, foreign and signed-out denial 320/390/1440 | SCOPED PASS |
| `M1.11.04` | M1.11.04 employment correction retains old review and rejects stale, foreign and simultaneous Verifier decisions on actual PostgreSQL16 | SCOPED PASS |
| `M1.11.05` | M1.11.05 ending one of two submitted employments retains other active record and both immutable histories | SCOPED PASS |

## Three discipline reviews — not independent certification

**ENGINEER:** Selected checks performed in the actual source application and/or isolated DB, with real input/role assertions where present. At least one check failed or could not be proven; triage from raw log required. Complete route inventory, cross-role connected effects, maintainability and responsive UI are not fully audited.

**CYBERSECURITY:** Selected negative, permission, file or race assertions were exercised only to the extent verified in each case source. No entire attack-surface, penetration-scope, independent replay, security race, provider contract or load assurance is implied. High/critical vulnerability count for full app: **UNKNOWN**.

**REVIEWER:** Original ID, title, selected test log and result accounted for, but full original Masterplan workflow/visual/code independent signoff has **not** been completed. No claim of accredited third-party review.

## Outstanding per-case test scope

- `M1.11.01`: Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M1.11.02`: Investigate selected test result TIMEOUT without discarding other evidence.
- `M1.11.03`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M1.11.04`: Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M1.11.05`: Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.

## Raw test evidence (workstation-private; SHA256)

- `M1.11.01`: `private-workstation:artifacts/agency-zero/ZERO-015/M1.11.01.log` — SHA256 `7e3665008d10e03be3a909a21503d5579d92a988087fc40e38cbeee03d9dbd57`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M1.11.02`: `private-workstation:artifacts/agency-zero/ZERO-015/M1.11.02.log` — SHA256 `100829033477a103107150bd50401d1e6d0c50e67c72b4abc8b17bda8ec2b948`, selected run exit 124, TAP {'tests': 1, 'pass': 0, 'fail': 0, 'skipped': 0}.
- `M1.11.03`: `private-workstation:artifacts/agency-zero/ZERO-015/M1.11.03.log` — SHA256 `1fb94a5194a3960ac118fd6c5720f7baf1522caf9726b5b63a82cbba6fd61339`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M1.11.04`: `private-workstation:artifacts/agency-zero/ZERO-015/M1.11.04.log` — SHA256 `fc6dd2d6991a822b47e921224484e882ad3a15c2831080ce8c9171bf6c12b096`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M1.11.05`: `private-workstation:artifacts/agency-zero/ZERO-015/M1.11.05.log` — SHA256 `d8e2c66d5816482c351076042edecab33d5d6c1dacaa7294588adf57baf3020a`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.

## Exact continuation

This batch is recorded as attempted/incomplete, **not confirmed**. Save raw evidence; do not repeat passed scoped tests without a changed candidate or reason. Continue next separate related batch while the unfinished security and independent reviews stay in the original unresolved queue.

Recorded UTC: 2026-11-22T18:56:11.841268+00:00

## Honest timeout and PostgreSQL evidence

**M1.11.02 TIMEOUT (not PASS):** original independent Worker evidence browser test reached qualification, experience, skill, and employment reject/changes/approve steps but exceeded the bounded 465s tool timeout and did not report final PASS. The original log is retained; this is not yet classified a product defect versus harness/runtime cost. Do not repeat automatically without reviewing profiling and coverage. Other four original cases passed.

**M1.11.04 real isolated PG16:** employment source correction old decision retained; foreign/stale/two Verifier concurrent decisions rejected, original source case 1/1 PASS. Temp PostgreSQL16 was stopped; bootstrap log SHA256 `4393cf144bd2afc1c52ae5dad50d401b807e743faec427fe81c1265b774a71d2`.
