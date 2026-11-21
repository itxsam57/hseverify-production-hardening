# M1.03.04 — Actual PostgreSQL 16 independent-connection MFA race (SCOPED LOCAL, NOT FULL)

Date: 2026-11-11 Asia/Karachi. **Current source branch/head at test:** `qa/verify-m10304-company-activation-20261111` @ `2b25709df679d2a3849d5b46cc523075e2d2ae92` (merged into active QA via signed PR #79 at `119c495b089177d5a15c90c96288544111d43c27`). This new test was uncommitted at its first local execution; the next PR's exact committed CI is required before describing it as a merged-SHA regression pass.

## Exact environment
- Authorized isolated Ubuntu worktree `/home/ubuntu/work/hseverify-m10304-company-activation-20261111`, PostgreSQL **16.15**, disposable cluster `.autopilot/m10304-pg16-20261111` bound **only** to `127.0.0.1:55433`, synthetic Company account and OTP sandbox, application clock fixed 2026-10-05T03:00Z. No live customer data, live provider or production server.
- `/usr/lib/postgresql/16/bin/initdb -D .autopilot/m10304-pg16-20261111 -U hseqa --auth-local=trust --auth-host=trust --no-instructions` returned 0. Local trust authentication is limited to a short-lived loopback-only synthetic test cluster; it is not a production setting.
- `/usr/lib/postgresql/16/bin/pg_ctl -D .autopilot/m10304-pg16-20261111 -l .autopilot/artifacts/M10304_PG16_SERVER.log -o '-c listen_addresses=127.0.0.1 -p 55433 -k /home/ubuntu/work/hseverify-m10304-company-activation-20261111/.autopilot' -w start` returned 0.

## Fresh test result
- `env HSE_POSTGRES_TEST_DATABASE_URL=postgres://hseqa@127.0.0.1:55433/postgres nice -n 10 node --test tests/platform/company-registration-mfa-postgres.test.mjs` **exit 0, 1/1 PASS, 0 fail**.
- The test makes a new uniquely named temporary PostgreSQL database, applies migrations through `0080_staff_invitation_revocation_audit`, starts a real Company registration, verifies email, and holds the registration-flow row with `SELECT ... FOR UPDATE` in a distinct PostgreSQL transaction.
- Six separate `openScriptDatabase({databaseDriver:'postgres'})` instances submit the same valid MFA enrollment concurrently. `pg_stat_activity.wait_event_type='Lock'` observed **6 waiting connections** and **0 completed attempts before releasing the held lock**. After release, all six returned `complete`.
- Persisted result: **one** `mfa_enrolled` security event, **one** immutable enrollment audit entry, **one** activated Company owner membership, MFA factor active with accepted counter, registration flow complete, tenant pending, **zero** auth sessions. This is real PostgreSQL transaction and row-lock evidence, unlike the earlier in-memory PGlite regression.
- The test closes all database clients and drops the unique temporary test database. Afterwards `pg_ctl ... -w stop -m fast` **exit 0**, confirmed `server stopped`. The ignored test cluster remains on disk as evidence, **not running**.
- Raw log `.autopilot/artifacts/M10304_FRESH_REAL_PG16_QA2B.log` (includes harmless migration NOTICE messages); succinct status lines `POSTGRES_ROW_LOCK_CONTENTION_OBSERVED waiting=6 completed_before_release=0` and `POSTGRES_MFA_CONCURRENT_ACTIVATION_PASS`.

- `node --check tests/platform/company-registration-mfa-postgres.test.mjs` **PASS**; new PostgreSQL CI workflow YAML parsed (single job `independent-mfa-activation-row-lock`); `npm run typecheck` **PASS**; `npm run lint` **exit 0** with 0 errors, 9 pre-existing unrelated warnings.
- The signed QA merge `119c495b089177d5a15c90c96288544111d43c27` from PR #79 has **17/17 merged-SHA GitHub workflow runs SUCCESS**; this is engineering CI, NOT the full 218 release.

## Remaining scenario and release blockers
- A passing local real-PostgreSQL test is still **NOT** actual connected external email/SMS delivery, complete Company API/tenant/role penetration tests, an outage/expiry/retry matrix, real staging throughput/restore, protected release branch, Owner UAT or all 218 scenarios. M1.03.04 is **NOT FULLY VERIFIED**; release **NO-GO**, frozen `0/218` fully verified.

## Handoff
1. Guarded commit the new Postgres test, `.github/workflows/m1-03-company-mfa-postgres.yml`, report/TSV/current resume and V4 audit on the isolated feature branch. CI workflow must provide a disposable `postgres:16` service and rerun the exact head SHA with independent clients.
2. Push feature branch, open new PR targeting `qa/a28-eligibility-read-guard-20261107` (which contains signed PR #79); verify both new real-Postgres workflow and Autopilot compliance; merge only on green, signed GitHub merge. Check all merged SHA workflows; never count a partial case as one of 218.
3. Then next applicable Company M1.03.04 origin/tenant/API abuse and real external provider/stage checks, or M1.03.05 staff invite lifecycle when blocked externally. Keep active workstation processes and other worktrees untouched.