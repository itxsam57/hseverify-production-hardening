# M1.05 Final Owner Hard Test

## Scope

This is the final owner gate for **M1.05 Audit and Notification Foundations** after Subunits 1–4 have already passed their individual owner gates and Subunit 5 has merged.

Subunit 5 adds no new browser-visible product workflow. Do **not** repeat the previously accepted notification browser test. This final owner gate is command-line only and verifies the combined M1.05 engineering boundary on merged `main`.

Run all commands in a normal **Command Prompt** from the repository.

## A. Synchronize and install

```cmd
cd /d C:\Users\arsla\hseverify
git checkout main
git pull --ff-only origin main
npm ci
```

Required:

- checkout and fast-forward pull complete without error;
- locked dependency install completes without error;
- do not run `npm audit fix --force`.

## B. Apply and inspect the complete migration stack

```cmd
npm run setup:local
npm run db:status
```

Required:

- migrations `0001` through `0010` are applied;
- migrations `0007` audit, `0008` outbox/jobs, `0009` persisted notifications and `0010` email delivery are all applied;
- every checksum matches;
- no migration is failed or unexpectedly pending.

## C. Final combined M1.05 proof

```cmd
npm run check:m1-05-final
npm run test:m1-05-final
```

Required: both commands succeed.

The combined test command must include:

- audit/outbox/notification/email isolation and durability;
- six fixed-role notification/email recipient isolation;
- Company tenant isolation and revoked-principal denial;
- transaction atomicity and duplicate suppression;
- immutable audit/notification/email history rules;
- mixed notification/email worker concurrency, lease expiry, reclaim and stale-worker denial;
- persistent close/reopen state and migration checksum proof.

## D. Re-run the accepted M1.05 subsystem proofs

```cmd
npm run test:audit-platform
npm run test:outbox-platform
npm run test:notification-platform
npm run test:email-delivery-platform
npm run test:email-delivery-runtime
```

Required: every command succeeds.

These tests are intentionally automated rather than asking the owner to repeat already-accepted browser workflows.

## E. Complete repository engineering gate

```cmd
npm run check
```

Required: the complete gate finishes successfully through source contracts, dependency/security checks, all accepted regression suites, migrations, strict TypeScript, ESLint, development/runtime smoke, protected-route redirects, runtime database smoke and production build.

## F. Latest-layer reversible migration proof

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
- accepted audit/outbox/notification history remains valid.

Reapply:

```cmd
npm run db:migrate
npm run db:status
set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=
```

Required:

- `0010_email_delivery_foundation` reapplies successfully;
- migrations `0001` through `0010` are applied;
- every checksum matches.

The deeper owned-layer rollback/reapply proofs for migrations `0007`–`0010` remain automated in the full gate; the owner is not asked to destructively repeat those lower-layer tests manually.

## G. Clean synchronized closure

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
- both SHAs match the merged-main commit supplied in the owner handoff.

## Owner result

Report **PASS** only if every section succeeds.

If a command fails, preserve output beginning at the first failing command. Do not continue destructively beyond a failed migration/rollback step.

M1.05 remains **IN PROGRESS** until this owner gate passes and a separate final M1.05 brick-acceptance record is merged and revalidated on `main`.
