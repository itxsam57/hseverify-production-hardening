# M1.03 Owner PASS — Administrator portal isolation

Date: 4 August 2026

Repository: `itxsam57/hseverify`

Branch tested: `main`

Environment: Windows 10, Google Chrome, local PGlite authentication sandbox.

## Owner-confirmed evidence

While authenticated as Administrator:

- `/admin/dashboard` opened successfully;
- `/worker/dashboard` was denied;
- `/company/dashboard` was denied;
- `/assessor/dashboard` was denied;
- `/verifier/dashboard` was denied;
- `/root/dashboard` was denied;
- each mismatched portal went to the access-denied flow;
- the Administrator session remained valid and the Administrator dashboard continued to work.

## Result

Administrator-session copied-URL and cross-portal isolation: **OWNER PASS**.

## Scope boundary

This proves only the Administrator row of the six-role isolation matrix. Worker, Company, Assessor, Verifier and Root rows, plus unauthenticated direct-access routing, remain to be owner tested before the complete portal-isolation section can pass. M1.04 remains blocked until the complete M1.03 owner hard test passes.
