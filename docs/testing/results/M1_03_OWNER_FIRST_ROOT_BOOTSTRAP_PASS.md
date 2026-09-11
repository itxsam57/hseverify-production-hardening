# M1.03 Owner Acceptance — First-Root Bootstrap and TOTP

Status: OWNER PASS

Accepted: 4 August 2026

Repository: `itxsam57/hseverify`

Branch tested: `main`

Application repair baseline present: `403056b85f52b7e2c656b0585b6ced50fdad140a`

Environment:

- Windows 10
- Google Chrome
- local development server
- PGlite owner-test database
- authentication sandbox enabled

## Owner-confirmed evidence

The owner confirmed that every step in M1.03 Section G passed:

- the development-only First-Root bootstrap route opened;
- the exact local sandbox access key was accepted;
- a one-time Root invitation path was created;
- the invitation path opened successfully;
- the Root profile and strong password were accepted;
- TOTP setup information was displayed;
- a current six-digit authenticator code completed enrollment;
- enrollment redirected to the Root login;
- Root email, password and a fresh TOTP code authenticated successfully;
- the Root Dashboard opened.

## Security behavior accepted by this result

- Root creation used the protected bootstrap path rather than public self-registration;
- password setup alone did not complete Root activation;
- TOTP enrollment was required before Root login;
- the Root used the fixed Root login and dashboard routes;
- the bootstrap flow operated only as the First-Root development/test mechanism.

## Acceptance boundary

This result accepts only M1.03 Section G: First-Root bootstrap, TOTP enrollment and initial Root login.

It does not accept invitation-only enrollment for Company, Assessor, Verifier or Administrator, cross-role URL isolation, stale-action denial, migration rollback/reapply, responsive/accessibility checks, or the final clean repository state.

M1.03 remains in owner hard testing. M1.04 remains blocked until every M1.03 section passes.
