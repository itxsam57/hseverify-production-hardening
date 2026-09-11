# M1.04 Subunit 5 — Final Owner Closure

## Purpose

Perform only the visible judgement that cannot be replaced by the final automated isolation, migration, runtime, build and preview suites. Do not repeat the accepted Company CRUD workflow or manually reproduce database races.

## Preconditions

- Normal Windows Command Prompt.
- Repository: `C:\Users\arsla\hseverify`.
- Exact merged `main` commit supplied after CI.
- Existing local Company account with valid TOTP.
- Existing local Worker account.
- No Administrator or Developer Mode requirement.

## A — Local setup and migration status

Run:

```cmd
cd /d C:\Users\arsla\hseverify && git checkout main && git pull --ff-only origin main && npm run setup:local && npm run db:status && npm run dev
```

Expected:

- setup succeeds;
- migrations `0001` through `0006` are applied with matching checksums;
- the normal development server starts.

## B — Representative signed-out pre-render boundary

1. Fully sign out.
2. Paste `http://localhost:3000/worker/profile`.
3. Confirm the browser opens `/worker/login?reason=session-required`.
4. Confirm no Worker Profile content, global **Not available** page, or temporary protected HTML appears.

This is the one visible representative check for the eleven-route signed-out matrix. The complete route set is tested automatically.

## C — Representative fixed-role cross-portal boundary

1. Sign in to the Company portal and complete TOTP.
2. Confirm the Company dashboard opens.
3. Paste `http://localhost:3000/worker/profile`.
4. Confirm Worker Profile content never appears and **Access Denied** is shown.
5. Use **Return to active portal** and confirm the Company dashboard/session still works.
6. Sign out.

This is the one visible representative check for the thirty cross-role combinations. The complete role matrix is tested automatically.

## D — Clean closure

1. Stop the server with `Ctrl+C` and confirm Command Prompt returns normally.
2. Run:

```cmd
git pull --ff-only origin main
git status --short
git diff --check
git diff -- tsconfig.json package.json package-lock.json next.config.ts
git status -sb
git rev-parse HEAD
```

Expected:

- pull succeeds;
- the three middle diff/status checks print no unexpected output;
- `git status -sb` is `## main...origin/main`;
- `git rev-parse HEAD` equals the supplied final control commit.

## Owner result

Report only the first failure, or:

```text
M1.04 FINAL OWNER CLOSURE: PASS
A Local setup/migrations/startup: PASS
B Signed-out Worker Profile redirect: PASS
C Company-to-Worker direct URL denial and session preservation: PASS
D Clean shutdown and synchronized Git state: PASS
```

M1.04 must remain IN PROGRESS and M1.05 must remain blocked until this closure and the final acceptance record pass.
