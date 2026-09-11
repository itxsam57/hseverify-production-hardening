# M1.03 Authentication and Portal Isolation — Security Foundation

## Status

**M1.03 is IN PROGRESS.**

This document covers the first internal M1.03 subunit. It establishes the durable authentication security model before registration and role-specific portal screens are connected. It does not claim the complete M1.03 brick.

M1.04 remains blocked.

## Why this subunit comes first

The accepted application previously used an environment-gated Worker demonstration login, an HMAC-signed Worker-only cookie and an in-process attempt counter. Adding OTP and more roles directly to that adapter would create unsafe partial state and repeated debugging.

The new foundation therefore defines persistent account, verification, session, invitation, MFA and security-event state first. Every later M1.03 screen and server action must use this boundary.

## Database state

Migration `0002_authentication_foundation` adds:

- `auth_accounts` — normalized contact identifiers, lifecycle state, password hash, lockout state and provisional Worker registration reference;
- `auth_account_roles` — explicit account-to-role assignments;
- `auth_otp_challenges` — purpose/channel-bound, expiring, attempt-limited and one-time challenges;
- `auth_sessions` — opaque token hashes, one active portal role, device/request fingerprints, expiry and revocation;
- `auth_staff_invitations` — expiring, one-time role provisioning tokens;
- `auth_mfa_factors` — encrypted TOTP secret state and replay counter;
- `auth_security_events` — append-only authentication-specific events.

This authentication event table is limited to M1.03 security events. It does not replace the complete immutable platform audit/outbox engine required by M1.05.

## Canonical role registry

The authentication domain recognizes exactly:

- `worker`;
- `company`;
- `assessor`;
- `verifier`;
- `admin`;
- `root`.

`verifier` is the protected portal role for the verifier/reviewer workflow. There is no separate session role switch. Every session has exactly one active role and each role has a separate login and dashboard route contract.

All non-Worker roles require MFA.

## Cryptographic contracts

- Passwords use scrypt with a random salt and server-side pepper.
- OTP codes are six digits and are never stored in plaintext.
- OTP hashes bind the code to challenge ID and destination hash.
- Opaque session and invitation tokens use context-separated HMAC hashes.
- TOTP factors use 30-second counters and reject replayed counters.
- TOTP secrets use AES-256-GCM authenticated encryption with a purpose-derived key.
- Comparisons of hashes and codes use constant-time equality when lengths match.

## Transaction boundary

The shared application database interface now exposes `transaction()` for both adapters:

- PGlite uses its native transaction callback;
- PostgreSQL uses `postgres` transaction-scoped SQL.

Authentication registration, challenge consumption, session changes and security-event writes can therefore be committed or rolled back as one unit.

## Permanent tests

`npm run check` now includes:

- `npm run test:auth` — compiles and executes authentication-domain tests;
- `npm run test:auth-platform` — applies the real migrations to PGlite and tests tables, constraints, OTP replay prevention, transaction rollback and M1.03-only rollback.

The platform route manifest also verifies the required authentication files, tables, roles, cryptographic boundaries, parameterized repository markers and transaction adapters.

## Review defect prevented

The first repository draft accidentally reused the password timestamp placeholder for account `created_at` and `updated_at`. The query was corrected before CI to use:

```sql
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
```

A permanent test now checks the distinct binding contract.

## Still required before M1.03 can be DONE

1. Worker registration and activation screens.
2. Sandbox email OTP delivery and verification.
3. Sandbox phone OTP delivery and verification.
4. Resend timing, attempt exhaustion and replay owner testing.
5. Password sign-in, recovery and reset workflows.
6. Database-backed opaque session cookies and device/session revocation UI.
7. Staff invitation acceptance.
8. TOTP enrollment and mandatory privileged login MFA.
9. Separate login pages and protected layouts for every role.
10. Navigation, copied-URL, direct-endpoint and stale-session denial tests.
11. Authentication security-event inspection.
12. Complete Windows owner hard test and clean rollback proof.

No later subunit may bypass or duplicate this foundation.
