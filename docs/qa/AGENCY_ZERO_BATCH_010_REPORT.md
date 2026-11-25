# ZERO-010 — Company verification technical evidence

**5 of at most five original related workflow units attempted.** Selected source case results: **5 PASS**, **0 FAIL/UNPROVEN**. **0 newly TECH FULLY VERIFIED.**

Source application SHA: `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. QA tooling SHA at run: `5d98938fb48b6e6dc13845c2cd1d1b8c5e172199`. Original app/prod/staging were not modified. Local synthetic fixtures; real browser cases where indicated.

| Original scenario | Selected source test | Outcome |
|---|---|---|
| `M1.08.01` | M1.08 pending Company evidence requires an immutable application claim while generic tenant authority stays closed | SCOPED PASS |
| `M1.08.02` | M1.08.02 pending Company remains signed in for verification but cannot invite, issue orders or purchase credits | SCOPED PASS |
| `M1.08.03` | M1.08.03 stale Admin version one review cannot decide a corrected version two without re-review | SCOPED PASS |
| `M1.08.04` | M1.08.04 terminal Company rejection preserves pending tenant, original evidence and denies stale resurrection | SCOPED PASS |
| `M1.08.05` | M1.08.05 two Admins race Company final approval or rejection on real PostgreSQL16 | SCOPED PASS |

## Three discipline reviews — not independent certification

**ENGINEER:** Selected checks performed in the actual source application and/or isolated DB, with real input/role assertions where present. All selected checks passed. Complete route inventory, cross-role connected effects, maintainability and responsive UI are not fully audited.

**CYBERSECURITY:** Selected negative, permission, file or race assertions were exercised only to the extent verified in each case source. No entire attack-surface, penetration-scope, independent replay, security race, provider contract or load assurance is implied. High/critical vulnerability count for full app: **UNKNOWN**.

**REVIEWER:** Original ID, title, selected test log and result accounted for, but full original Masterplan workflow/visual/code independent signoff has **not** been completed. No claim of accredited third-party review.

## Outstanding per-case test scope

- `M1.08.01`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M1.08.02`: Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M1.08.03`: Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M1.08.04`: Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M1.08.05`: Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.

## Raw test evidence (workstation-private; SHA256)

- `M1.08.01`: `private-workstation:artifacts/agency-zero/ZERO-010/M1.08.01.log` — SHA256 `dc3f33f0f9f26f6e05e910e777cf1ceeb28a93d4879d21fa4437441173005e72`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M1.08.02`: `private-workstation:artifacts/agency-zero/ZERO-010/M1.08.02.log` — SHA256 `aba3cc20883b06d3c9bcc3772322ec7b85344edbe309b952958626390dd7015c`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M1.08.03`: `private-workstation:artifacts/agency-zero/ZERO-010/M1.08.03.log` — SHA256 `852f654db9b1601aff21f6b323b3b8abccd47614cfe24a8c3e8f69a361ec44aa`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M1.08.04`: `private-workstation:artifacts/agency-zero/ZERO-010/M1.08.04.log` — SHA256 `b2938e6cfcf61fce2f8ffb411e7c9c4247b76f96090d665dc8a6d1d1b0dc7dad`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M1.08.05`: `private-workstation:artifacts/agency-zero/ZERO-010/M1.08.05.log` — SHA256 `6bafce6e5c538631ef9e464dcca1fe065276f406d2f24c7d2e7e55d559a63e16`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.

## Exact continuation

This batch is recorded as attempted/incomplete, **not confirmed**. Save raw evidence; do not repeat passed scoped tests without a changed candidate or reason. Continue next separate related batch while the unfinished security and independent reviews stay in the original unresolved queue.

Recorded UTC: 2026-11-22T18:23:45.766777+00:00

## PostgreSQL16 scope proof

M1.08.05 used a uniquely initialized disposable PostgreSQL16 cluster, bound to 127.0.0.1 with Unix socket at `/tmp` and a random port. The selected two-Admin verification-decision race test passed and the cluster was stopped afterward. This shows the earlier ZERO-009 startup issue was limited to its local test-cluster configuration rather than a proven application defect. Its identity-race test remains **UNEXECUTED**, not promoted. Local bootstrap SHA256 `2de05797fdf1adf0ddebe6ad496e5a6d64705dd6a29b8eb0d695dd619b08c4de`.
