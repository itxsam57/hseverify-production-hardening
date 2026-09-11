# M1.03 Owner PASS — Stale protected action after sign-out

Date: 4 August 2026

Repository: `itxsam57/hseverify`

Branch tested: `main`

Environment: Windows 10, Google Chrome, local PGlite authentication sandbox.

## Owner-confirmed evidence

- Root signed in and opened `/root/staff` in one browser tab.
- A new staff invitation form was prepared but intentionally left unsubmitted.
- The Root session was signed out from another tab.
- The stale, already-open staff form was then submitted without refreshing.
- The server rejected the stale action and redirected to the Root login page.
- No invitation was created and no privileged mutation completed after sign-out.

## Result

Database-backed session revalidation for a stale privileged action after sign-out: **OWNER PASS**.

## Scope boundary

This proves the sign-out half of the stale-action gate. The same denial still must be repeated after a password reset revokes the account's active sessions. Migration rollback/reapply, responsive/accessibility checks, and final clean shutdown/Git state also remain before M1.03 can be accepted.
