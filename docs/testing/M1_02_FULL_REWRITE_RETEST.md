# M1.02 Full Next-System Rewrite — Windows Owner Retest

## Gate status

This is the final combined Windows command-line retest for:

- `LATER-OWNER-003` — privileged symbolic-link creation during portable preview copying;
- `LATER-OWNER-004` — protected runtime smoke contaminating the production `.next` output;
- `LATER-OWNER-005` — successful Next commands leaving tracked `next-env.d.ts` and `tsconfig.json` modified.

Pull request #11 replaces the type-generation, runtime-smoke and production-build subsystem. This is not a cleanup around one malformed file. Each automated Next command now receives an isolated output directory and a freshly generated ignored TypeScript configuration. The real package, lockfile, Next configuration and root TypeScript configuration are hashed before and after execution. A command fails if those protected files change.

M1.02 remains **IMPLEMENTED — OWNER RETEST REQUIRED** until this document and the remaining browser sections report Overall PASS.

## Part A — Recover the old checkout and pull the rewrite

Use a normal, non-Administrator Windows Command Prompt. Stop every HSE Verify Node process first.

The previous Next build may have changed the two tracked files in the old checkout. Restore only those generated/configuration changes before pulling:

```cmd
git checkout main
git restore --source=HEAD -- next-env.d.ts tsconfig.json
git status --short
git pull --ff-only origin main
git log -6 --oneline
```

PASS when:

- the rewrite merge is present;
- the pull succeeds without a stash or manual edit;
- `next-env.d.ts` is deleted from tracked source by the rewrite;
- `tsconfig.json` contains the committed Next-compatible configuration;
- `.env.local`, `.data` and the preserved Worker database are untouched.

## Part B — Locked installation and clean baseline

```cmd
npm ci
git status --short
git ls-files next-env.d.ts
git check-ignore next-env.d.ts
```

PASS when:

- installation succeeds;
- the production audit reports no vulnerabilities during installation;
- `git status --short` prints nothing;
- `git ls-files next-env.d.ts` prints nothing;
- `git check-ignore next-env.d.ts` prints `next-env.d.ts`;
- no Administrator terminal or Developer Mode is required.

## Part C — Rewritten build-system regression suite

```cmd
npm run test:next-system
```

PASS when four tests pass and zero fail:

1. generated Next files remain outside tracked source;
2. all Next commands use isolated generated configurations and outputs;
3. protected configuration mutation is detected;
4. complete cleanup removes every generated Next workspace.

## Part D — Complete generated-output recovery

Create harmless stale output in every workspace:

```cmd
mkdir .next\dev\types 2>nul
echo er = {} as typeof import("broken")>.next\dev\types\validator.ts
mkdir .next-typecheck\types 2>nul
echo stale>.next-typecheck\types\stale.txt
mkdir .next-runtime-smoke\dev\types 2>nul
echo stale>.next-runtime-smoke\dev\types\stale.txt
mkdir .hse-next\cache 2>nul
echo stale>.hse-next\cache\stale.txt
```

Run the complete cleanup command:

```cmd
npm run clean:next
```

Verify all four workspaces are gone:

```cmd
if exist .next (echo FAIL .next) else (echo PASS .next)
if exist .next-typecheck (echo FAIL .next-typecheck) else (echo PASS .next-typecheck)
if exist .next-runtime-smoke (echo FAIL .next-runtime-smoke) else (echo PASS .next-runtime-smoke)
if exist .hse-next (echo FAIL .hse-next) else (echo PASS .hse-next)
```

All four checks must print PASS.

## Part E — Isolated route type generation and strict TypeScript

```cmd
npm run typecheck
git status --short
git diff -- tsconfig.json package.json package-lock.json next.config.ts
```

PASS when:

- Next route types are generated successfully;
- strict TypeScript succeeds;
- the output states that isolated Next type generation passed;
- `git status --short` prints nothing;
- the protected-file diff prints nothing;
- `next-env.d.ts` may exist locally, but remains ignored and untracked;
- `.next-typecheck` may remain as ignored coherent route-type output;
- `.hse-next` is removed after success.

## Part F — Normal development-server path

Start the normal development server:

```cmd
npm run dev
```

Open:

- `http://localhost:3000/worker/login`
- the Worker Dashboard;
- the Worker Profile.

Confirm the routes load, then stop the server with `Ctrl+C` and run:

```cmd
git status --short
git diff -- tsconfig.json package.json package-lock.json next.config.ts
```

PASS when normal development works and both commands print nothing. This proves the ordinary developer path does not rewrite tracked source configuration.

