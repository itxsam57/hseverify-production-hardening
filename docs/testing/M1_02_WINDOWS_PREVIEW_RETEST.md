# M1.02 Windows Preview Smoke — Owner Retest

## Gate status

This focused retest addresses `LATER-OWNER-003`.

The original M1.02 owner test passed:

- `npm ci`;
- design-system validation;
- the complete `npm run check` chain;
- dependency security and production audit;
- Profile and platform tests;
- TypeScript and ESLint;
- protected PGlite runtime smoke;
- production build.

It failed only at `npm run preview:smoke` on Windows because the old preview-copy operation attempted to recreate a traced PGlite symbolic link and Windows returned `EPERM` before the standalone server started.

M1.02 remains **IMPLEMENTED — OWNER RETEST REQUIRED** until this document reports Overall PASS.

## Part A — Pull the merged repair

Use a normal, non-Administrator Command Prompt. Windows Developer Mode must not be required.

Stop every running HSE Verify development or preview process, then run:

```cmd
git checkout main
git pull origin main
git log -1 --oneline
npm ci
git status --short
```

PASS when:

- the PR #9 repair merge is present;
- `npm ci` succeeds;
- `package-lock.json` is unchanged;
- no Administrator terminal or Developer Mode is needed.

## Part B — Run the portable-copy regression

```cmd
npm run test:preview-copy
```

PASS when the test reports that preview bundle creation materializes the traced package rather than preserving a destination symbolic link.

The test also verifies that stale/incomplete bundle files are removed before repeated builds.

## Part C — Run the complete application gate

Use the existing `.env.local` and preserved PGlite test database.

```cmd
npm run check
```

PASS only when every stage succeeds, including the new `test:preview-copy` stage and all existing design-system, dependency, Profile, database, type, lint, runtime and production-build checks.

## Part D — Reproduce the original Windows path

From the repository root, remove any previous preview bundle:

```cmd
rmdir /s /q .preview-bundle
```

If the directory does not exist, Windows may print that it cannot find the file. That is acceptable.

Run:

```cmd
npm run preview:smoke
```

PASS when the output confirms all of the following:

1. A portable preview bundle was created.
2. The traced `@electric-sql/pglite` package was found inside the bundle.
3. The standalone server started.
4. `/` returned a successful status.
5. `/worker/login` returned a successful status.
6. The preview smoke server stopped.

Immediate failure conditions:

```text
EPERM: operation not permitted, symlink
A required privilege is not held by the client
Preview bundle contains symbolic links
Preview bundle does not contain the traced @electric-sql/pglite package
Timed out waiting for /
Timed out waiting for /worker/login
```

## Part E — Verify the generated bundle

After the command passes, confirm this directory exists:

```text
.preview-bundle
```

Confirm it contains at least:

```text
.preview-bundle\server.js
.preview-bundle\.next\static
```

The PGlite package may be under a traced/hash-qualified directory inside `.preview-bundle\.next\node_modules\@electric-sql` or another standalone node_modules location. Do not rename or flatten traced package directories manually.

Do not create Windows symbolic links, enable Developer Mode, or run `mklink` to make the test pass.

## Part F — Confirm cleanup and repeatability

Create a harmless stale marker:

```cmd
echo stale>.preview-bundle\owner-stale-marker.txt
```

Run again:

```cmd
npm run preview:smoke
```

PASS when:

- the command passes again;
- `.preview-bundle\owner-stale-marker.txt` no longer exists;
- the bundle is rebuilt from a clean state;
- `/` and `/worker/login` still succeed;
- the temporary server stops again.

## Part G — Confirm the temporary server is gone

Immediately run the smoke test a third time:

```cmd
npm run preview:smoke
```

PASS when it starts normally instead of failing because port `3107` is still occupied.

Also confirm Task Manager does not show an orphaned Node process attributable to the preview test after the command exits.

## Part H — Regression review

Confirm the command and terminal contain none of the following:

```text
EPERM
operation not permitted, symlink
EADDRINUSE
Preview bundle contains symbolic links
PGlite package is missing
uncaught exception
```

The existing Worker data directory must not be reset or changed by this test because the standalone preview runs with `HSE_PGLITE_DATA_DIR=memory://`.

## Owner result format

```text
M1.02 WINDOWS PREVIEW OWNER RETEST

Commit tested:
Operating system: Windows
Node version: v22.23.1
Terminal: Normal Command Prompt
Developer Mode: OFF/ON

A Pull/install: PASS/FAIL
B npm run test:preview-copy: PASS/FAIL
C npm run check: PASS/FAIL
D First npm run preview:smoke: PASS/FAIL
E Bundle and PGlite present: PASS/FAIL
F Clean rebuild/repeatability: PASS/FAIL
G Temporary server shutdown/port reuse: PASS/FAIL
H No EPERM/symlink regression: PASS/FAIL
I No Administrator requirement: PASS/FAIL
J No Developer Mode requirement: PASS/FAIL

Defects found:
1.
2.

Overall: PASS/FAIL
```

M1.03 must not begin until **Overall: PASS** is recorded, `LATER-OWNER-003` moves to resolved history, and M1.02 is marked DONE in the Milestone Path.
