# M1.03 Owner PASS — Worker portal isolation

Date: 4 August 2026

Repository: `itxsam57/hseverify`

Branch tested: `main`

Environment: Windows 10, Google Chrome, local PGlite authentication sandbox.

## Owner-confirmed evidence

- The Worker signed in through `/worker/login`.
- `/worker/dashboard` opened successfully.
- Direct access to `/company/dashboard` was denied.
- Direct access to `/assessor/dashboard` was denied.
- Direct access to `/verifier/dashboard` was denied.
- Direct access to `/admin/dashboard` was denied.
- Direct access to `/root/dashboard` was denied.
- The Worker dashboard remained available to the active Worker session.

## Result

Worker-session copied-URL and cross-portal isolation: **OWNER PASS**.

## Scope boundary

The Administrator and Worker rows of the six-role portal-isolation matrix have passed. Company, Assessor, Verifier and Root rows, plus unauthenticated role-specific redirect testing, remain. M1.04 remains blocked until the complete M1.03 owner hard test passes.
