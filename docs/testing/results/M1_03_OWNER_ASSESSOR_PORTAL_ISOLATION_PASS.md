# M1.03 Owner PASS — Assessor portal isolation

Date: 4 August 2026

Repository: `itxsam57/hseverify`

Branch tested: `main`

Environment: Windows 10, Google Chrome, local PGlite authentication sandbox.

## Owner-confirmed evidence

- The Assessor signed in through `/assessor/login`.
- `/assessor/dashboard` opened successfully.
- Direct access to `/worker/dashboard` was denied.
- Direct access to `/company/dashboard` was denied.
- Direct access to `/verifier/dashboard` was denied.
- Direct access to `/admin/dashboard` was denied.
- Direct access to `/root/dashboard` was denied.
- The Assessor dashboard remained available to the active Assessor session.

## Result

Assessor-session copied-URL and cross-portal isolation: **OWNER PASS**.

## Scope boundary

The Administrator, Worker, Company and Assessor rows of the six-role portal-isolation matrix have passed. Verifier and Root rows, plus unauthenticated role-specific redirect testing, remain. M1.04 remains blocked until the complete M1.03 owner hard test passes.
