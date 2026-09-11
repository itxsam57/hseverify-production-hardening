# M1.04 Authorization Foundation — Windows Owner Hard Test

## Acceptance rule

Run this guide only after the feature branch is merged to `main` and CI is green.

This accepts only M1.04 internal subunit 1. It does not accept complete tenant isolation or the whole M1.04 brick.

Stop at the first failure. Record it as `LATER-OWNER-###` before repair.

## Environment

- Windows 10
- Normal Command Prompt
- Node.js 22.23.1 or supported Node >=20.9
- repository: `C:\Users\arsla\hseverify`
- no Administrator terminal
- Windows Developer Mode may remain OFF

## A. Synchronize and establish a clean baseline

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

- clean tracked state;
- supported Node version;
- install succeeds without `--force`.

## B. Apply the M1.04 migration

Keep the existing local M1.03 `.env.local`. Then run:

```cmd
npm run db:status
npm run db:migrate
npm run db:status
```

Expected final status:

```text
0001_platform_foundation: applied
0002_authentication_foundation: applied
0003_worker_registration_otp: applied
0004_authentication_completion: applied
0005_authorization_tenant_isolation: applied
```

No existing account, session, Worker Profile or authentication record may be removed.

## C. Focused source and domain gate

```cmd
npm run check:authorization
npm run test:authorization
```

Expected:

- explicit permission registries pass;
- every platform role/permission combination matches its accepted matrix;
- every tenant role/permission combination matches its accepted ceiling;
- no wildcard permission exists;
- Root does not receive routine tenant management;
- opaque tenant and membership IDs pass;
- only a Company active portal may evaluate tenant permissions;
- pending, suspended and archived tenants are denied;
- invited, suspended and revoked memberships are denied;
- membership self-grant/self-modification is denied;
- grant-above-authority is denied.

## D. Focused migrated database gate

```cmd
npm run test:authorization-platform
```

Expected:

- all four M1.04 foundation tables exist;
- the SQL role-permission ceiling exactly matches the accepted tenant matrix;
- opaque tenant and membership identifier constraints pass;
- only accounts assigned the Company portal role can hold tenant membership;
- one Company account cannot have more than one current tenant membership;
- a revoked historical membership does not block a later invitation to another tenant;
- duplicate current membership state is rejected;
- contradictory tenant/membership lifecycle state is rejected;
- unknown/wildcard and duplicate permission overrides are rejected;
- a permission override above the membership role ceiling is rejected by SQL;
- an override carrying the wrong membership role is rejected by SQL;
- `0005` rollback/reapply regression passes.

## E. Complete application gate

```cmd
npm run check
```

Expected:

- every accepted M1.01–M1.03 test still passes;
- authorization source/domain/database tests pass;
- strict TypeScript, ESLint, runtime smoke and production build pass;
- source configuration remains unchanged.

Do not run `npm audit fix --force` if npm reports only the already-recorded moderate PostCSS advisory below the configured high-severity failure level.

## F. Manual migration rollback and reapply

Stop every development server. Then run:

```cmd
npm run db:status
set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=true
npm run db:rollback
set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=
npm run db:status
npm run db:migrate
npm run db:status
```

Expected:

1. rollback removes only `0005_authorization_tenant_isolation`;
2. `0001` through `0004` remain applied;
3. no M1.03 account/session/authentication data is lost;
4. migration reapply restores `0005`;
5. the rollback acknowledgement is cleared immediately and is not added to `.env.local`.

## G. Existing authentication regression

Start the server:

```cmd
npm run dev
```

Confirm briefly:

1. Worker login page opens.
2. Existing Worker credentials still sign in.
3. Company login still requires password and TOTP.
4. A Worker session opening `/company/dashboard` is still denied.
5. A signed-out request to `/company/dashboard` still redirects to `/company/login`.

This step proves the new schema did not weaken M1.03. No Company tenant workflow is expected yet.

Stop the server with `Ctrl+C`.

## H. Final clean state

```cmd
git status --short
git diff --check
git diff -- tsconfig.json package.json package-lock.json next.config.ts
git status -sb
```

Expected:

- no tracked changes;
- no whitespace errors;
- no protected configuration changes;
- `.env.local` and `.data` remain ignored;
- no Administrator terminal or Developer Mode requirement occurred.

## Owner result template

```text
M1.04 AUTHORIZATION FOUNDATION OWNER TEST

Commit tested:
Operating system: Windows 10
Node version:
Browser: Google Chrome
Terminal: Normal Command Prompt
Developer Mode: OFF/ON

A Pull/install and clean baseline: PASS
B Migration 0005 apply/status: PASS
C Authorization source/domain gate: PASS
D Authorization database gate: PASS
E Complete npm run check: PASS
F Migration 0005 rollback/reapply: PASS
G Existing M1.03 authentication regression: PASS
H Clean shutdown and Git state: PASS
I No Administrator or Developer Mode requirement: PASS

Defects found:
None

Subunit result: PASS
M1.04 brick result: STILL IN PROGRESS
```
