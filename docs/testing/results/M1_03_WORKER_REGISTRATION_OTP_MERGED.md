# M1.03 Worker Registration and Mandatory OTP — Merged Implementation Record

## Status

- **Brick:** M1.03 — Authentication and Portal Isolation
- **Internal subunit:** Worker registration and mandatory email/phone OTP
- **Implementation status:** MERGED — OWNER TEST REQUIRED
- **Pull request:** #16
- **Merged:** 2 August 2026

This record does not mark M1.03 DONE. Password sign-in/recovery, database-backed login sessions, staff MFA, privileged-role portals and the complete cross-role denial matrix remain required.

## Merged implementation

- real Worker registration form and server actions;
- normalized email and international phone input;
- strong scrypt password creation;
- persistent `pending_email` → `pending_phone` → `active` lifecycle;
- one Worker role only;
- opaque HTTP-only continuation cookie scoped to registration;
- database-backed refresh, Back/Forward and browser-restart recovery;
- mandatory email OTP before phone OTP;
- mandatory phone OTP before activation;
- expiring, attempt-limited, resend-controlled and replay-safe challenges;
- database-enforced single active challenge per account/purpose;
- encrypted development/test sandbox delivery with separate access-key verification;
- sandbox rejection in preview and production;
- atomic persisted registration-start rate limiting before scrypt;
- generic duplicate/conflicting-contact denial;
- pending-phone resume without credential replacement;
- explicit cancellation that deletes only an unactivated account with no sessions;
- provisional `HSE-REG-*` reference only after completion;
- no login session and no permanent Worker ID during registration;
- deterministic migration `0003_worker_registration_otp` with independent rollback.

## Trusted workflow evidence

Final production-code head:

```text
b77c82167fc5c84a012fbf6c88c19b1deda266c5
```

Workflow run `30763826243`, job `91538969591`, completed successfully:

- production audit reported zero vulnerabilities;
- existing Worker Profile, authentication and platform suites passed;
- Worker registration tests: **14 passed, 0 failed**;
- migration apply/idempotency and layered rollback passed;
- cancellation cascade and active-account protection passed;
- active-OTP concurrency protection passed;
- atomic rate-bucket increment/reset passed;
- route, recovery, cookie, sandbox and responsive-layout contracts passed;
- strict TypeScript passed;
- ESLint passed with zero warnings;
- normal development and application PGlite runtime smoke passed;
- deterministic Next.js production build passed;
- portable preview returned HTTP 200 for `/`, `/worker/login` and `/worker/register`;
- portable preview returned HTTP 404 for `/worker/register/sandbox` while disabled;
- preview shutdown, release manifest and artifact publication passed.

A later branch-head workflow containing the same production code plus `.env.example`, implementation documentation, owner guide and canonical gate updates also completed successfully before merge.

## Review defects prevented before merge

1. Rollback left the migration ledger row applied.
2. Concurrent resend paths could create multiple active OTPs.
3. Registration rate limiting used a race-prone read-then-write count.
4. The first production cookie used an invalid `__Host-` prefix with a scoped path.
5. Sandbox lookup could return expired or consumed delivery data.
6. A fresh form could replace credentials after email verification.
7. Driver-returned timestamps could be compared inconsistently.
8. Countdown initialization could create hydration drift or impure rendering.
9. Cancellation or flow loss could strand a pending account.
10. Password hashing occurred before registration-start rate limiting.
11. The provisional registration reference was present in pending projections.

Every item has a permanent schema, repository, route, source or database regression.

## Current owner gate

Follow:

```text
docs/testing/M1_03_WORKER_REGISTRATION_OTP_HARD_TEST.md
```

The owner must pass:

- local sandbox environment validation and migration 0003;
- focused 14-test registration gate;
- form and responsive validation;
- cancellation and same-contact restart;
- wrong-code attempts, cooldown and browser recovery;
- email sandbox verification;
- phone sandbox verification and activation;
- no automatic portal session;
- duplicate/conflicting-contact denial;
- complete `npm run check`;
- disposable 0003 rollback/reapply;
- existing database preservation and clean Git state.

Any failure creates the next `LATER-OWNER-###` record and blocks the password sign-in/recovery subunit.

M1.04 remains blocked.
