# M1.02 Normal Development Configuration — Windows Owner Retest

## Defect under test

`LATER-OWNER-006` was found on Windows with Node.js `v22.23.1` during the M1.02 full rewrite retest.

After the ordinary development server was started with `npm run dev`, the Worker routes were opened and the server was stopped, this command:

```cmd
git diff -- tsconfig.json package.json package-lock.json next.config.ts
```

showed that Next.js had reformatted the tracked root `tsconfig.json` and changed:

```text
"jsx": "preserve"
```

to:

```text
"jsx": "react-jsx"
```

The cause was that `npm run dev` still invoked raw `next dev`, outside the generated configuration boundary used by typecheck, runtime smoke and production build.

## Required environment

- Windows
- Node.js `v22.23.1`
- normal non-Administrator Command Prompt
- Developer Mode not required
- existing `.env.local` and `.data` must remain untouched

## A — Restore only the failed tracked file and pull the repair

Stop every HSE Verify Node process, then run:

```cmd
git checkout main
git restore --source=HEAD -- tsconfig.json
git status --short
git pull --ff-only origin main
git log -4 --oneline
```

PASS when the pull succeeds and `git status --short` prints nothing.

Do not delete `.env.local`, `.data` or the existing Worker database.

## B — Verify the development command is protected

```cmd
node -p "require('./package.json').scripts.dev"
git check-ignore .next-development
git check-ignore .hse-next
```

Required output includes:

```text
node scripts/run-development.mjs
.next-development
.hse-next
```

The development command must not be `next dev`.

## C — Automated normal-development smoke

```cmd
npm ci
npm run test:development
```

Required output:

```text
Normal development mode smoke passed with HTTP 200, isolated output, clean shutdown and unchanged source configuration.
```

Then run:

```cmd
git status --short
git diff -- tsconfig.json package.json package-lock.json next.config.ts
if exist .next-development (echo FAIL .next-development) else (echo PASS .next-development)
if exist .hse-next\development (echo FAIL dev config) else (echo PASS dev config)
```

PASS when both Git commands print nothing and both workspace checks print PASS.

## D — Manual ordinary development path

```cmd
npm run dev
```

Open and use:

- `http://localhost:3000/worker/login`
- Worker Dashboard
- Worker Profile

Confirm the pages load, then stop the server with `Ctrl+C`.

Required shutdown line:

```text
Development server stopped with isolated output and unchanged source configuration.
```

Immediately run:

```cmd
git status --short
git diff -- tsconfig.json package.json package-lock.json next.config.ts
if exist .next-development (echo FAIL .next-development) else (echo PASS .next-development)
if exist .hse-next\development (echo FAIL dev config) else (echo PASS dev config)
```

PASS when:

- `git status --short` prints nothing;
- the protected-file diff prints nothing;
- `tsconfig.json` still contains `"jsx": "preserve"`;
- `.next-development` is removed;
- `.hse-next\development` is removed;
- no Node process remains after Ctrl+C;
- no Administrator terminal or Developer Mode was needed.

## E — Complete gate after normal development

```cmd
npm run check
```

The gate must include and pass:

```text
Normal development mode smoke passed with HTTP 200, isolated output, clean shutdown and unchanged source configuration.
Application PGlite runtime smoke passed with isolated Next output and unchanged source configuration.
Deterministic Next production build passed without source configuration changes.
```

After it finishes:

```cmd
git status --short
git diff -- tsconfig.json package.json package-lock.json next.config.ts
```

Both commands must print nothing.

## F — Resume final M1.02 acceptance

After this focused retest passes, continue the unfinished portable preview and browser/accessibility sections in:

- `docs/testing/M1_02_FULL_REWRITE_RETEST.md`
- `docs/testing/M1_02_DESIGN_SYSTEM_HARD_TEST.md`

## Owner result format

```text
M1.02 DEVELOPMENT CONFIG OWNER RETEST

Commit tested:
Operating system: Windows
Node version: v22.23.1
Terminal: Normal Command Prompt
Developer Mode: OFF/ON

A Restore and pull: PASS/FAIL
B Protected development command: PASS/FAIL
C Automated development smoke: PASS/FAIL
D Manual npm run dev and Ctrl+C: PASS/FAIL
E Full npm run check: PASS/FAIL
F Git status and protected diff remain empty: PASS/FAIL
G No orphan process: PASS/FAIL
H No Administrator or Developer Mode requirement: PASS/FAIL

Defects found:
1.
2.

Overall: PASS/FAIL
```

M1.03 remains blocked until this retest and every remaining M1.02 acceptance section pass.
