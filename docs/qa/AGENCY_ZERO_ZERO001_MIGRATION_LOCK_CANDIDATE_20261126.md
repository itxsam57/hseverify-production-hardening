# ZERO-001 M1.01.02 — PostgreSQL16 concurrent migration lock candidate

APPROVED SOURCE: 7ff30ea140a5145e5d5ba761f7c7aef24c895269 remains unchanged. This branch is an isolated draft candidate stacked on the QA-only PR249, with no merge, deployment, or source repin. Original ZERO-001 still 0/4 TECH FULL; original 218 remains 0/218.

REAL CONFIRMED ORIGINAL DEFECT: Two deployment processes simultaneously attempted to initialize a fresh PostgreSQL16 migration ledger on approved SHA7ff. One exited0, the other exited1 with SQLSTATE23505 duplicate type/index during the initial hse_schema_migrations creation. The surviving process installed139 migrations. Private prior receipt: M10102-PG16-parallel-migrators-20261125T140258Z-30d656.json SHA256 eb045cd5cb06befcfcde701e080223da0bc6d90c315ac3a5e495a0d15330fc89.

REUSED EXISTING PROPOSED FIX: Exactly four files from old unmerged draft PR244 QA source SHA85a9e4cbcb3ce3219c693f273f35ce7017de7528:
- scripts/lib/database.mjs: PostgreSQL reserved dedicated session advisory lock and explicit unlock, leaving second connection for ordered migrations; PGlite in-process serial wrapper.
- scripts/lib/migrations.mjs: fail closed if PostgreSQL database lacks migration lock support, lock entire apply operation before first migration ledger creation.
- tests/platform/m1-01-pg16-concurrent-startup.test.mjs: two real child migrate commands on freshly created PostgreSQL16 database must both exit0; all 139 checksums and migration records match, then drop temporary database.
- .github/workflows/m1-01-postgres-migration-integrity.yml: actual PostgreSQL16 service workflow runs both existing four migration safety cases and new concurrent startup regression, persists logs on failure and watches both affected source paths.

FRESH REAL WORKSTATION RESULT on isolated candidate working source: 5/5 related source cases PASS, zero failures/skips. Concurrent two-process startup 1/1 PASS, both processes exit0; four existing actual PostgreSQL16 migration safety cases 4/4 PASS, exact139 final ledger after full reverse/reapply, unknown migration and unsafe rollback refused. PostgreSQL16 servers and data-dir fixtures stopped and removed, no shared or production database writes. All four edited files byte-for-byte equal prior SHA85a9 proposed fix. Previous independently observed lock-holder SIGKILL recovery, waiter resume, 139-migration correct ledger and idempotent replay at SHA22db used byte-identical two library files and passed four scoped checks; not rerun.

CODE QUALITY: Node check PASS; strict TypeScript PASS; lint exit0, no errors, 11 existing warnings; YAML contains permanent PostgreSQL16 workflow gate. Production runtime src, database migrations, package lock and Next configuration are not modified by this source candidate.

ENGINEER: Scoped PASS five real PostgreSQL16 tests. CYBERSECURITY: Scoped PASS targeted concurrency and existing identical-code crash recovery; full penetration testing and live adapter/provider exercise remain open. REVIEWER: AI compared original raw failure, previous fix source contents, actual new executable logs, SQL source checks and server teardown. No independent owner or external signoff, no FULL credit.

PRIVATE RECEIPT: /home/ubuntu/work/.hse-qa-tmp/agency-zero-sequential-closure-001/ZERO001-M10102-REVIEWED-MIGRATION-LOCK-INTEGRATION-ECR-20261126.json
SHA256: 07a67892a790a4d2409eebbb106a4d5ad256269bf2b39da911f11bcc24ef6fda

NEXT: V4 guarded commit, draft PR stacked against PR249 QA-only branch, mandatory exact HEAD GitHub PostgreSQL16 job and full regression source audit. Only then review a controlled candidate pin change. Keep ZERO-001 active, do not test ZERO-002.
