# M1.03 Owner Acceptance — Company Invitation and Enrollment

Status: PASS

Owner-tested: 4 August 2026

Repository: `itxsam57/hseverify`

Baseline observed before this record: `83dea6b875394e6c1061bcec3fcd58ac0cf84dc1`

Environment:

- Windows 10
- Google Chrome
- local development authentication sandbox
- migrated PGlite owner-test database

## Owner-confirmed acceptance evidence

The owner confirmed that:

- the signed-in Root account created a one-time Company invitation;
- the invitation URL opened successfully;
- the Company profile and strong password were accepted;
- TOTP enrollment completed;
- the Company signed in through `/company/login` using password plus a fresh TOTP code;
- the Company Dashboard opened;
- reuse of the consumed invitation was rejected.

## Fixed-role session observation

While a Root session was active in the same browser context, the Company portal required the owner to sign out before continuing as Company. The same behavior occurred earlier when moving from Worker to Root.

This is accepted and intentional. One authentication cookie represents one database-backed session with one fixed `activeRole`. The application must not silently replace or switch that role inside the same authenticated browser session. Access to another portal requires explicit sign-out followed by that role's separate login, or a separate browser context.

Protected role routes continue to deny `portal_role_mismatch` rather than rendering another portal or performing an implicit role switch.

## Boundary

This acceptance covers the Company invitation, enrollment, TOTP login, dashboard entry, invitation reuse protection and observed explicit-sign-out requirement.

It does not complete M1.03. Assessor, Verifier and Administrator invitation-only enrollments, broader portal isolation, stale-action denial, migration rollback/reapply and responsive/accessibility checks remain pending. M1.04 remains blocked.
