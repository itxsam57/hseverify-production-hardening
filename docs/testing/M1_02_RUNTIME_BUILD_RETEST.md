# M1.02 Windows Runtime-Smoke and Production-Build — Owner Retest

## Gate status

This focused retest addresses `LATER-OWNER-004` and then resumes the still-open `LATER-OWNER-003` preview retest.

The owner ran `npm run check` on Windows with Node.js `v22.23.1`. Every stage passed through `test:runtime-db`, including the portable preview-copy regression. The final production build then failed while type-checking a malformed generated file:

```text
.next/dev/types/validator.ts
Type error: Cannot find name 'er'.
er = {} as typeof import(...)
```

The standalone `typecheck` stage had already passed, which proves the invalid development file was created afterward by the protected runtime smoke when it launched `next dev` in the same `.next` directory later consumed by `next build`.

M1.02 remains **IMPLEMENTED — OWNER RETEST REQUIRED** until this document, the Windows preview retest and the remaining browser checks pass.

## Part A — Pull the merged repair

Use a normal Windows Command Prompt. Stop every running HSE Verify development, runtime-smoke or preview process.

```cmd
git checkout main
git pull origin main
git log -5 --oneline
npm ci
git status --short
```

PASS when:

- the PR #10 runtime/build isolation repair is present;
- `npm ci` succeeds;
- `package-lock.json` and `tsconfig.json` remain unchanged;
- no Administrator terminal is required.

## Part B — Prove stale malformed development types are recoverable

Create a harmless fixture matching the owner failure:

```cmd
mkdir .next\dev\types 2>nul
echo er = {} as typeof import("broken")>.next\dev\types\validator.ts
```

Confirm it exists:

```cmd
type .next\dev\types\validator.ts
```

Run:

```cmd
npm run typecheck
```

PASS when:

- the command first reports removal of `.next\dev` and `.next-runtime-smoke`;
- TypeScript succeeds;
- `.next\dev\types\validator.ts` no longer exists;
- production `.next\types` output is not deleted by the cleanup boundary.

Check the failed file is gone:

```cmd
if exist .next\dev\types\validator.ts (echo FAIL) else (echo PASS)
```

Expected:

```text
PASS
```

## Part C — Run the output-boundary regression directly

```cmd
npm run test:build-boundary
```

PASS when it reports:

```text
stale development types are removed without deleting production output
```

with one passing test and zero failures.

## Part D — Repeat the exact complete gate

```cmd
npm run check
```

PASS only when every stage succeeds, including:

1. environment and route checks;
2. design-system and Profile UX checks;
3. secure dependency floors and production audit;
4. Profile and platform tests;
5. portable preview-copy regression;
6. generated-output boundary regression;
7. typecheck and ESLint;
8. protected PGlite runtime smoke using isolated `.next-runtime-smoke`;
9. production build after the runtime smoke.

The expected runtime line is:

```text
Application PGlite runtime smoke test passed with an existing filesystem database and isolated Next development output.
```

The production build must finish successfully and must not report an error from `.next/dev/types/validator.ts`.

## Part E — Verify isolated smoke cleanup

After `npm run check`, run:

```cmd
if exist .next-runtime-smoke (echo FAIL) else (echo PASS)
```

Expected:

```text
PASS
```

Also run:

```cmd
git status --short
```

PASS when:

- `.next-runtime-smoke` is absent;
- no malformed generated validator remains;
- `tsconfig.json` is not automatically modified;
- tracked source and lock files remain clean.

## Part F — Resume the Windows portable preview retest

Remove any previous preview bundle:

```cmd
rmdir /s /q .preview-bundle
```

Then run:

```cmd
npm run preview:smoke
```

PASS when output confirms:

```text
Portable preview bundle created with PGlite at ...
Preview smoke test passed: / 200, /worker/login 200.
Preview smoke server stopped.
```

There must be no `EPERM`, symbolic-link privilege failure, `EADDRINUSE`, missing PGlite error or timeout.

## Part G — Clean preview rebuild and port reuse

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
- no orphaned preview Node process remains.

## Part H — Remaining browser acceptance

After the command-line retest passes, complete any untested sections in:

- `docs/testing/M1_02_DESIGN_SYSTEM_HARD_TEST.md`

This includes desktop continuity, keyboard-only operation, sign-out dialog, mobile navigation, forms, table behavior, 200% zoom, reduced motion, high contrast/forced colours, persistence and console cleanliness.

## Immediate failure conditions

```text
Cannot find name 'er'
.next/dev/types/validator.ts
EPERM: operation not permitted, symlink
EADDRINUSE
HSE_NEXT_DIST_DIR validation error
.next-runtime-smoke remains after the test
ProfileStorageConfigurationError
Hydration failed
```

## Owner result format

```text
M1.02 WINDOWS RUNTIME/BUILD/PREVIEW OWNER RETEST

Commit tested:
Operating system: Windows
Node version: v22.23.1
Terminal: Normal Command Prompt
Developer Mode: OFF/ON

A Pull/install and clean git state: PASS/FAIL
B Malformed dev-type recovery: PASS/FAIL
C npm run test:build-boundary: PASS/FAIL
D Full npm run check: PASS/FAIL
E Runtime smoke isolated and cleaned: PASS/FAIL
F Production build after runtime smoke: PASS/FAIL
G First npm run preview:smoke: PASS/FAIL
H Preview clean rebuild/repeatability: PASS/FAIL
I Preview server shutdown/port reuse: PASS/FAIL
J Remaining M1.02 browser sections: PASS/FAIL/NOT YET COMPLETED
K No Administrator/Developer Mode requirement: PASS/FAIL
L No console/terminal regression: PASS/FAIL

Defects found:
1.
2.

Overall: PASS/FAIL
```

M1.03 must not begin until **Overall: PASS** is recorded, `LATER-OWNER-003` and `LATER-OWNER-004` move to resolved history, and M1.02 is marked DONE.
