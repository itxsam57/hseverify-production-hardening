# M1.03 Owner Test Instruction Correction — Migration rollback

Date: 4 August 2026

Repository: `itxsam57/hseverify`

## Observed owner-test result

The owner ran the Section K migration sequence against the local PGlite database. Initial status correctly showed migrations `0001` through `0004` applied. The rollback command intentionally refused to run because the local destructive-rollback acknowledgement was not set:

```text
Set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=true to acknowledge a local/test destructive rollback.
```

No migration was removed. The following status and migrate commands therefore correctly continued to show the schema as current. The subsequent full `npm run check` passed.

## Classification

This is an owner-test instruction omission, not an application defect. The rollback implementation correctly protects local/test databases unless the operator explicitly acknowledges the destructive action. Preview and production rollback remain prohibited.

## Correct Windows Command Prompt sequence

With the development server stopped, run:

```cmd
cd /d C:\Users\arsla\hseverify
npm run db:status
set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=true
npm run db:rollback
set HSE_ALLOW_DESTRUCTIVE_DB_ROLLBACK=
npm run db:status
npm run db:migrate
npm run db:status
npm run check
```

## Required result

- the first status shows `0001` through `0004` applied;
- rollback removes only `0004_authentication_completion`;
- the next status shows `0001`, `0002` and `0003` applied and `0004` pending;
- migrate reapplies `0004`;
- final status shows all four migrations applied;
- the complete automated gate passes.

The environment variable must be cleared immediately after the single acknowledged rollback command. Do not add it permanently to `.env.local`.

## Acceptance boundary

Section K remains pending until the corrected rollback/reapply sequence is owner-confirmed. The already completed `npm run check` is valid evidence that the current schema and code pass the automated gate, but it does not replace the required rollback/reapply observation.
