# Frozen verification contract EF-AUTH-BOUNDARIES-20261004
Status: UNLOCKED for tests/evidence/state only; product implementation LOCKED pending reproduced root cause.
Requirements: M1.03.06, M1.03.07, M1.04.01. Separate staff invitation/registration/recovery requirements remain unverified.
Objective: six roles reject wrong-role credentials and direct cross-portal requests, reject invalid passwords/MFA, preserve the session on Exit Portal and revoke it on Sign Out.
Allowed: dedicated authentication browser test and named npm/critical-browser and canonical QA workflow wiring, QA ledger/report, engineering contract/state/decisions and durable continuation checkpoint/.gitignore exception, Autopilot audit.
Forbidden: production behavior changes, registration/provisioning/recovery/tenant-scope certification from seeded identities, real provider/customer operations, guard/CI bypass.
Mandatory: actual Chromium form controls and thirty directed cross-portal denials; wrong-role sign-in denied in every directed combination; incorrect password for six and incorrect MFA for five MFA roles; signed-out protected routes redirect; one session per account and exact role, no sessions for rejected credentials, persisted sign-out revocation and denial security events; prior critical-browser tests retained; exact candidate browser/type/lint and required CI pass; independent review accepts scope before merge.
Proof: isolated synthetic six-role fixtures with real server login and persisted records. These fixtures do not verify registration or staff provisioning.
Recovery: ordinary reviewed Git revert of tests/evidence/wiring. Whole Masterplan remains ACTIVE after scoped merge.
