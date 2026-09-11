# M1.04 Session Authorization Context — Windows Owner Hard Test

## Acceptance rule

Run this guide only after PR #24 is merged to `main` and its complete CI, preview smoke and release evidence are green.

This accepts only M1.04 internal subunit 2: trusted session authorization-context integration and central permission checks.

It does not accept tenant-owned repository/query/command enforcement, protected Company business surfaces, complete cross-tenant endpoint testing or the whole M1.04 brick.

Stop at the first failure. Record the exact result as `LATER-OWNER-###` before repair. Do not continue to later sections after a failure.

## Environment

- Windows 10
- Normal Command Prompt
- repository: `C:\Users\arsla\hseverify`
- supported Node.js >=20.9
- Google Chrome
- no Administrator terminal
- Windows Developer Mode may remain OFF

## A. Synchronize and establish a clean baseline

Run:

```cmd
cd /d C:\Users\arsla\hseverify
git checkout main
git pull --ff-only origin main
git status --short
git rev-parse HEAD
node -v
npm ci --no-audit --no-fund
```

Expected:

- checkout remains on `main`;
- pull fast-forwards or reports already up to date;
- `git status --short` prints nothing;
- tested commit matches the merged M1.04 subunit 2 merge commit;
- Node version is supported;
- locked installation succeeds without `--force`;
- no Administrator terminal or Developer Mode requirement occurs.

## B. Confirm the accepted database layer

Keep the existing local `.env.local`. Run:

```cmd
npm run db:status
```

Expected:

```text
0001_platform_foundation: applied
0002_authentication_foundation: applied
0003_worker_registration_otp: applied
0004_authentication_completion: applied
0005_authorization_tenant_isolation: applied
```

Subunit 2 adds no migration. No account, session, Worker Profile, OTP, MFA, invitation, tenant or membership record may be removed.

## C. Focused source and domain gate

Run:

```cmd
npm run check:authorization
npm run test:authorization
```

Expected:

- accepted explicit platform and tenant permissions remain unchanged;
- no wildcard permission exists;
- Root remains separated from routine Company tenant management;
- one canonical portal-entry permission exists for each fixed role;
- unauthenticated, revoked, expired, stale and inactive-account states are denied;
- impossible session timestamp ordering and excessive future skew are denied;
- role mismatch and missing permission are classified separately;
- Company tenant permission evaluation requires trusted current membership;
- inactive tenant and membership states are denied;
- invalid permission overrides fail closed;
- live authorization TypeScript contains no emitted `.js` import dependency;
- the isolated domain compiler uses supported `Node16` module semantics.

## D. Focused migrated-database gate

Run:

```cmd
npm run test:authorization-platform
```

Expected:

- all subunit 1 tenant schema and policy-ceiling tests still pass;
- exact session-context SQL resolves Worker context from only the session token hash;
- exact Company context is derived from the authenticated account's one current membership;
- tenant lifecycle, membership role/status and permission overrides load correctly;
- revoked, expired and disabled states remain visible to the central denial resolver;
- no tenant ID, membership ID, role, permission, form value, header or search parameter can select context;
- the existing M1.03 session service delegates to one central authorization guard;
- no route-local role matrix or role-switch behavior exists.

## E. Complete application gate

Run:

```cmd
npm run check
```

Expected:

- every accepted M1.01–M1.03 regression passes;
- all authorization domain and migrated-database tests pass;
- Worker registration, recovery, TOTP, session and portal-isolation tests pass;
- strict project TypeScript passes;
- ESLint passes;
- development runtime smoke passes;
- database-backed application smoke passes;
- deterministic production build passes;
- no source configuration is rewritten.

Do not run `npm audit fix --force`. The already-recorded moderate PostCSS advisory may appear below the configured high-severity failure level.

## F. Live Worker portal authorization regression

Start the server:

```cmd
npm run dev
```

In Chrome:

