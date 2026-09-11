# M1.01 Platform Foundation — Owner Hard Test

> **Windows retest notice:** The initial owner test found `LATER-OWNER-001` in the real Next.js/Turbopack application path after migrations passed. After PR #6, preserve the existing database and follow `docs/testing/M1_01_WINDOWS_PGLITE_RETEST.md` before continuing the remaining checklist.

## Gate rule

Do not begin M1.02 until this test passes or defects are recorded in `docs/bookmarks/LATER.md`.

This test proves that the new environment, database, migration, persistence, preview and rollback foundations work on the owner's machine and in GitHub Actions—not only in the builder's CI assumptions.

## Expected to work

- locked dependency installation;
- strict environment validation;
- PGlite local database without Docker;
- deterministic migration application and status;
- database-backed Worker Profile save/load;
- profile persistence after refresh and server restart;
- stale-form conflict protection;
- one-time import of legacy JSON profiles;
- standalone preview build and smoke test;
- release manifest generation;
- guarded local rollback and migration reapplication;
- preview artifact production in GitHub Actions;
- exact-ref rollback candidate workflow.

## Not expected in this brick

- live external production deployment;
- production PostgreSQL credentials supplied by the repository;
- automated production traffic switching;
- authentication/OTP beyond the temporary demo adapter;
- identity evidence upload.

Those items remain in their canonical later bricks or provider activation records.

---

## Part A — Pull and prepare

### A1. Pull the exact main branch after the M1.01 merge

```bash
git checkout main
git pull origin main
git log -1 --oneline
```

Record the displayed commit SHA in your test report.

### A2. Install locked dependencies

```bash
npm ci
```

PASS when:

- installation exits with code 0;
- no manual package edit is required;
- `git status --short` does not show `package-lock.json` modified.

### A3. Create `.env.local`

Windows:

```bash
copy .env.example .env.local
notepad .env.local
```

Use test-only values:

```dotenv
HSE_APP_ENV=development
HSE_RELEASE_SHA=local-owner-test
HSE_DEPLOYMENT_ID=local-owner-test
HSE_SESSION_SECRET=owner-test-session-secret-with-at-least-thirty-two-characters
HSE_DATABASE_DRIVER=pglite
HSE_PGLITE_DATA_DIR=.data/postgres-owner-test
DATABASE_URL=
HSE_ENABLE_WORKER_DEMO_AUTH=true
HSE_WORKER_DEMO_EMAIL=worker@example.com
HSE_WORKER_DEMO_PASSWORD=LocalTestPassword123!
HSE_WORKER_DEMO_NAME=Owner Test Worker
HSE_WORKER_DEMO_ID=HSE-WRK-OWNER-0001
HSE_USE_WORKER_DEMO_DATA=false
HSE_DEMO_PROFILE_IDENTITY_LOCKED=false
HSE_LEGACY_PROFILE_STORAGE_DIR=.data/worker-profiles
HSE_IMPORT_OVERWRITE=false
```

Never use real worker data.

---

## Part B — Automated gate

### B1. Validate the complete project

```bash
npm run check
```

PASS only when all of these pass:

1. environment validation;
2. route/role/database architecture manifest;
3. Worker Profile domain tests;
4. platform foundation tests;
5. TypeScript;
6. ESLint;
7. Next.js production build.

Save the full terminal output if anything fails.

### B2. Inspect repository cleanliness

```bash
git status --short
```

Expected: no tracked source file changed. `.data`, `.next`, preview bundles and release manifests must remain ignored.

---

## Part C — Environment rejection tests

### C1. Reject a weak session secret

Temporarily change:

```dotenv
HSE_SESSION_SECRET=short
```

Run:

```bash
npm run validate:env
```

PASS when it fails and explicitly says the session secret requires at least 32 characters.

Restore the valid secret.

### C2. Reject production PGlite

Temporarily set:

```dotenv
HSE_APP_ENV=production
HSE_DATABASE_DRIVER=pglite
HSE_RELEASE_SHA=owner-production-test
HSE_ENABLE_WORKER_DEMO_AUTH=false
HSE_USE_WORKER_DEMO_DATA=false
```

Run:

```bash
npm run validate:env
```

PASS when it fails because PGlite is not allowed in production.

### C3. Reject production demo authentication

Set:

```dotenv
HSE_APP_ENV=production
HSE_DATABASE_DRIVER=postgres
DATABASE_URL=postgresql://test:test@127.0.0.1:5432/test
HSE_RELEASE_SHA=owner-production-test
HSE_ENABLE_WORKER_DEMO_AUTH=true
```

Run:

```bash
npm run validate:env
```

PASS when it fails because demonstration authentication cannot be enabled in production. No database connection should be attempted by this validation command.

Restore the development test values from Part A.

---

## Part D — Database migration tests

### D1. Start with a clean owner-test database

Stop the development server if running, then delete only:

```text
.data/postgres-owner-test
```

Do not delete unrelated directories.

### D2. Apply migration

```bash
npm run db:migrate
```

Expected:

```text
Applied migrations: 0001_platform_foundation
```

### D3. Check schema status

```bash
npm run db:status
```

Expected:

```text
0001_platform_foundation: applied
```

### D4. Prove migration idempotency

Run again:

```bash
npm run db:migrate
```

Expected:

