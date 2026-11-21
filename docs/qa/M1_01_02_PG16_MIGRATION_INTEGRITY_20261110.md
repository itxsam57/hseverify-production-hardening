# M1.01.02 — actual PostgreSQL 16 migration integrity, rollback and security (2026-11-10)

**Release classification: SCOPED LOCAL EVIDENCE ONLY · M1.01.02 NOT FULLY VERIFIED · 0/218 · NO-GO.**

Verified code basis: active QA source `3687f7422b2fbf2d8816f93e6ba3b3100a154566` plus isolated source fix. Worktree `hseverify-m10102-migrations-20261110`, branch `qa/verify-m10102-migrations-20261110`. All PostgreSQL tests use a disposable PostgreSQL **16** cluster bound to an unadvertised random loopback port. Cluster is deleted after each run. No real provider, shared database or production credentials touched.

## Reproduced defect and root cause

- Frozen scenario **M1.01.02**: *All migrations apply, preserve history and rollback safely*. On actual PostgreSQL 16, the original `migrationStatus()` returned only filenames from the current source and **ignored an extra applied migration ID present in `hse_schema_migrations`**. This meant `db:status`, `db:migrate` and (with explicit local test authorization) `db:rollback` could miss schema drift; the first adversarial test failed RED with *Missing expected rejection*.
- Real RED: `.autopilot/artifacts/M10102_PG16_UNKNOWN_BASELINE_RED.log` — 2/3 passed; unknown applied migration not rejected. No untrusted user-role exploit was demonstrated: this is a deployment/schema-integrity issue that requires database ledger drift.
- Fix: `scripts/lib/migrations.mjs` now compares **every applied database ledger row** against the known migration filenames and fails closed on any unknown ID, before applying, reporting status, checksum repair or rolling back. Error rendering JSON-escapes unexpected IDs and limits diagnostic output.
- Confirmed real green: `.autopilot/artifacts/M10102_PG16_ALL134_REVERSE_ATTEMPT.log` — **4/4 PASS** after fix. The adversarial test validates both library and actual `db-status`, `db-migrate`, `db-rollback` CLIs.

## Positive, negative and interruption scope tested

1. All **134** `.up.sql` migrations apply exactly once, a subsequent application is no-op, and all recorded releases, checksums and timestamps remain correct.
2. Unknown applied migration ID: direct status, application, local rollback and all three public CLI entry points **reject**; pre-existing 134 migration records and data remain intact.
3. Corrupted known migration checksum blocks apply and rollback; production and preview **always forbid destructive rollback**, including with the local override flag.
4. Without explicit local-only override, even test-environment rollback is rejected. With override on disposable empty PostgreSQL 16, the latest migration rolls back and reapplies without rewriting the 133 previous history entries or a separately persisted data sentinel.
5. **All 134 down migrations**, in complete reverse order, executed successfully in a **disposable empty test database**; the full 134 up sequence then restored current checksums and had no further pending migrations. **This does not imply reverse rollback is safe with real consumer records; many down scripts explicitly refuse retained history.**
6. Broad unconfigured 36-file regression sweep contained **67 passing checks and six fixture-setup failures** (one PostgreSQL connection needed, five precompiled runtime fixtures). Those are not presented as code passes: the PostgreSQL suite above runs in its real fixture, and all five dedicated project runner scripts were launched separately.
7. Five dedicated runtime runners PASS: `npm run test:m1-06-final` (**10/10**), `test:worker-identity` (**9/9**), `test:worker-identity-draft` (**7/7**), `test:worker-identity-evidence` (**7/7**), `test:worker-identity-automated-checks` (**9/9**); combined **42/42**. These also cover migrated PGlite state persistence, strict Worker account/tenant data ownership, history-preserving rollback and stale-version rejection.
8. The new targeted GitHub workflow `m1-01-postgres-migration-integrity.yml` runs the actual 134-migration PostgreSQL 16 suite against a disposable CI service and the existing historical checksum regression. CI and exact merge SHA still require confirmation after PR.

## Still open

- Actual **protected final-SHA staging** migrations and checksum provenance, safe staged data restore/rollback or recovery of real representative active cases under realistic concurrency.
- Real database secrets, provider object-store continuity, controlled production deployment approval, schema compatibility across in-flight requests, full role/API penetration testing and Owner UAT.
- No user browser UI applies to the low-level DB CLI itself; cross-role persisted states affected by migrations need final staged checks in their own frozen scenarios.

**NEXT FIRST:** Finish exact source quality checks; guarded commit + exact-commit PostgreSQL 16 retest; push isolated QA PR, ensure new PG CI and all existing CI pass, verify signed QA merge SHA; then proceed to M1.01.03/04 candidate CI and protected deployment requirements. Never promote M1.01.02 to `FULLY_VERIFIED` based on this local drill.
