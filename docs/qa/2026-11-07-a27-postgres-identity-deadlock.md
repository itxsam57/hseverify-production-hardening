# A27 — Native PostgreSQL Worker Identity deadlock, actual HTTPS browser proof

**Date:** 2026-11-07
**Base QA candidate:** `bfb790d0a75f368ae6cda53693d6096d4ada3588` (12/12 GitHub QA previously green, yet inadequate real-PG concurrency coverage).
**Issue:** Worker `/worker/identity` returned HTTP 500 `40P01` on real native PostgreSQL 16, despite localhost PGlite passing. Production `__Host-` cookie requires HTTPS for repeatable authentication.

## Real RED before fix

A disposable PostgreSQL 16 instance was migrated from scratch, an optimized Next.js 16 production-mode build ran behind a loopback-only self-signed HTTPS proxy, and a real Chromium Worker session signed in. GET `/worker/identity` **returned HTTP 500**. Native PostgreSQL `deadlock detected` logs identified row locks on `auth_sessions` (OID 16471) and `auth_accounts` (OID 16415). Multiple Identity load services executed concurrently and requested `FOR UPDATE OF sessions, accounts`; notification reads used account-first followed by session-first locks in parallel. The conflicting order formed a transaction cycle. This is a **real production-configuration defect** not caught by the previous PGlite/browser green suites. The first page-sequential-only patch and initial Identity-read-only patch remained RED under native PG; this is why both notification and Identity read paths needed correction.

RED evidence in the preserved original QA worktree (local private artifacts, never public data):
- `../hseverify-release-candidate-20261107/.autopilot/artifacts/a27-prodpg-Exkwfl/postgres.log`, `server.log`, `pg-oid-map.json` and `result.json`.
- First isolated patch still RED: `.autopilot/artifacts/a27-prodpg-Gc6mSk/postgres.log`.
- Four parallel Identity GET still RED before fixing Notification reads: `.autopilot/artifacts/a27-prodpg-ixTKfx/postgres.log`.

## Root correction — retain security, avoid accidental lock cycles

- Worker Identity page loads independent authenticated projections in a stable sequence, instead of issuing all five transactional reads at once.
- The Worker Identity repository, draft, evidence, automated checks, eligibility and correction **read-only** methods use current-session authorization checks without exclusive locks.
- Notification **read-only** list, unread-count and item-read methods likewise validate account, session and Company scope without `FOR UPDATE`.
- Every mutating service path retains existing exclusive account/session/tenant locks and server-side authorization, preserving revocation and cross-tenant denial rules.
- No permissions, role ceilings, schema, migrations, PII processing, external providers or production data changed.

## Verified GREEN on patched working source

- `npm run check:notifications` and six Worker Identity source guards **PASS**.
- Notifications native **11/11**, Worker Identity aggregate **9/9**, draft **7/7**, evidence **7/7**, automated checks **9/9**, eligibility **15/15**, corrections **12/12** — **70/70**.
- Strict TypeScript **PASS**, scoped ESLint **0 errors**.
- Optimized Next standalone production build with real PostgreSQL and configured *isolated* private file volume **PASS**.
- Real local HTTPS Chromium signed into six roles, verified six Secure/HttpOnly `__Host-hse_session` cookies, six forbidden cross-role paths, and six persisted PostgreSQL sessions.
- Real **4 simultaneous authenticated Worker Identity GETs = 4/4 HTTP 200**, no `40P01`. All **71 static role portal pages** responded HTTP 200 (Worker onboarding's explicit redirect asserted then followed). 6 login pages have CSP/HSTS/nosniff and sandbox routes are disabled.
- GREEN original working-source test report: `.autopilot/artifacts/a27-prodpg-nwhiF3/result.json` (previous logs under same local QA worktree).
- Reusable isolated runner: `HSE_DISPOSABLE_POSTGRES_QA=true npm run test:production-postgres-https`; it creates a brand-new disposable PostgreSQL database and HTTPS proxy, uses random synthetic secrets, builds *the actual current source*, checks six roles, and destroys PG volume and listener afterward. Requires PostgreSQL 16 server/client, Node/npm and Playwright Chromium installed. **Do not use against production or externally exposed networking.**

## Remaining release gates — NO-GO

This is scoped **local production-mode evidence**, not full consumer release certification. Final protected deployed staging, production email/SMS/identity/scanning/storage/video/payments, authorized full penetration and sustained load, deployed backup/restore and owner acceptance remain unverified. **0/218 frozen scenarios fully release-certified**. Promotion requires exact new commit's complete QA/CI, not borrowing the bfb790d GitHub 12/12 status.
