# PostgreSQL backup and isolated restore

Use a private custom-format `pg_dump` archive and a matching PostgreSQL major-version `pg_restore`. Keep database credentials in the process environment, never command arguments or logs. Preserve private object bytes, their hashes, and the authentication and signing configuration separately. A database archive alone does not restore private files.

Restore into a newly created isolated database. Do not overwrite or migrate the source database. Check all restore commands for a successful exit, compare retained table rows and object hashes, then apply the current pending migrations and run authenticated business workflows before exposure. Keep the original database and archive unchanged until the restored environment is verified.

Migration0122 pins the report snapshot validator's search path. New archives containing that migration support standard custom archive restore, including populated report snapshots. The validator body, report history and constraints are unchanged.

For an older archive containing migration0098 report tables but lacking0122, restore in three sections into the new database:

1. Run `pg_restore --section=pre-data --exit-on-error --no-owner` against the new database.
2. Apply only `database/migrations/0122_report_snapshot_restore_search_path.up.sql` to that new database as a compatibility hook. This repairs helper resolution during the upcoming COPY operations; do not apply it to the archive or source database.
3. Restore the `data` section, then the `post-data` section, with `--exit-on-error --no-owner` against the same new database.
4. Apply normal pending migrations. The configuration-only0122 statement safely repeats when migration history catches up.

Do not globally broaden pg_restore's session search path or disable retained-data checks to bypass a failed restore. A failed isolated restore stays private for diagnosis.

`tests/platform/report-snapshot-restore-postgres.test.mjs`, selected by `npm run test:postgres-json`, queues a real nonempty Worker report, reproduces the legacy empty-path failure, applies0122, restores a standard custom archive and checks exact retained report data. It also verifies body preservation, configuration-only rollback and refusal to overwrite configuration drift. Supply `HSE_POSTGRES_TEST_DATABASE_URL`; portable test hosts may set `HSE_POSTGRES_PG_DUMP` and `HSE_POSTGRES_PG_RESTORE` to matching binary paths. This test creates and removes only uniquely named disposable databases.
