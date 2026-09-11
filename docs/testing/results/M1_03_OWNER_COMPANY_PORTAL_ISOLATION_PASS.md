# M1.03 Owner PASS — Company portal isolation

Date: 4 August 2026

Repository: `itxsam57/hseverify`

Branch tested: `main`

Environment: Windows 10, Google Chrome, local PGlite authentication sandbox.

## Owner-confirmed evidence

- The Company user signed in through `/company/login`.
- `/company/dashboard` opened successfully.
- Direct access to `/worker/dashboard` was denied.
- Direct access to `/assessor/dashboard` was denied.
- Direct access to `/verifier/dashboard` was denied.
- Direct access to `/admin/dashboard` was denied.
- Direct access to `/root/dashboard` was denied.
- The Company dashboard remained available to the active Company session.

## Result

Company-session copied-URL and cross-portal isolation: **OWNER PASS**.

## Scope boundary

The Administrator, Worker and Company rows of the six-role portal-isolation matrix have passed. Assessor, Verifier and Root rows, plus unauthenticated role-specific redirect testing, remain. M1.04 remains blocked until the complete M1.03 owner hard test passes.
