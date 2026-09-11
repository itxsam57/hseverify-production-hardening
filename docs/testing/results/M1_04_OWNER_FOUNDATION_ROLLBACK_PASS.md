# M1.04 Authorization Foundation — Owner Rollback/Reapply PASS

Status: **OWNER PASS**

Owner test date: 4 August 2026

Environment:

- Windows 10
- Normal Command Prompt
- Repository: `C:\Users\arsla\hseverify`
- Branch: `main`

Commands completed:

```cmd
set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=true
npm run db:rollback
set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=
npm run db:status
npm run db:migrate
npm run db:status
```

Owner-confirmed result:

- rollback completed successfully;
- only `0005_authorization_tenant_isolation` was rolled back;
- the destructive rollback acknowledgement was cleared immediately afterward;
- `0001_platform_foundation` remained applied;
- `0002_authentication_foundation` remained applied;
- `0003_worker_registration_otp` remained applied;
- `0004_authentication_completion` remained applied;
- `0005_authorization_tenant_isolation` became pending after rollback;
- no lower migration was removed or altered;
- `npm run db:migrate` reapplied `0005_authorization_tenant_isolation` successfully;
- the final status check confirmed `0001` through `0005` are all applied;
- no Administrator terminal or Windows Developer Mode requirement was reported.

Verdict:

Section F — independent rollback, lower-layer preservation, clean reapplication and final migration state — **OWNER PASS**.

This does not yet accept the M1.03 authentication/portal regression checks or final clean Git state. M1.04 subunit 1 remains **OWNER TEST IN PROGRESS**.
