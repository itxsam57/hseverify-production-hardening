# HSE Verify

Clean Phase 1 rebuild of the HSE Verify Workforce Trust Platform.

## Canonical product blueprint

Read `docs/Masterplan(HSE Verify).md` before changing product behavior. It is the continuous canonical product, workflow, UX, security and engineering blueprint for the frozen Phase 1 scope.

For implementation state, `docs/NEXT_BUILD_UNIT.md` controls the exact active gate and `docs/bookmarks/MILESTONE_PATH.md` controls permanent brick order/status. `docs/bookmarks/LATER.md` records unresolved, deferred and provider-dependent obligations; it does not override the active gate or milestone path.

## Current build

The clean rebuild has completed owner acceptance through M1.05 and M1.07, with M1.06 at Engineering PASS. M1.08–M1.11 are implementation-merged with Engineering PASS and owner/browser acceptance intentionally deferred to the combined Milestone 1 browser acceptance. **M1.12 Public Verification Foundation is the only active product brick.** Formal Milestone 1 DONE count remains **7 of 12** until deferred owner acceptance actually passes.

Production provider activation for email/SMS, real video, liveness/identity verification, malware scanning, payments and hosted production traffic remains provider-dependent and must stay truthfully sandboxed/disabled until the appropriate milestone and credentials are ready.

## Build control bookmarks

Every feature build must use and maintain this hierarchy:

- `docs/Masterplan(HSE Verify).md` — canonical frozen product/engineering blueprint and anti-drift authority.
- `docs/NEXT_BUILD_UNIT.md` — exact current implementation gate.
- `docs/bookmarks/MILESTONE_PATH.md` — canonical three-milestone path, permanent brick order and accepted/engineering history.
- `docs/bookmarks/LATER.md` — every missing, partial, provider-blocked or deliberately deferred requirement; “Later” never means optional.

## Local setup

1. Install Node.js 20.9 or newer.
2. Copy `.env.example` to `.env.local`.
3. Use test-only values and a session secret of at least 32 characters.
4. Keep `HSE_DATABASE_DRIVER=pglite` and `HSE_PGLITE_DATA_DIR=.data/postgres` for local work.
5. Enable demo/test authentication only in isolated local testing where the current milestone documentation permits it.
6. Run:

```bash
npm ci
npm run setup:local
npm run dev
```

Use the route and test instructions for the currently accepted/active brick rather than assuming an older Worker-only route is the whole product.

## Database commands

```bash
npm run db:migrate
npm run db:status
npm run db:import-profiles
```

Destructive local rollback remains intentionally guarded by the milestone engineering documentation and migration contracts.

## Validation

Run the current brick's targeted gate plus the complete repository gate defined by `docs/NEXT_BUILD_UNIT.md` and the relevant testing documents. The permanent rule is exact-head verification, expected-head merge lock, merged-main verification and owner/browser acceptance where visible behavior requires it.

## Current owner test boundary

The owner requested one combined **Milestone 1** browser acceptance after M1.12 is engineering-green. This is a test deferral, not an owner PASS. Do not infer owner acceptance from CI.

## Engineering documentation

Start with:

- `docs/Masterplan(HSE Verify).md`
- `docs/NEXT_BUILD_UNIT.md`
- `docs/bookmarks/MILESTONE_PATH.md`
- `docs/bookmarks/LATER.md`

Then read the current brick's engineering and testing documents plus the accepted lower-brick records needed for the change.


### Background outbox worker

`npm run build` compiles both the web application and the outbox worker. Run the
worker as a separate supervised process from the same full release directory:
`npm run worker:outbox`. Supply the same validated production environment and
PostgreSQL database as the web application (`HSE_DATABASE_DRIVER=postgres`).
Apply database migrations before starting either process. Keep runtime npm
dependencies installed and retain `.outbox-worker-dist` and
`scripts/run-outbox-worker.mjs` in the release. The Next standalone web directory
alone is not the worker release.

The supervisor should restart the worker after unexpected exits and send SIGTERM
for shutdown. Existing outbox leases, retries and dead-letter monitoring apply.
Timed assessment begin writes deadline jobs transactionally; the worker processes
them even when the browser is closed. Authenticated reads also catch up expired
attempts. Monitor worker liveness and dead-letter expiry jobs; a deployment without
the supervised worker has no guaranteed unattended deadline processing.

`npm run worker:outbox -- --once` processes one due job for operational diagnosis.
PGlite is supported only for offline single-process checks, not a continuously
running worker alongside the web application.
