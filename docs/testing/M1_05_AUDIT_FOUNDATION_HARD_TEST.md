# M1.05 Subunit 1 Owner Hard Test

Run in a **Normal Command Prompt** from `C:\Users\arsla\hseverify`.

## A. Synchronize and install

```cmd
cd /d C:\Users\arsla\hseverify
git checkout main
git pull --ff-only origin main
npm ci
```

## B. Apply and inspect migrations

```cmd
npm run setup:local
npm run db:status
```

Required result:

- migrations `0001` through `0007` are applied;
- every checksum matches;
- `0007_platform_audit_foundation` is applied.

## C. Focused audit gate

```cmd
npm run check:audit
npm run test:audit
npm run test:audit-platform
```

Every command must exit successfully.

## D. Complete regression gate

```cmd
npm run check
```

This must pass completely. Do not use `npm audit fix --force`.

## E. Reversible migration proof

Close any running development server, then run:

```cmd
set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=true
npm run db:rollback
npm run db:status
npm run db:migrate
npm run db:status
set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=
```

Required result:

1. only `0007_platform_audit_foundation` rolls back;
2. migrations `0001` through `0006` remain applied;
3. `0007` becomes pending;
4. migration reapplication succeeds;
5. all migrations return to applied with matching checksums.

## F. Clean closure

```cmd
git status -sb
git diff --check
git diff -- .env.example package.json package-lock.json next.config.ts tsconfig.json
git rev-parse HEAD
git rev-parse origin/main
```

Required result:

- no tracked working-tree changes;
- no whitespace errors;
- no unexpected protected configuration diff;
- local HEAD equals `origin/main`.

No browser workflow is required for this storage-only subunit. Existing login, role, tenant and signed-out behavior remains covered by the complete automated regression gate.
