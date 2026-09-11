# M1.03 Owner PASS — Stale and revoked action denial

Date: 4 August 2026

Repository: `itxsam57/hseverify`

Branch tested: `main`

Environment: Windows 10, Google Chrome, local PGlite authentication sandbox.

## Owner-confirmed evidence

### Stale action after explicit sign-out

- Root signed in and opened the protected staff invitation form.
- The invitation form was left open in one tab.
- The Root session was signed out from another tab.
- Submitting the already-open invitation form redirected to the Root login page.
- No invitation was created.

### Session invalidation after password reset

This behavior was already owner-tested during the Worker lockout and password-recovery gate and reconfirmed by the owner rather than repeated:

- successful Worker password reset revoked every pre-reset Worker session;
- the previously authenticated browser required a fresh sign-in;
- the old password was rejected and the new password worked;
- therefore an already-open protected page no longer retained an authenticated database session after reset.

The permanent source evidence is commit `bd4078e92a430ece8a679caaba0ea071a4b7f476`, which records that every Worker session existing before reset was revoked and the previous browser required fresh sign-in.

## Result

Server-side session revalidation after explicit sign-out and password-reset session revocation: **OWNER PASS**.

## Scope boundary

M1.03 remains in owner hard testing. The remaining gates are migration rollback/reapply, responsive and accessibility checks, and final clean shutdown/Git state. M1.04 remains blocked until complete M1.03 owner acceptance.
