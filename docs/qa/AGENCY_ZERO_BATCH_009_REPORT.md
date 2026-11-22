# ZERO-009 — Identity technical evidence

**2 of at most five original related workflow units attempted.** Selected source case results: **1 PASS**, **1 FAIL/UNPROVEN**. **0 newly TECH FULLY VERIFIED.**

Source application SHA: `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. QA tooling SHA at run: `52b5b7bad67dc9b276d0e23e1d4d1f331baea9cf`. Original app/prod/staging were not modified. Local synthetic fixtures; real browser cases where indicated.

| Original scenario | Selected source test | Outcome |
|---|---|---|
| `M1.07.06` | actual two authenticated Workers: correction preserves original ID; matching second account requires Admin duplicate review | SCOPED PASS |
| `M1.07.07` | NO CONFIRMED TITLE | BLOCKED_TEST_ENVIRONMENT |

## Three discipline reviews — not independent certification

**ENGINEER:** Selected checks performed in the actual source application and/or isolated DB, with real input/role assertions where present. At least one check failed or could not be proven; triage from raw log required. Complete route inventory, cross-role connected effects, maintainability and responsive UI are not fully audited.

**CYBERSECURITY:** Selected negative, permission, file or race assertions were exercised only to the extent verified in each case source. No entire attack-surface, penetration-scope, independent replay, security race, provider contract or load assurance is implied. High/critical vulnerability count for full app: **UNKNOWN**.

**REVIEWER:** Original ID, title, selected test log and result accounted for, but full original Masterplan workflow/visual/code independent signoff has **not** been completed. No claim of accredited third-party review.

## Outstanding per-case test scope

- `M1.07.06`: No direct older source-case link; discovered related case must be mapped/reviewed. Remaining complete role/UI/security/adapter-contract/reviewer evidence to be gathered.
- `M1.07.07`: Investigate selected test result BLOCKED_TEST_ENVIRONMENT without discarding other evidence.

## Raw test evidence (workstation-private; SHA256)

- `M1.07.06`: `private-workstation:artifacts/agency-zero/ZERO-009/M1.07.06.log` — SHA256 `54ffd0b7666aab154903402cba10c32b120caa12081eba71627834c8c88d0bd4`, selected run exit 0, TAP {'tests': 1, 'pass': 1, 'fail': 0, 'skipped': 0}.
- `M1.07.07`: `private-workstation:artifacts/agency-zero/ZERO-009/M1.07.07.log` — SHA256 `bb5282204d32c33f9967b231b386d11014cbfd05c764a2aa4d82ee562507e2ca`, selected run exit 125, TAP {'tests': None, 'pass': None, 'fail': None, 'skipped': None}.

## Exact continuation

This batch is recorded as attempted/incomplete, **not confirmed**. Save raw evidence; do not repeat passed scoped tests without a changed candidate or reason. Continue next separate related batch while the unfinished security and independent reviews stay in the original unresolved queue.

Recorded UTC: 2026-11-22T18:20:45.146554+00:00


## PostgreSQL16 environment failure, not a product-code FAIL

M1.07.06 real browser case **PASS 1/1**. M1.07.07 **BLOCKED_ENVIRONMENT**: one initial locally created disposable PostgreSQL16 cluster did not start; a single corrected absolute-path setup also did not start. The test code and its race assertions **were never reached**. We retained the source-case initial log, both `pg_ctl`/`initdb` bootstrap logs and retry log. Most likely cause is invalid Unix socket-directory configuration in this locally prepared isolated path, still requiring confirmation. Per max-two-attempt rule, park rather than repeatedly retry; other batches continue. **Do not classify M1.07.07 as a production vulnerability or as passed.**

- `M1.07.07.pg-bootstrap.log` SHA256 `5eca42465c81a5de4d4c5f54f71517a699cf8e4d6f8da7d87c8e5faf131181fe`
- `M1.07.07.pg-bootstrap-retry.log` SHA256 `34248c285fe50f97ccc0e9b7679c2b462e0166c780ccafce8873f41b280007af`
- `M1.07.07.retry.log` SHA256 `206a75962e17b0e6fc17e50f39ea15a4f60581bf6f8b3f8647bf7d2f59d2a15e`

## Resolved test-environment blocker — targeted revalidation

**2026-11-22T18:28:08.090173+00:00**: After later independent ZERO-010 and ZERO-011 PostgreSQL16 tests proved a working isolated short Unix socket (`-k /tmp`), re-ran **only** the original unexecuted M1.07.07 case on fresh localhost PostgreSQL16. **PASS 1/1**: two genuine Admins' duplicate disposition race serialized, the stale loser could not issue a Worker ID. Test fixture was shut down; no app code changed. This confirms initial 1/2 result was an **environment problem**, not a demonstrated application bug. The original two failed PG setup attempts and all their logs remain preserved. **Updated selected scoped results: 2/2 PASS; TECH FULLY VERIFIED still 0/2.**

- Revalidated source log SHA256 `ad85eafeabdbca12f35883b09d03792b598839a79e6ac5b51452d53f31034537`
- PG bootstrap/start/stop log SHA256 `304839212d01df2447bac76d635faf55f001c9c65e28e353a64326d92e010407`