1. Open `http://localhost:3000/worker/login`.
2. Sign in with the existing Worker credentials.
3. Confirm the Worker dashboard opens.
4. While the Worker session is active, manually open `http://localhost:3000/company/dashboard`.
5. Confirm the Company dashboard is never displayed and the request reaches the existing access-denied boundary.
6. Return to the Worker dashboard and confirm the Worker session remains usable.

Expected:

- valid Worker session passes the central Worker portal permission;
- copied Company URL is denied centrally;
- no role switch occurs;
- denial does not reveal Company tenant or membership information;
- denied navigation does not corrupt the valid Worker session.

## G. Live Company portal and TOTP regression

1. Log out of the Worker portal.
2. Open `http://localhost:3000/company/login`.
3. Sign in with the existing Company password.
4. Confirm valid TOTP is required.
5. Enter the valid TOTP and confirm the Company dashboard opens.
6. While the Company session is active, manually open `http://localhost:3000/worker/dashboard`.
7. Confirm the Worker dashboard is never displayed and the request reaches the access-denied boundary.
8. Return to the Company dashboard and confirm the Company session remains usable.

Expected:

- password plus TOTP still protects the Company portal;
- valid Company session passes the central Company portal permission;
- copied Worker URL is denied centrally;
- no browser field or URL selects a role or tenant;
- denial does not corrupt the valid Company session.

No Company tenant-owned business workflow is expected in this subunit.

## H. Signed-out and stale credential routing

1. Log out completely.
2. Open `http://localhost:3000/company/dashboard`.
3. Confirm redirect to `http://localhost:3000/company/login`, optionally with the accepted non-sensitive reason query.
4. Open `http://localhost:3000/worker/dashboard`.
5. Confirm redirect to `http://localhost:3000/worker/login`, optionally with the accepted non-sensitive reason query.

Expected:

- signed-out protected requests never display protected content;
- each request returns to its fixed-role login;
- no account, session, tenant or membership existence is disclosed.

Automated focused and complete gates provide the permanent revoked, expired, stale, inactive-account, inactive-tenant and inactive-membership coverage. Do not manually alter production-like authentication or tenant rows to reproduce those states.

## I. Clean shutdown

Stop the development server with:

```text
Ctrl+C
```

Expected:

- the terminal returns to `C:\Users\arsla\hseverify>`;
- no background development server remains;
- no forced process termination is required.

## J. Final clean and synchronized state

First synchronize any evidence-only commits created during owner testing:

```cmd
git pull --ff-only origin main
```

Then run:

```cmd
git status --short
git diff --check
git diff -- tsconfig.json package.json package-lock.json next.config.ts
git status -sb
```

Expected:

- `git status --short` prints nothing;
- `git diff --check` prints nothing;
- protected configuration diff prints nothing;
- final branch line is exactly `## main...origin/main`;
- no ahead, behind, modified or untracked entry remains;
- `.env.local` and `.data` remain ignored;
- no Administrator terminal or Developer Mode requirement occurred.

## Owner result template

```text
M1.04 SESSION AUTHORIZATION CONTEXT OWNER TEST

Commit tested:
Operating system: Windows 10
Node version:
Browser: Google Chrome
Terminal: Normal Command Prompt
Developer Mode: OFF/ON

A Pull/install and clean baseline: PASS
B Migration status through 0005: PASS
C Authorization source/domain gate: PASS
D Authorization migrated-database gate: PASS
E Complete npm run check: PASS
F Worker portal and copied-Company-URL denial: PASS
G Company password/TOTP and copied-Worker-URL denial: PASS
H Signed-out fixed-role redirects: PASS
I Clean shutdown: PASS
J Clean synchronized Git state: PASS
K No Administrator or Developer Mode requirement: PASS

Defects found:
None

Subunit 2 result: PASS
M1.04 brick result: STILL IN PROGRESS
```

## Gate rule

Do not begin M1.04 subunit 3 until every section passes against merged `main`, evidence is recorded, the repository is clean and synchronized, and no release-blocking owner defect remains.
