# M1.04 Session Authorization Context — Final Owner Acceptance

Status: **DONE — OWNER PASS — 5 AUGUST 2026**

This record accepts only M1.04 internal subunit 2: trusted session authorization-context integration and central permission checks. It does not complete the M1.04 brick.

## Accepted implementation chain

Primary implementation:

- Pull request: `#24`
- Implementation head: `c1707fb072fd133abffd834fc65a764e5befffe2`
- Merge commit: `ccbcf44a4781faa85f6d0ded446dc13d38bbed27`
- Final pre-merge CI run: `30978183970`
- Final pre-merge CI job: `92216772217`
- Result: **PASS**

Owner-defect repair:

- Defect: `LATER-OWNER-012`
- Pull request: `#25`
- Repair head: `15f601c52696624e5e351ecd1971ff54c311b70a`
- Repair merge commit: `c100324ace9fea4495e1c4a50377a2df5d00a9ce`
- Exact repair-candidate CI run: `31008741872`
- Exact repair-candidate CI job: `92315136578`
- Result: **PASS**

Final owner-defect evidence commit synchronized during closure:

```text
525efb781e742d372caac2ecf3d315db550bde81
```

## Owner environment

- Operating system: Windows 10
- Repository: `C:\Users\arsla\hseverify`
- Node.js: `v22.23.1`
- Browser: Google Chrome
- Terminal: normal Command Prompt
- Administrator terminal: not required
- Windows Developer Mode: not required

## Owner acceptance results

### A. Pull, install and clean baseline — PASS

- `main` fast-forwarded successfully.
- Initial tested implementation/control commit was `48c406baba404771e508819bf787d084a3a74509`.
- `git status --short` printed nothing.
- Node.js `v22.23.1` was supported.
- `npm ci --no-audit --no-fund` passed.

The Git pack-file unlink cleanup warning during the initial pull did not alter the working tree or prevent synchronization.

### B. Migration status through 0005 — PASS

The owner confirmed the accepted database layer remained applied through:

```text
0001_platform_foundation
0002_authentication_foundation
0003_worker_registration_otp
0004_authentication_completion
0005_authorization_tenant_isolation
```

Subunit 2 added no migration and did not remove accepted account, session, OTP, MFA, invitation, tenant or membership data.

### C. Authorization source/domain gate — PASS

The owner ran the focused authorization source and pure-domain checks successfully.

Accepted coverage includes:

- explicit wildcard-free permissions;
- fixed portal-entry permissions for all six roles;
- revoked, expired, stale and inactive-account denial;
- impossible timestamp and excessive future-skew denial;
- role mismatch versus permission denial;
- current Company membership requirement;
- inactive tenant and membership denial;
- invalid permission overrides failing closed;
- supported isolated TypeScript module semantics.

### D. Authorization migrated-database gate — PASS

The owner ran the complete authorization platform tests successfully.

Accepted coverage includes:

- exact session-token-derived Worker context;
- exact current Company tenant/membership context;
- permission override loading;
- revoked, expired and disabled state preservation for central denial;
- no browser tenant, membership, role or permission selector;
- one central server guard;
- no route-local role matrix or role switching.

### E. Complete application gate — PASS

The owner ran the complete `npm run check` chain successfully.

This included:

- all accepted M1.01–M1.03 regressions;
- authorization source/domain/database tests;
- strict TypeScript;
- ESLint;
- development runtime smoke;
- database-backed runtime smoke;
- deterministic production build;
- signed-out portal redirect runtime regression after repair.

No forced dependency mutation was used.

### F. Worker portal and copied Company URL — PASS

The owner confirmed:

- Worker login succeeded;
- Worker dashboard opened and remained usable;
- opening the Company dashboard while authenticated as Worker did not display Company content;
- the request reached the accepted access-denied boundary;
- no role switch occurred.

### G. Company password/TOTP and copied Worker URL — PASS

The owner confirmed:

- Company password authentication succeeded;
- valid TOTP remained mandatory;
- Company dashboard opened after TOTP;
- opening the Worker dashboard while authenticated as Company did not display Worker content;
- the request reached the accepted access-denied boundary;
- the Company session remained usable;
- no role or tenant switch occurred.

### H. Signed-out fixed-role routing — PASS AFTER REPAIR

Company signed-out dashboard routing correctly returned to Company login.

The initial Worker signed-out test exposed `LATER-OWNER-012`: `/worker/dashboard` displayed the global `Not available` presentation after logout instead of Worker login.

PR #25 repaired the root cause with an optimistic missing-cookie redirect before App Router protected-route rendering. The database-backed central authorization service remained authoritative for present, stale, forged or invalid cookies.

After pulling the repair and restarting the application, the owner confirmed:

- `/worker/dashboard` redirected to `/worker/login?reason=session-required`;
- the Worker sign-in page displayed;
- the global `Not available` page did not appear.

`LATER-OWNER-012` is **RESOLVED — OWNER PASS**.

### I. Clean shutdown — PASS

The development server stopped normally with `Ctrl+C`.

- Command Prompt returned to `C:\Users\arsla\hseverify>`.
- No forced process termination was required.
- No background development server remained.

### J. Final clean synchronized Git state — PASS

The owner ran the combined final closure chain:

```cmd
git pull --ff-only origin main && git status --short && git diff --check && git diff -- tsconfig.json package.json package-lock.json next.config.ts && git status -sb
```

Confirmed:

- pull succeeded;
- `git status --short` printed nothing;
- `git diff --check` printed nothing;
- protected configuration diff printed nothing;
- final branch state was `## main...origin/main`;
- no ahead, behind, modified or untracked entry remained.

## Final accepted boundary

M1.04 subunit 2 now owner-accepts:

1. fail-closed authenticated session/account/fixed-role lifecycle resolution;
2. canonical portal-entry permissions for Worker, Company, Assessor, Verifier, Administrator and Root;
3. one authoritative session-token-to-context SQL loader;
4. Company tenant context derived only from authenticated current membership;
5. tenant lifecycle, membership lifecycle and permission override loading;
6. central server-only portal, platform and current-tenant permission guards;
7. non-enumerating credential, role, permission and tenant denial routing;
8. authorization denial recording through the accepted authentication security-event boundary;
9. protected portal integration without role switching;
10. exact migrated SQL and source-contract regression coverage;
11. missing-cookie pre-render redirects for all fixed-role portal families while preserving database-backed authorization as the security boundary;
12. clean Windows runtime, shutdown and synchronized repository state.

## Boundary not yet accepted

M1.04 remains **IN PROGRESS**.

The following are not part of this acceptance:

- tenant-scoped repository/query/command guards;
- tenant-owned business reads and writes;
- protected Company demonstration surfaces;
- complete cross-tenant direct-endpoint and concurrency testing;
- final M1.04 acceptance.

## Next permitted build unit

M1.04 internal subunit 3:

```text
Tenant-scoped repository/query/command guard contracts
```

Subunit 3 may now begin. M1.05 and later bricks remain blocked until the entire M1.04 brick is DONE.
