# M1.03 Owner PASS — unauthenticated dashboard routing

Date: 4 August 2026

Repository: `itxsam57/hseverify`

Branch tested: `main`

Environment: Windows 10, Google Chrome Incognito, local PGlite authentication sandbox.

## Owner-confirmed evidence

With no authenticated session present, the owner directly opened every protected dashboard route:

- `/worker/dashboard` redirected to `/worker/login`;
- `/company/dashboard` redirected to `/company/login`;
- `/assessor/dashboard` redirected to `/assessor/login`;
- `/verifier/dashboard` redirected to `/verifier/login`;
- `/admin/dashboard` redirected to `/admin/login`;
- `/root/dashboard` redirected to `/root/login`.

No protected dashboard content was exposed before redirect.

## Result

Unauthenticated role-specific dashboard routing: **OWNER PASS**.

The complete M1.03 portal-isolation section now passes for both authenticated cross-role denial and unauthenticated role-specific redirects.

## Scope boundary

M1.03 remains in owner hard testing. Remaining gates are stale/revoked action denial, migration rollback and reapply, responsive/accessibility checks, and final clean shutdown/Git state. M1.04 remains blocked until the complete M1.03 owner hard test passes.
