# M1.01 — Repository, Environments, Database and Release Foundation

## Canonical scope

This brick closes the first Milestone 1 foundation dependency before authentication, tenant isolation and evidence uploads continue.

It provides:

- validated development, test, preview and production configuration;
- one PostgreSQL-compatible schema across environments;
- embedded PGlite for low-resource local development and CI;
- PostgreSQL connection support for preview and production;
- deterministic forward migrations with checksums;
- guarded local/test down migration;
- database-backed Worker Profile persistence;
- one-time import of previously accepted file-backed Worker Profile records;
- standalone preview artifact creation and smoke testing;
- release evidence manifests;
- exact-ref rollback candidate builds;
- CI evidence and an owner hard-test gate.

## Environment contract

`HSE_APP_ENV` is one of:

- `development`
- `test`
- `preview`
- `production`

Development and test may use `HSE_DATABASE_DRIVER=pglite`. Preview and production must use `HSE_DATABASE_DRIVER=postgres` with a private `DATABASE_URL`.

The validator rejects:

- session secrets shorter than 32 characters;
- PostgreSQL mode without a PostgreSQL URL;
- PGlite in preview or production;
- missing release SHA in preview or production;
- demonstration authentication or demonstration data in production.

Only server-side modules may read private runtime configuration.

## Database and migrations

The initial migration creates:

1. `hse_schema_migrations`
2. `worker_profiles`
3. `deployment_releases`

Migration files are immutable after application. Each applied migration stores its SHA-256 checksum and release SHA. A checksum mismatch stops migration instead of silently accepting changed history.

Commands:

```bash
npm run db:migrate
npm run db:status
```

Local/test destructive rollback requires explicit acknowledgement:

```bash
HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=true npm run db:rollback
```

Destructive down migration is prohibited when `HSE_APP_ENV` is `preview` or `production`. Those environments roll application code back by rebuilding an approved prior release while keeping forward-compatible database migrations.

## Worker Profile migration

The active Worker Profile repository now uses `worker_profiles` and preserves optimistic concurrency with version predicates at the SQL boundary.

A stale request affects zero rows and becomes `ProfileVersionConflictError`; it cannot overwrite a newer record.

Previously accepted local JSON records can be imported once:

```bash
npm run db:import-profiles
```

Existing database records are skipped by default. Overwrite requires the explicit `HSE_IMPORT_OVERWRITE=true` flag.

## Preview artifact

Next.js builds with `output: "standalone"`. CI then:

1. installs the committed lockfile;
2. validates environment rules;
3. runs route and architecture checks;
4. runs Worker Profile and platform tests;
5. typechecks and lints;
6. creates the production build;
7. starts the standalone server;
8. smoke-tests `/` and `/worker/login`;
9. generates `release-manifest.json`;
10. uploads the preview bundle, manifest and migration files as a GitHub Actions artifact.

The release manifest records:

- release commit SHA;
- application environment;
- Node version;
- package-lock SHA-256;
- complete migration-set SHA-256;
- creation time.

## Rollback model

The `Build rollback candidate` workflow accepts an exact approved commit SHA or tag. It checks out that version, installs its own committed lockfile, runs its complete validation gate, smoke-tests the standalone server and uploads a separately named rollback artifact.

This proves that a prior release can still be rebuilt before an operator changes production traffic. It does not pretend to control a hosting provider that has not been connected.

## Security boundaries

- No production secret is committed.
- Production demonstration auth and data are rejected.
- Database connection strings remain server-only.
- Migration history is checksummed.
- Destructive production rollback is rejected.
- Preview and rollback workflows use read-only repository permission except the temporary lockfile-generation workflow, which must be removed before merge.
- Release artifacts are tied to immutable commit SHAs.

## Definition of Done status

The code and automated gate can be merged after CI succeeds. M1.01 receives a roadmap ✅ only after the owner completes `docs/testing/M1_01_PLATFORM_FOUNDATION_HARD_TEST.md` and reports PASS.
