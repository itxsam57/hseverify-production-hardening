# M1.03 Authentication Foundation — Final Owner Acceptance

## Status

- **Brick:** M1.03 — Authentication and Portal Isolation
- **Internal subunit:** Authentication security foundation
- **Owner result:** PASS
- **Accepted:** 2 August 2026
- **Environment:** Windows 10, normal Command Prompt, Node.js v22.23.1
- **Implementation merge:** `1472ea94118507320cef5c33412cc260e55c3916`

This acceptance closes only the first internal subunit of M1.03. It does not mark the complete M1.03 brick DONE.

## Accepted evidence

The owner confirmed the following against merged `main`:

1. Clean baseline and locked dependency installation.
2. Authentication-domain tests: 7 passed, 0 failed.
3. Authentication-platform tests: 6 passed, 0 failed.
4. Complete `npm run check` passed.
5. Production audit reported zero vulnerabilities.
6. Strict TypeScript, ESLint, development smoke, application PGlite runtime and deterministic production build passed.
7. Disposable Windows migration/rollback/re-migration sequence completed using `.data\m1-03-auth-owner-test`.
8. The normal `.data\postgres` database remained outside the disposable test path.
9. Temporary environment variables and disposable database directory were cleared.
10. `git status --short` printed nothing.
11. Protected-file diff for `tsconfig.json`, `package.json`, `package-lock.json` and `next.config.ts` printed nothing.
12. No Administrator terminal or Windows Developer Mode was required.

## Accepted foundation boundary

The accepted foundation includes:

- migration `0002_authentication_foundation`;
- persistent authentication accounts and explicit account-role assignments;
- verified account lifecycle and lock-state constraints;
- expiring, attempt-limited and replay-safe OTP challenge state;
- opaque revocable sessions bound to an assigned role;
- active-account-only session creation and lookup;
- staff invitation and encrypted TOTP factor state;
- authentication-specific security events;
- six canonical role contracts;
- mandatory MFA classification for all non-Worker roles;
- password, OTP, opaque-token, TOTP and secret-encryption primitives;
- PGlite/PostgreSQL transactions;
- transactional repository operations;
- deterministic migration rollback preserving the platform foundation.

## Next permitted subunit

**Worker registration and mandatory email/phone OTP sandbox flow.**

The next subunit must not weaken or bypass the accepted database, cryptographic, role-assignment, transaction or rollback boundaries.

M1.03 remains IN PROGRESS and M1.04 remains blocked.
