# M1.03 Owner Test Result — Worker Lockout and Password Recovery

Status: PASS

Owner acceptance date: 4 August 2026

Repository: `itxsam57/hseverify`

Tested application repair commit: `403056b85f52b7e2c656b0585b6ced50fdad140a`

Environment:

- Windows 10
- Google Chrome
- Normal Command Prompt
- local PGlite database
- development authentication sandbox enabled

## Owner-confirmed evidence

The owner confirmed all of the following in the browser:

1. Five incorrect Worker password attempts persisted.
2. A sixth request using the correct password was rejected because the account was temporarily locked.
3. Password recovery accepted the latest email recovery code.
4. Successful password reset cleared the account lock.
5. Every Worker session that existed before the reset was revoked; the previous browser required a fresh sign-in.
6. The consumed recovery code/completed recovery flow could not be reused and instructed the owner to start again in a new session.
7. The new password signed in successfully.
8. The old password was rejected.

## Defect closure

`LATER-OWNER-011` is resolved and owner accepted. Its root cause was an untyped timestamp parameter inside the SQL lockout `CASE`, which caused PostgreSQL/PGlite error `42804` and rolled back failed-attempt increments. The merged repair added explicit `timestamptz` typing and a migrated-PGlite runtime regression.

## Instruction correction

A sandbox-access denial during the test was caused by an incorrect key supplied in the test instruction, not by the application. Local owner tests must use the exact current `HSE_AUTH_SANDBOX_ACCESS_KEY` from `.env.local`; no example value should be assumed to match an existing environment.

## Acceptance boundary

M1.03 Section F is owner PASS. This does not constitute acceptance of the complete M1.03 milestone. First-Root bootstrap, staff invitation/enrollment, portal isolation, stale-action denial, migration rollback/reapply, responsive/accessibility checks and clean shutdown remain to be owner tested. M1.04 remains blocked.
