# M1.03 Owner PASS — Assessor invitation-only enrollment

Date: 4 August 2026

Repository: `itxsam57/hseverify`

Branch tested: `main`

Environment: Windows 10, Google Chrome, local PGlite authentication sandbox.

## Owner-confirmed evidence

- Root created a one-time Assessor invitation for a new email address.
- The invitation path opened successfully in a separate browser context.
- Assessor profile and strong password setup completed.
- TOTP enrollment completed successfully.
- Assessor sign-in through `/assessor/login` succeeded using password and a fresh TOTP code.
- The Assessor Dashboard opened.
- Reopening the consumed invitation path failed and did not allow a second enrollment.
- The fixed-role browser-session rule remained enforced; another portal requires explicit sign-out or a separate browser context.

## Result

Assessor invitation-only enrollment, TOTP authentication, dashboard access and invitation reuse protection: **OWNER PASS**.

## Scope boundary

M1.03 remains in owner hard testing. The next staff role to test is Verifier. M1.04 remains blocked until the complete M1.03 owner hard test passes.
