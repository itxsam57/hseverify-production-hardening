# M1.03 Owner PASS — Root portal isolation

Date: 4 August 2026

Repository: `itxsam57/hseverify`

Branch tested: `main`

Environment: Windows 10, Google Chrome, local PGlite authentication sandbox.

## Owner-confirmed evidence

- The Root user signed in through `/root/login`.
- `/root/dashboard` opened successfully.
- Direct access to `/worker/dashboard` was denied.
- Direct access to `/company/dashboard` was denied.
- Direct access to `/assessor/dashboard` was denied.
- Direct access to `/verifier/dashboard` was denied.
- Direct access to `/admin/dashboard` was denied.
- The Root dashboard remained available to the active Root session.

## Result

Root-session copied-URL and cross-portal isolation: **OWNER PASS**.

## Scope boundary

All six signed-in role rows—Worker, Company, Assessor, Verifier, Administrator and Root—have passed the portal-isolation matrix. Unauthenticated role-specific dashboard redirects still remain under Section I. Later M1.03 sections also remain: stale/revoked action denial, migration rollback and reapply, responsive/accessibility checks, and clean shutdown. M1.04 remains blocked until the complete M1.03 owner hard test passes.
