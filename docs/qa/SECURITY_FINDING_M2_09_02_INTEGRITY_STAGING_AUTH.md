# M2.09.02 — staging integrity event authorization bypass

**Status:** isolated patch passes regression; final release certification and comprehensive pentest **OPEN**. Release **NO-GO**.

## Verified finding
- **Original SHA:** `f4628888db95eeeb22a74a884e12a77f7378fae6`.
- **Controlled environment:** isolated localhost Next.js development server + disposable PGlite, `HSE_APP_ENV=staging`, no Worker session. No production or third-party targets were tested.
- **Reproduction:** anonymous `GET /api/integrity/snapshot` returned HTTP 200; anonymous `POST` with `SCREEN_UNAVAILABLE` returned HTTP 201 and persisted an event. The failing formal test output is `.autopilot/artifacts/20261107-integrity-staging-auth-test-RED.log`; one-off verification additionally captured `.autopilot/artifacts/20261107-A28-pentest-integrity-staging-auth-probe.log` in the `hseverify-eligibility-guard-20261107` worktree.
- **Cause:** the local deterministic fixture fallback was selected by `NODE_ENV !== "production"` alone, so a staging-like runtime under Next dev accepted anonymous integrity events.

## Root remediation and test results
- Reject unauthenticated integrity `GET` and `POST` with generic HTTP 401.
- Allow the synthetic fixture *only* when `NODE_ENV !== "production"`, `HSE_APP_ENV === "development"` and `HSE_ENABLE_INTEGRITY_DEV_FIXTURE === "true"`. Existing deterministic local fixture tests now opt in explicitly.
- Formal exploit retest: `node --test --test-concurrency=1 tests/platform/integrity-staging-auth-boundary.test.mjs` → **PASS 1/1**; GET 401, POST 401, no forged event. Local log: `20261107-integrity-staging-auth-test-GREEN.log`.
- Adjacent integrity/security regression: **6/6 PASS** including device degradation/recovery and explicit dev-fixture success. Log: `20261107-integrity-adjacent-security-regression.log`.
- Mandatory `npm run test:platform`: **6/6 PASS**. `npm run typecheck`: PASS. `npm run lint`: exit 0 with nine unrelated existing unused-variable warnings.
- `npm run build`: deterministic optimized build PASS under **disposable test environment configuration**, `HSE_APP_ENV=test`, with synthetic credentials; this is **not** real production-provider/staging signoff. Initial unconfigured attempt reached prerender then failed required production environment validation (missing secrets and database URL).
- Evidence paths above are relative to `hseverify-pentest-integrity-auth-20261107/.autopilot/artifacts/`, unless otherwise specified.

## Still required
Confirm committed exact fix SHA and pushed branch, perform authenticated/unauthenticated HTTP and real browser tests on the protected final staging candidate, all role/tenant abuse and required provider behavior, log DB/audit/notification outcomes, and rerun the 218-row ledger. **Do not promote M2.09.02 to FULLY_VERIFIED yet.**
