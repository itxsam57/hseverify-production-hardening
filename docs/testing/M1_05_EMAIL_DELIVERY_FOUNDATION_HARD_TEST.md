# M1.05 Subunit 4 — Owner Hard Test

## Scope

This owner gate validates the merged M1.05 Subunit 4 durable email queue, delivery-attempt history and local/test provider adapter. There is no new browser-visible product surface in this subunit, so no browser workflow is required.

Run all commands in a normal **Command Prompt** from the repository on merged `main`.

## A. Synchronize and install

```cmd
cd /d C:\Users\arsla\hseverify
git checkout main
git pull --ff-only origin main
npm ci
```

Required:

- Git checkout/pull complete without error.
- Locked dependency installation completes without error.
- Do not run `npm audit fix --force`.

## B. Apply and inspect the migration stack

```cmd
npm run setup:local
npm run db:status
```

Required:

- migrations `0001` through `0010` are applied;
- `0010_email_delivery_foundation` is applied;
- all migration checksums match;
- no pending/failed migration remains.

## C. Focused Subunit 4 proof

```cmd
npm run check:email-delivery
npm run test:email-delivery
npm run test:email-delivery-platform
npm run test:email-delivery-runtime
```

Required: every command succeeds.

The runtime suite must exercise the real local/test email path and prove success, retry then success, fifth-attempt terminal failure, no redispatch after durable delivery and persistence after PGlite close/reopen.

## D. Complete application regression gate

```cmd
npm run check
```

Required: the complete application gate succeeds through source contracts, authentication, authorization, tenant isolation, audit, outbox, notifications, email delivery, migrations, strict TypeScript, ESLint, development smoke, protected-route redirects, runtime database smoke and production build.

## E. Reversible migration proof

Stop any development server before this section.

```cmd
set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=true
npm run db:rollback
npm run db:status
```

Required after rollback:

- only `0010_email_delivery_foundation` is rolled back;
- migrations `0001` through `0009` remain applied with matching checksums;
- `0010_email_delivery_foundation` is pending;
- accepted audit/outbox/notification history is not invalidated.

Reapply:

```cmd
npm run db:migrate
npm run db:status
set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=
```

Required:

- `0010_email_delivery_foundation` reapplies successfully;
- migrations `0001` through `0010` are applied;
- all checksums match.

## F. Clean synchronized closure

```cmd
git status -sb
git diff --check
git diff -- .env.example package.json package-lock.json next.config.ts tsconfig.json
git rev-parse HEAD
git rev-parse origin/main
```

Required:

- no tracked local changes;
- `git diff --check` prints nothing;
- protected configuration diff prints nothing;
- local `HEAD` and `origin/main` are identical;
- the commit matches the merged-main SHA supplied in the owner handoff.

## Owner result

Report **PASS** only if every section succeeds. If a section fails, preserve the complete output beginning at the first failing command and do not continue destructively past that failure.

Subunit 4 remains **NOT DONE** until this owner gate passes and the final owner-acceptance closure record is merged.
