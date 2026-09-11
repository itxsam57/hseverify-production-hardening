# M1.03 Final Owner Acceptance — Authentication and Portal Isolation

Status: **DONE — OWNER PASS**

Owner acceptance date: 4 August 2026

Repository: `itxsam57/hseverify`

Environment:

- Windows 10
- Google Chrome
- Node.js 22.23.1
- Normal Command Prompt
- Windows Developer Mode not required
- Local PGlite database
- Development authentication sandbox enabled

## Accepted implementation chain

- M1.03 authentication foundation merge: `1472ea94118507320cef5c33412cc260e55c3916`
- M1.03 completion merge: `69e1c9018063f1ae01bb826ea8ab59c22a0602a6`
- Worker dual-OTP repair merge: `54f1b2aaa00b189ddb38585744104529d916073e`
- Worker lockout/recovery repair merge: `403056b85f52b7e2c656b0585b6ced50fdad140a`

## Owner-confirmed acceptance

The owner completed and passed the complete M1.03 hard-test sequence:

1. Worker public registration with mandatory email and phone OTP.
2. Registration recovery across refresh/back/restart without duplicate account creation.
3. Worker fixed-role password login and database-backed opaque session persistence.
4. Session listing, second-session visibility, owned-session revocation and sign-out.
5. Five-attempt lockout, neutral errors and password recovery.
6. One-time recovery OTP, new-password login, old-password rejection and all-session revocation.
7. First-Root sandbox bootstrap, mandatory TOTP enrollment and Root login.
8. Invitation-only enrollment and mandatory TOTP login for Company, Assessor, Verifier and Administrator.
9. Single-use invitation rejection after enrollment.
10. Complete six-role copied-URL and cross-portal denial matrix.
11. Unauthenticated direct dashboard access redirected to each role-specific login.
12. Stale privileged Root invitation submission denied after sign-out with no mutation.
13. Password-reset session invalidation and stale-session denial.
14. Migration `0004_authentication_completion` rolled back alone, became pending, reapplied and returned to applied state.
15. Complete `npm run check` passed after rollback/reapply.
16. Responsive and accessibility matrix passed for Worker registration, all six login pages, recovery request/verification, staff enrollment/TOTP, account sessions and access-denied.
17. Development server stopped normally.
18. Final Git status, diff check and protected configuration diff were clean after fast-forward synchronization.
19. No Administrator terminal or Windows Developer Mode was required.

## Security boundary accepted

- One browser cookie resolves to one database session and one immutable active role.
- There is no in-session role switching.
- Every protected layout and server action rechecks the database session.
- Cross-role routes reveal no protected portal content.
- Stale and revoked sessions cannot mutate protected state.
- Every non-Worker role requires TOTP.
- Password reset revokes every existing session.
- OTPs, recovery flows, invitations and TOTP counters are one-time.
- Sandbox secrets remain outside tracked source.

## Defect closure

- `LATER-OWNER-010`: resolved and owner accepted.
- `LATER-OWNER-011`: resolved and owner accepted.

No unresolved release-blocking M1.03 owner defect remains.

## Final decision

M1.03 — Authentication and Portal Isolation is **DONE**.

M1.04 — Authorization and Tenant Isolation is now the only permitted implementation brick.