```text
Database schema is current.
```

No duplicate table or duplicate migration error is allowed.

---

## Part E — Browser persistence tests

### E1. Start the application

```bash
npm run dev
```

Open:

```text
http://localhost:3000/worker/login
```

Sign in using the `.env.local` test credentials.

### E2. Save all Worker Profile sections

1. Open **My profile**.
2. Enter test personal details.
3. Select **Save and continue**.
4. Enter contact details.
5. Select **Save and continue**.
6. Enter professional details.
7. Save the final section.
8. Submit the profile if completion reaches 100%.

PASS when saves complete without white screens, manual refresh requirements or terminal database errors.

### E3. Refresh persistence

Refresh the browser on each profile section.

PASS when all committed values remain present.

### E4. Server restart persistence

1. Stop `npm run dev`.
2. Start it again.
3. Sign in again.
4. Open **My profile**.

PASS when committed profile data remains present after the Node process restart.

### E5. Dashboard synchronization

Open the Worker Dashboard.

PASS when:

- display name comes from the committed profile;
- completion matches the committed profile;
- navigation works without manual refresh.

### E6. Stale-form conflict

1. Open the same profile section in two browser tabs.
2. Change and save Tab A.
3. Change and save Tab B without refreshing it.

PASS when Tab B receives a conflict/reload response and does not overwrite Tab A.

---

## Part F — Legacy profile import

Perform this part only when `.data/worker-profiles` contains test JSON created by the earlier accepted Worker Profile build.

### F1. Use a fresh import database

Set:

```dotenv
HSE_PGLITE_DATA_DIR=.data/postgres-import-test
```

Delete that directory if it already exists, then run:

```bash
npm run db:migrate
npm run db:import-profiles
```

PASS when the command reports imported and skipped counts without exposing profile contents in terminal output.

### F2. Prove safe repeat behavior

Run again:

```bash
npm run db:import-profiles
```

PASS when existing database records are skipped rather than silently overwritten.

Return `HSE_PGLITE_DATA_DIR` to `.data/postgres-owner-test`.

---

## Part G — Preview artifact and release evidence

### G1. Build deployable standalone preview

After `npm run check` has built the app, run:

```bash
npm run preview:smoke
```

PASS when:

- `.preview-bundle` is created;
- the standalone server starts;
- `/` returns success;
- `/worker/login` returns success;
- the script stops the test server automatically.

### G2. Generate release manifest

Windows PowerShell:

```powershell
$env:HSE_RELEASE_SHA="owner-local-release"
$env:HSE_RELEASE_ENV="preview"
npm run release:manifest
```

Command Prompt:

```cmd
set HSE_RELEASE_SHA=owner-local-release
set HSE_RELEASE_ENV=preview
npm run release:manifest
```

Open `release-manifest.json`.

PASS when it contains:

- `schemaVersion`;
- `releaseSha`;
- `applicationEnvironment`;
- `nodeVersion`;
- `packageLockSha256`;
- `migrationSetSha256`;
- `createdAt`.

Run `git status --short`. The preview bundle and release manifest must not appear as tracked changes.

---

## Part H — Guarded rollback test

Use only the owner-test PGlite database.

### H1. Prove rollback is blocked without acknowledgement

```bash
npm run db:rollback
```

PASS when it refuses and asks for `HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=true`.

### H2. Perform acknowledged local rollback

PowerShell:

```powershell
$env:HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK="true"
npm run db:rollback
```

Command Prompt:

```cmd
set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=true
npm run db:rollback
```

Expected:

```text
Rolled back migration: 0001_platform_foundation
```

### H3. Confirm pending state

```bash
npm run db:status
```

Expected: migration is pending and command returns a non-zero status.

### H4. Reapply

```bash
npm run db:migrate
npm run db:status
```

PASS when the migration applies again and status returns to applied.

Do not perform destructive rollback on a database containing data that must be retained.

---

## Part I — GitHub Actions evidence

### I1. Preview artifact

Open the merged M1.01 GitHub Actions run named **Platform foundation checks**.

PASS when:

- the workflow succeeds;
- the artifact is named `hseverify-preview-<commit-sha>`;
- it contains `.preview-bundle`, `release-manifest.json` and migration files.

### I2. Rollback candidate workflow

Open **Actions → Build rollback candidate → Run workflow**.

Use the accepted M1.01 commit SHA as `target_ref`.

PASS when:

- the exact SHA is checked out;
- validation passes;
- standalone smoke test passes;
- artifact `hseverify-rollback-<resolved-sha>` is produced.

This test builds a candidate only. Do not direct production traffic anywhere because a live hosting provider is not part of this brick.

---

## Part J — Final result

Report using this format:

```text
M1.01 OWNER HARD TEST
Commit tested:
Operating system:
Node version:
Browser:

B Automated gate: PASS/FAIL
C Environment rejection: PASS/FAIL
D Migrations: PASS/FAIL
E Browser persistence: PASS/FAIL
F Legacy import: PASS/FAIL/NOT APPLICABLE
G Preview and manifest: PASS/FAIL
H Rollback/reapply: PASS/FAIL
I GitHub artifacts: PASS/FAIL

Defects found:
1.
2.

Overall: PASS/FAIL
```

Every failure must be added to the Later bookmark as `LATER-OWNER-###` before M1.02 begins.
