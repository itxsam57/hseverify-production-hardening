# M1.03 Owner PASS — Verifier invitation-only enrollment

Date: 4 August 2026

Repository: `itxsam57/hseverify`

Branch tested: `main`

Environment: Windows 10, Google Chrome, local PGlite authentication sandbox.

## Owner-confirmed evidence

- Root created a one-time Verifier invitation for a new email address.
- The invitation path opened successfully in a separate browser context.
- Verifier profile and strong password setup completed.
- TOTP enrollment completed successfully.
- Verifier sign-in through `/verifier/login` succeeded using password and a fresh TOTP code.
- The Verifier Dashboard opened.
- Reopening the consumed invitation path failed and did not allow a second enrollment.
- The fixed-role browser-session rule remained enforced; another portal requires explicit sign-out or a separate browser context.

## Result

Verifier invitation-only enrollment, TOTP authentication, dashboard access and invitation reuse protection: **OWNER PASS**.

## Scope boundary

M1.03 remains in owner hard testing. The final staff role to test is Administrator. M1.04 remains blocked until the complete M1.03 owner hard test passes.
