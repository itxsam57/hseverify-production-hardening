# M1.03 Owner PASS — Verifier portal isolation

Date: 4 August 2026

Repository: `itxsam57/hseverify`

Branch tested: `main`

Environment: Windows 10, Google Chrome, local PGlite authentication sandbox.

## Owner-confirmed evidence

- The Verifier signed in through `/verifier/login`.
- `/verifier/dashboard` opened successfully.
- Direct access to `/worker/dashboard` was denied.
- Direct access to `/company/dashboard` was denied.
- Direct access to `/assessor/dashboard` was denied.
- Direct access to `/admin/dashboard` was denied.
- Direct access to `/root/dashboard` was denied.
- The Verifier dashboard remained available to the active Verifier session.

## Result

Verifier-session copied-URL and cross-portal isolation: **OWNER PASS**.

## Scope boundary

The Administrator, Worker, Company, Assessor and Verifier rows of the six-role portal-isolation matrix have passed. The Root row and unauthenticated role-specific redirect testing remain. M1.04 remains blocked until the complete M1.03 owner hard test passes.
