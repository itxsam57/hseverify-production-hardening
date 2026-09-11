# M1.03 Completion Integration Status

## Status

The M1.03 authentication and portal-isolation implementation is complete on pull request #17 and has passed its automated acceptance gate.

Implemented and validated:

- fixed-role database-backed sign-in for Worker, Company, Assessor, Verifier, Administrator and Root;
- persisted account lockout and request rate limiting;
- mandatory TOTP verification and replay-counter enforcement for every non-Worker role;
- opaque revocable session cookie with no role-switch operation;
- active-session listing and owned-session revocation;
- password recovery with one-time email OTP, password replacement and all-session revocation;
- invitation-only staff provisioning with concurrency-safe Root bootstrap;
- TOTP enrollment before privileged account use;
- development/test-only first-Root bootstrap;
- isolated portal layouts and cross-role access denial;
- expired, cancelled and abandoned invitation/enrollment lifecycle handling;
- migration `0004_authentication_completion` with independent rollback;
- production build and portable preview validation.

## Automated acceptance

The pull-request gate passed:

- route and environment contracts;
- production dependency audit with zero high-severity production vulnerabilities;
- authentication domain and database regressions;
- registration, OTP, recovery, session, MFA, invitation and isolation regressions;
- profile and responsive-overflow regressions;
- strict TypeScript and ESLint;
- development-server smoke;
- existing-data PGlite runtime smoke;
- optimized production build;
- portable preview smoke with all six login routes, sandbox closure and protected-dashboard redirects.

## Remaining acceptance boundary

M1.03 is **READY FOR OWNER TEST**, not DONE.

It becomes DONE only after:

1. pull request #17 is merged into `main`;
2. the Windows owner hard-test guide is completed against the merged commit;
3. every owner defect is recorded, repaired and regression-tested;
4. the final owner result is PASS with a clean shutdown and clean Git state.

M1.04 remains blocked until that owner PASS is recorded.
