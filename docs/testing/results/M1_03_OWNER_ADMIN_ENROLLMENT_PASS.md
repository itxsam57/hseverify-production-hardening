# M1.03 Owner PASS — Administrator invitation-only enrollment

Date: 4 August 2026

Repository: `itxsam57/hseverify`

Branch tested: `main`

Environment: Windows 10, Google Chrome, local PGlite authentication sandbox.

## Owner-confirmed evidence

- Root created a one-time Administrator invitation for a new unused email address.
- The invitation path opened successfully in a separate browser context.
- Administrator profile and strong password setup completed.
- TOTP enrollment completed successfully.
- Administrator sign-in through `/admin/login` succeeded using password and a fresh TOTP code.
- The Administrator Dashboard opened.
- Reopening the consumed invitation path failed and did not allow a second enrollment.
- The fixed-role browser-session rule remained enforced; another portal requires explicit sign-out or a separate browser context.

## Result

Administrator invitation-only enrollment, TOTP authentication, dashboard access and invitation reuse protection: **OWNER PASS**.

## Scope boundary

All required invitation-only staff roles—Company, Assessor, Verifier and Administrator—have passed owner enrollment testing. M1.03 remains in owner hard testing. The next section is portal isolation and copied-URL denial. M1.04 remains blocked until the complete M1.03 owner hard test passes.
