# A26 private storage source-guard repair — 2026-11-07

**Branch:** `qa/a26-private-storage-guard-20261107`, based on QA Masterplan HEAD `eb77b70f6584c76169e7d6b849b88e25ae666696`.

## Defect reproduced (RED)
The older security source-contract checks for M1.06 signed file access and M1.08 Company verification expected a local-only helper, `requireLocalTestStorageEnvironment`. The product had already been updated to use `requireConfiguredPrivateStorage` and `createRuntimePrivateObjectStorage`, which intentionally allow preview/production only with a configured private object volume. Both outdated static checks failed on current source, blocking the `verify:quick` gate:
- `npm run check:secure-access`: fails expecting removed local-only helper.
- `npm run check:company-verification`: fails for same stale helper.
- Evidence: `.autopilot/artifacts/20261107-a26-secure-access-static-RED.log`, `...company-static-RED.log` (local, retained), and `.autopilot/artifacts/20261107-release-final-candidate-quick-gate.log` in `hse-eb77b70-cavxd91n`.

## Narrow repair
Only update `scripts/check-secure-file-access.mjs` and `scripts/check-company-verification.mjs` to enforce the *current* secure private-storage contract:
1. Central server-owned storage selection before creating signed capabilities or returning bytes.
2. No raw local-test store bypass.
3. Preview/production private volume root must be explicitly configured; missing configuration fails closed and is mapped to access denied.
4. Production storage routes through the existing restricted filesystem adapter; local-test storage is confined to development/test.
5. The existing live authorization, tenant limits, audit, signed token purpose/expiry/integrity and private-response contracts are retained and checked.
No application logic, schema, provider configuration or production data was altered.

## Actual checks — isolated local
- Before repair: M1.06 and M1.08 source guards **RED** (failure reproduced).
- After repair: `npm run check:secure-access` and `npm run check:company-verification` **PASS**.
- `npm run test:secure-access`: **20/20**.
- `npm run test:secure-access-runtime`: **5/5** (signed audit, owner/tenant isolation, revoked sessions).
- `npm run test:company-verification`: **10/10** (OTP/TOTP, evidence, foreign tenant, invalid sessions, case review replay).
- `node --test --test-concurrency=1 tests/platform/production-private-storage-activation-runtime.test.mjs`: **3/3**, real local filesystem private volume with bytes, authorized preview, denial of unauthorized/expired access, denied missing configuration.
- Evidence log: `.autopilot/artifacts/20261107-a26-runtime-security.log` (local, retained).
- All tests synthetic/local. **No production providers or remote protected staging have been certified.**

## Release truth
The frozen 37-brick Masterplan has **218 scenarios**, historical **216 with some scoped local evidence**, **2 without mapped proof**, **0 fully release-certified**. This guard repair is a precondition for final release-gate execution, not a release GO. Pending: final single candidate with complete real-staging cross-role browser/negative/retry tests, true production provider delivery, production PostgreSQL recovery, authorized staging penetration/load, accessibility, owner acceptance, and exact protected CI provenance.
