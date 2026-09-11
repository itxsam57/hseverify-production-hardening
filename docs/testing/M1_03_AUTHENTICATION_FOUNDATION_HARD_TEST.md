# M1.03 Authentication Security Foundation — Windows Owner Hard Test

## Gate boundary

This owner test accepts only the first M1.03 internal subunit: persistent authentication schema, cryptographic domain, database transactions and repository contracts.

Passing this guide does **not** make M1.03 DONE. Registration UI, OTP delivery, recovery, database-backed cookies, staff MFA and full role portal isolation remain required.

## Environment

- Windows 10
- normal Command Prompt, not Administrator
- Node.js `v22.23.1` or the current supported Node 22 release
- existing `.env.local` and `.data/postgres` must not be changed or deleted

## A — Clean baseline

```cmd
git checkout main
git pull --ff-only origin main
npm ci
git status --short
```

PASS when installation succeeds, production audit reports no high-severity vulnerability, and `git status --short` prints nothing.

## B — Focused cryptographic and authentication tests

```cmd
npm run test:auth
npm run test:auth-platform
```

PASS when:

- all role/route registry tests pass;
- password hashing and verification pass;
- OTP binding and malformed-code rejection pass;
- opaque token context separation passes;
- TOTP acceptance and replay rejection pass;
- authenticated secret encryption/tamper rejection passes;
- both migrations apply with matching checksums;
- invalid roles and invalid account states are rejected;
- OTP consumption cannot be replayed;
- forced registration transaction rollback leaves no account or role;
- M1.03 rollback removes only authentication tables and preserves `worker_profiles`.

## C — Complete application gate

```cmd
npm run check
```

PASS only when every existing M1.01/M1.02 gate and the new authentication gates succeed, including TypeScript, ESLint, normal development smoke, PGlite runtime, production build and portable preview.

## D — Disposable Windows migration and rollback

Use a dedicated test database. Do not point these commands at `.data\postgres`.

```cmd
set HSE_PGLITE_DATA_DIR=.data\m1-03-auth-owner-test
set HSE_RELEASE_SHA=m1-03-auth-owner-test
set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=true
npm run db:migrate
npm run db:status
npm run db:rollback
npm run db:status
npm run db:migrate
npm run db:status
```

Required sequence:

1. first migration applies `0001_platform_foundation` and `0002_authentication_foundation`;
2. first status shows both applied with matching checksums;
3. rollback removes only `0002_authentication_foundation`;
4. status still shows `0001_platform_foundation` applied;
5. re-migrate applies only `0002_authentication_foundation`;
6. final status shows both applied and checksum-valid.

Clean the temporary process variables after testing:

```cmd
set HSE_PGLITE_DATA_DIR=
set HSE_RELEASE_SHA=
set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=
```

The disposable `.data\m1-03-auth-owner-test` directory may then be deleted manually. Do not delete the normal `.data\postgres` database.

## E — Repository integrity

```cmd
git status --short
git diff -- tsconfig.json package.json package-lock.json next.config.ts
```

Both commands must print nothing.

## Result

```text
M1.03 AUTHENTICATION FOUNDATION OWNER TEST

A Clean baseline: PASS/FAIL
B Authentication domain tests: PASS/FAIL
C Authentication database tests: PASS/FAIL
D Full npm run check: PASS/FAIL
E Disposable migration/rollback: PASS/FAIL
F Existing database preserved: PASS/FAIL
G Git and protected configuration clean: PASS/FAIL
H No Administrator or Developer Mode requirement: PASS/FAIL

Defects found:
1.
2.

Foundation subunit overall: PASS/FAIL
```

Any failure blocks the next M1.03 subunit and must be recorded as the next `LATER-OWNER-###` defect.
