# M1.01 Windows PGlite Runtime — Owner Retest

## Gate status

This retest addresses **LATER-OWNER-001**, the release-blocking Windows application-runtime failure reported during the M1.01 owner hard test.

M1.01 remains **IMPLEMENTED — OWNER RETEST REQUIRED** until this procedure passes. M1.02 must not begin before acceptance.

## Defect being retested

The original failure occurred after a successful migration and login:

- `/worker/dashboard` rendered the protected **Temporary problem** screen;
- the application PGlite client passed a cross-realm/bundled URL object into Node filesystem handling;
- the error was wrapped as `ProfileStorageConfigurationError`;
- `app/error.tsx` mounted nested `<html>` and `<body>` elements.

The repair:

- resolves `HSE_PGLITE_DATA_DIR` to a native filesystem path string;
- uses the same path helper in migration scripts and the application;
- creates missing parent directories without deleting or replacing the configured database;
- keeps `@electric-sql/pglite` external to the Next.js server bundle;
- prevents URL objects from crossing the database path boundary;
- removes document tags from the normal root-segment error boundary;
- adds a valid root-layout `global-error.tsx`;
- adds a protected Next development-server regression using an existing migrated filesystem database.

---

## Part A — Update without deleting the database

### A1. Stop the development server

Stop every running HSE Verify `npm run dev`, `next dev`, preview or standalone process.

### A2. Pull the repair

```bash
git checkout main
git pull origin main
git log -1 --oneline
```

Record the displayed commit SHA.

### A3. Preserve the existing database

Do **not** delete, rename or recreate:

```text
.data/postgres-owner-test
```

This retest must prove that the repaired application can open the database that already passed migration.

### A4. Install locked dependencies

```bash
npm ci
```

PASS when installation exits successfully and `package-lock.json` remains unchanged.

---

## Part B — Confirm the existing database remains valid

Use the same `.env.local` values as the failed test, including:

```dotenv
HSE_APP_ENV=development
HSE_DATABASE_DRIVER=pglite
HSE_PGLITE_DATA_DIR=.data/postgres-owner-test
```

Run:

```bash
npm run db:status
```

PASS when it reports:

```text
0001_platform_foundation: applied
```

Then run:

```bash
npm run db:migrate
```

PASS when it reports:

```text
Database schema is current.
```

No reset, new database path, fallback database or duplicate migration is allowed.

---

## Part C — Run the new application-runtime regression

```bash
npm run test:runtime-db
```

PASS when it reports:

```text
Application PGlite runtime smoke test passed with an existing filesystem database.
```

This test must complete and stop its temporary development server automatically.

Then run the complete gate:

```bash
npm run check
```

PASS only when environment checks, route architecture, profile tests, platform tests, Windows path normalization, TypeScript, ESLint, protected application runtime, and production build all pass.

---

## Part D — Repeat the original browser failure path

### D1. Start the application

```bash
npm run dev
```

Open:

```text
http://localhost:3000/worker/login
```

### D2. Sign in

Use the same configured demonstration Worker credentials used in the failed test.

PASS when the application redirects to:

```text
/worker/dashboard
```

and the actual Worker Dashboard renders.

FAIL immediately if any of the following appears:

- **Temporary problem**;
- `TypeError` concerning a path, URL, Buffer or filesystem argument;
- `ProfileStorageConfigurationError`;
- blank or white screen;
- redirect loop.

### D3. Open the Worker Profile

Open **My profile**.

PASS when:

- the Profile page renders;
- previously committed values remain available;
- no new empty profile silently replaces the existing record.

### D4. Save a test change

Change one non-sensitive test field and save it.

PASS when:

- the save completes normally;
- no database/path error appears;
- the profile version advances normally;
- the Dashboard continues to load.

### D5. Refresh persistence

Refresh the Profile and Dashboard pages.

PASS when the saved value remains and no manual workaround is required.

### D6. Server-restart persistence

1. Stop `npm run dev`.
2. Start `npm run dev` again.
3. Sign in again.
4. Open Dashboard and Profile.

PASS when the same committed record remains after restart.

---

## Part E — Error-boundary and console verification

Keep the browser developer console and the terminal open while testing Dashboard and Profile.

PASS only when none of these messages appears:

```text
<html> cannot be a child of <body>
<body> cannot contain a nested <html>
multiple html/body components are mounted
```

Also confirm there is no:

- hydration mismatch caused by nested document tags;
- path argument TypeError;
- `ProfileStorageConfigurationError`;
- hidden automatic database reset or fallback warning.

The normal `app/error.tsx` must use the existing root document. Only `app/global-error.tsx` may define `<html>` and `<body>` for a true root-layout failure.

---

## Part F — Repository and database safety

Run:

```bash
git status --short
```

PASS when no tracked source or lockfile changed because of the test.

Confirm `.data/postgres-owner-test` still exists and was not replaced with an unexpected alternate directory.

Do not run destructive rollback during this focused retest.

---

## Final report

```text
M1.01 WINDOWS PGLITE OWNER RETEST

Commit tested:
Operating system: Windows
Node version:
Browser:
Configured PGlite path: .data/postgres-owner-test

A Existing database preserved: PASS/FAIL
B Migration status/current schema: PASS/FAIL
C Runtime regression and npm run check: PASS/FAIL
D Dashboard/Profile browser path: PASS/FAIL
E Refresh and server-restart persistence: PASS/FAIL
F No path/ProfileStorageConfigurationError: PASS/FAIL
G No nested html/body or hydration error: PASS/FAIL
H No reset or silent fallback: PASS/FAIL

Defects found:
1.
2.

Overall: PASS/FAIL
```

If any part fails, M1.01 remains blocked and the exact error, route, terminal output, browser console output and reproduction steps must be added to `docs/bookmarks/LATER.md` before further feature work.
