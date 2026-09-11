# M1.03 Authentication Security Foundation — Merged Implementation Record

## Status

- **Brick:** M1.03 — Authentication and Portal Isolation
- **Internal subunit:** Authentication security foundation
- **Implementation status:** MERGED — OWNER TEST REQUIRED
- **Pull request:** #15
- **Squash merge:** `1472ea94118507320cef5c33412cc260e55c3916`
- **Merged:** 2 August 2026

This record does not mark the complete M1.03 brick DONE. Worker registration, OTP delivery, sign-in/recovery, database-backed session cookies, staff MFA and live role portal guards remain required after this subunit passes owner testing.

## Accepted implementation boundary for owner testing

The merged foundation provides:

- migration `0002_authentication_foundation`;
- persistent accounts and explicit account-role assignments;
- verified account-state and lock-state database invariants;
- expiring, attempt-limited and replay-safe OTP challenge state;
- opaque, revocable sessions bound to an assigned account role;
- active-account-only session creation and lookup;
- staff invitation state;
- encrypted TOTP factor state and replay counter;
- authentication-specific append-only security events;
- six canonical roles: Worker, Company, assessor, verifier, administrator and root/super-admin;
- separate login/home route contracts and no in-session role switching;
- mandatory MFA classification for every non-Worker role;
- scrypt password hashing with random salts and a server-side pepper;
- challenge/destination-bound OTP hashing;
- context-separated opaque token hashing;
- TOTP generation/verification with replay protection;
- AES-256-GCM authenticated encryption for MFA secrets;
- native PGlite and PostgreSQL transaction support;
- transactional repository operations for verification, sessions, lockout and security events;
- reversible rollback that removes M1.03 authentication state while preserving the accepted M1.01 platform schema.

## Exact trusted workflow evidence

Final source head:

```text
c5da21ab03dfab85bb4584c75b5505a5cf0a88a1
```

Pull-request merge-test head:

```text
ba4ad639b9fe2818a6c04ad095140b5970170a06
```

Workflow run `30751963296`, job `91507459108`, completed successfully:

- Node.js `24.18.0`, npm `11.16.0`;
- 349 locked packages installed;
- production audit reported `found 0 vulnerabilities`;
- five Worker Profile tests passed;
- seven authentication-domain tests passed;
- five platform-foundation tests passed;
- six authentication-platform tests passed;
- five Profile overflow regressions passed;
- portable preview-copy regression passed;
- four protected Next-system regressions passed;
- isolated route type generation and strict TypeScript passed;
- ESLint passed;
- ordinary development HTTP smoke, isolated output, clean shutdown and unchanged source configuration passed;
- protected existing-database PGlite runtime smoke passed;
- deterministic Next.js `16.2.12` production build passed;
- portable preview `/` and `/worker/login` returned HTTP 200;
- preview server stopped;
- release manifest and artifact upload completed.

Artifact:

- ID: `8834735751`
- files: `1,632`
- size: `20,141,964` bytes
- SHA-256: `8bfa6bfb20d4e4d2ff0a4ae2a73e8c1211486ea51a43b6b707c39f5ec6fbb2ad`

## Review defects prevented before merge

1. Corrected account insert timestamp parameter separation.
2. Replaced an invalid PostgreSQL transaction type extraction that collapsed to `never`.
3. Prevented sessions from claiming roles not assigned to their account.
4. Prevented pending accounts from entering locked/active state without contact verification.
5. Prevented locked or disabled accounts from resolving active sessions.
6. Prevented session creation for non-active accounts.
7. Ensured successful authentication can clear partial failed-attempt counters for active accounts without reopening pending accounts.
8. Made authenticated-encryption tamper testing mutate actual ciphertext bytes rather than optional Base64 padding bits.

Every item above has a permanent automated or schema-level protection.

## Current gate

Follow:

- `docs/testing/M1_03_AUTHENTICATION_FOUNDATION_HARD_TEST.md`

The owner must pass the focused authentication-domain and authentication-platform tests, the complete `npm run check`, disposable Windows migration/rollback, existing database preservation and clean repository checks.

A failure creates `LATER-OWNER-009` and blocks the next M1.03 subunit.

## Next subunit after owner PASS only

Worker registration and mandatory email/phone OTP sandbox flow.

M1.04 remains blocked.
