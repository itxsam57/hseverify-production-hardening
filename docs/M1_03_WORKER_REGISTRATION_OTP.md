# M1.03 Worker Registration and Mandatory Contact Verification

## Status

- **Brick:** M1.03 — Authentication and Portal Isolation
- **Internal subunit:** Worker registration and mandatory email/phone OTP
- **Pull request:** #16
- **Implementation status:** IMPLEMENTED — OWNER TEST REQUIRED AFTER MERGE

This subunit connects the accepted M1.03 authentication foundation to a complete Worker activation flow. It does not implement password sign-in, password recovery, database-backed login sessions, staff MFA or the remaining role portals.

## User workflow

1. A Worker opens `/worker/register`.
2. The Worker enters full name, normalized email, international-format phone and a strong password.
3. The server applies the persistent registration-start rate limit before performing scrypt password hashing.
4. In one transaction, the platform creates or safely resumes a pending Worker account, assigns only the Worker role, creates/rotates one opaque continuation flow and issues one active email challenge.
5. The browser receives only an opaque HTTP-only continuation cookie scoped to `/worker/register`.
6. The Worker opens the development/test sandbox inbox using the separately configured access key and reads the latest active encrypted email delivery.
7. A correct email code is consumed once, the account moves to `pending_phone`, the flow advances, and one phone challenge is issued.
8. Refreshing, using Back, or reopening the browser resumes the same database-backed step through the opaque cookie.
9. A correct phone code is consumed once. Only then can the account become `active` and the flow become `complete`.
10. Completion displays the provisional `HSE-REG-*` registration reference. It is explicitly not the permanent public Worker ID.
11. Registration creates no login session. Secure sign-in remains the next M1.03 subunit.

## Persistent boundaries

Migration `0003_worker_registration_otp` adds:

- `auth_registration_flows` — opaque continuation hash, current step, expiry and terminal state;
- `auth_sandbox_deliveries` — encrypted delivery content linked one-to-one with its challenge;
- `auth_rate_limit_buckets` — atomic persisted registration-start counters;
- `auth_active_otp_challenge_idx` — one unconsumed, uninvalidated challenge per account and purpose.

Rollback removes only the registration subunit and its active-OTP index. It preserves migrations `0001_platform_foundation` and `0002_authentication_foundation`.

## Security properties

- Accounts remain inactive until email and phone are both verified.
- Registration never issues a login session.
- Only the Worker role is assigned.
- The provisional reference is not treated as the permanent Worker ID.
- OTP plaintext is absent from challenge rows, logs, normal page data, normal action responses and browser storage.
- Sandbox OTP content is AES-256-GCM encrypted at rest and revealed only after access-key verification.
- Sandbox delivery is restricted to development/test and rejected in preview/production.
- Only an active, unconsumed, uninvalidated, unexpired challenge can be opened in the sandbox.
- OTP challenges expire after ten minutes, have five attempts, use a resend cooldown and cannot be replayed.
- A partial unique index prevents concurrent requests from creating two active challenges for the same account and purpose.
- Registration-start limiting uses one atomic database upsert and runs before scrypt work.
- Pending-phone resume does not replace the already-created password or identity details.
- Duplicate/conflicting contact handling uses a generic denial and does not expose the other account's details.
- The continuation cookie contains no account, email, phone, role or Worker ID data.
- Production uses a `__Secure-` cookie with Secure, HttpOnly, SameSite=Lax and the registration-only path.
- Explicit cancellation deletes only an unactivated account with no sessions; dependent role, flow, challenge and sandbox rows cascade away while the security event remains with a null account reference.
- Active accounts cannot pass the registration-cancellation deletion boundary.
- Database timestamps are normalized to ISO strings across PGlite and PostgreSQL adapters.

## Environment

New variables:

```text
HSE_AUTH_PEPPER=<at least 32 characters>
HSE_ENABLE_AUTH_SANDBOX=true|false
HSE_AUTH_SANDBOX_ACCESS_KEY=<at least 16 characters>
```

Rules:

- production requires an explicit `HSE_AUTH_PEPPER`;
- development/test may fall back to `HSE_SESSION_SECRET`, but a stable separate pepper is recommended;
- sandbox activation is accepted only in development/test;
- sandbox activation requires the access key;
- preview and production reject sandbox activation.

## Automated gates

The trusted `npm run check` includes:

- three-migration deterministic apply/idempotency tests;
- 0003-only rollback and reapply;
- 0002 rollback beneath 0003 while preserving 0001;
- one active continuation flow per pending account;
- one active OTP per account/purpose;
- atomic rate-bucket increment and reset;
- no plaintext OTP persistence;
- contact-verification activation constraints;
- cancellation cascade and active-account protection;
- timestamp portability;
- route/recovery/cookie/sandbox separation contracts;
- shared-control and mobile-reflow contracts;
- strict TypeScript, ESLint, development/runtime smoke and production build;
- portable preview where registration returns HTTP 200 and sandbox returns HTTP 404 while disabled.

## Review defects prevented before merge

1. Rollback originally left the migration ledger row applied.
2. Concurrent resend paths could create multiple active OTPs.
3. Registration rate limiting originally used a race-prone read-then-write count.
4. The first production cookie used an invalid `__Host-` prefix with a scoped path.
5. A sandbox lookup could return an expired or consumed delivery.
6. A fresh form could replace credentials after email had already been verified.
7. Driver-returned `Date` values could be compared as strings incorrectly.
8. Countdown initialization could produce hydration drift or impure server rendering.
9. Cancellation could strand a pending account and block a legitimate restart.
10. Scrypt hashing occurred before registration-start rate limiting.
11. The provisional registration reference was present in pending-state projections.

Every item is now protected by schema, repository logic, source contract or automated database tests.

## Remaining M1.03 scope

After owner acceptance:

1. password sign-in, lockout, reset and recovery;
2. opaque database-backed session cookies, device list and revocation;
3. staff invitation acceptance and TOTP enrollment;
4. separate privileged-role login pages and portal layouts;
5. direct-route, copied-URL, stale-session and cross-role denial matrix;
6. final M1.03 owner acceptance.

M1.04 remains blocked.