## Part G — Complete application gate

```cmd
npm run check
```

PASS only when every stage succeeds, including:

1. environment and route validation;
2. design-system and Profile UX validation;
3. secure dependency floors and production audit;
4. five Profile tests and five platform tests;
5. portable preview-copy regression;
6. four rewritten Next-system regressions;
7. isolated `next typegen` and strict TypeScript;
8. ESLint excluding generated workspaces;
9. protected PGlite runtime smoke using `.next-runtime-smoke`;
10. Windows process-tree shutdown and temporary-output cleanup;
11. production build using `.next` only;
12. protected project configuration unchanged before and after every Next command.

Expected key lines include:

```text
Isolated Next type generation and strict TypeScript validation passed.
Application PGlite runtime smoke passed with isolated Next output and unchanged source configuration.
Deterministic Next production build passed without source configuration changes.
```

Immediate failure conditions include:

```text
Cannot find name 'er'
Next command modified protected project configuration
Failed to type check
HSE_NEXT_COMMAND_MODE must be
ProfileStorageConfigurationError
Hydration failed
```

## Part H — Post-gate repository and workspace state

```cmd
git status --short
git diff -- tsconfig.json package.json package-lock.json next.config.ts
if exist .next-typecheck (echo FAIL .next-typecheck) else (echo PASS .next-typecheck)
if exist .next-runtime-smoke (echo FAIL .next-runtime-smoke) else (echo PASS .next-runtime-smoke)
if exist .hse-next (echo FAIL .hse-next) else (echo PASS .hse-next)
if exist .next\standalone\server.js (echo PASS production bundle) else (echo FAIL production bundle)
```

PASS when:

- Git status and protected-file diff are empty;
- `.next-typecheck`, `.next-runtime-smoke` and `.hse-next` are absent;
- `.next\standalone\server.js` exists;
- the existing Worker database was not reset.

## Part I — Windows portable preview

```cmd
rmdir /s /q .preview-bundle 2>nul
npm run preview:smoke
```

PASS when output confirms:

```text
Portable preview bundle created with PGlite at ...
Preview smoke test passed: / 200, /worker/login 200.
Preview smoke server stopped.
```

There must be no:

```text
EPERM
operation not permitted, symlink
A required privilege is not held by the client
Preview bundle contains symbolic links
Preview bundle does not contain the traced @electric-sql/pglite package
EADDRINUSE
```

## Part J — Preview clean rebuild and port reuse

```cmd
echo stale>.preview-bundle\owner-stale-marker.txt
npm run preview:smoke
if exist .preview-bundle\owner-stale-marker.txt (echo FAIL) else (echo PASS)
npm run preview:smoke
```

PASS when:

- the stale marker is removed;
- both repeated preview runs pass;
- port `3107` is immediately reusable;
- the temporary server stops after each run;
- Task Manager shows no orphaned preview Node process;
- no Administrator terminal or Developer Mode was needed.

## Part K — Remaining M1.02 browser acceptance

Complete every unfinished section in:

- `docs/testing/M1_02_DESIGN_SYSTEM_HARD_TEST.md`

This includes desktop continuity, keyboard-only operation, sign-out dialog, mobile navigation, forms, table behavior, 200% zoom, reduced motion, high contrast/forced colours, persistence, restart behavior and console cleanliness.

## Owner result format

```text
M1.02 FULL REWRITE WINDOWS OWNER RETEST

Commit tested:
Operating system: Windows
Node version: v22.23.1
Terminal: Normal Command Prompt
Developer Mode: OFF/ON

A Pull rewrite and preserve local data: PASS/FAIL
B Locked install and clean baseline: PASS/FAIL
C npm run test:next-system: PASS/FAIL
D Complete generated-output recovery: PASS/FAIL
E Isolated typegen/typecheck and clean Git state: PASS/FAIL
F Normal development server and clean Git state: PASS/FAIL
G Full npm run check: PASS/FAIL
H Post-gate workspaces and production bundle: PASS/FAIL
I First npm run preview:smoke: PASS/FAIL
J Preview rebuild/shutdown/port reuse: PASS/FAIL
K Remaining M1.02 browser acceptance: PASS/FAIL/NOT YET COMPLETED
L No Administrator or Developer Mode requirement: PASS/FAIL
M No console/terminal regression: PASS/FAIL

Defects found:
1.
2.

Overall: PASS/FAIL
```

M1.03 must not begin until **Overall: PASS** is recorded, `LATER-OWNER-003`, `LATER-OWNER-004` and `LATER-OWNER-005` move to resolved history, and M1.02 is marked DONE.
