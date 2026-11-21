# M1.02.03 — inline synthetic seeder import fix after PR102 full QA CI

**Scope:** CI/source fixture repair, not a newly FULLY_VERIFIED Masterplan scenario or pentest result. Canonical signed QA exact source **8fd8bcab797af71854a661a420777b7231f34647**. Original 32-workflow merged CI completed **29 SUCCESS / 3 FAIL**; PR102's actual PG16 Worker/Company recovery remained real Chromium green, but three unrelated M1.02/M1.03/M1.04 workflows failed before their intended assertions.

## RED — actual GitHub logs, single shared cause

- Run **43586279342**, job **132421343973**: native duplicate Worker ID / OTP test FAILED.
- Run **43586279565**, job **132421344111**: actual browser unsaved Worker form navigation FAILED twice.
- Run **43586279567**, jobs **132421344064** real Company report BOLA browser and **132421344337** native Company report tenant scope FAILED.

All four failed jobs show `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/runner/work/hseverify-production-hardening/hseverify-production-hardening/lib/database.mjs' imported from /.../[eval1]`. The existing valid synthetic PGlite fixture `tests/helpers/report-company-fixture.mjs` intentionally reads `scripts/independent-audit-seed.mjs` into a `node --input-type=module -e` inline module. PR102 introduced a **static** import `./lib/database.mjs` into the seed, which the inline evaluator resolved at the repository root, instead of under `/scripts`. This broke PGlite fixtures before real test assertions. **Not proof of data leakage or a consumer security exploit.**

## Root correction and current evidence

Replaced just the new static import with a **dynamic import only within the explicitly permitted disposable PostgreSQL branch**, preserving original PGlite inline fixtures unchanged. Production/non-loopback PostgreSQL fixture guards remain enforced; no allowed network/domain broadening.

Command `node --test tests/platform/report-company-generation-runtime.test.mjs`: **11/11 PASS**, including real scoped CSV/PDF/print digest, tenant isolation, stale authorization, private report BOLA and retry logic; raw local `.autopilot/artifacts/M10203_INLINE_SEED_NATIVE_GREEN.log`. A direct synthetic `node --input-type=module -e <seed source>` guard attempt in production mode rejects as expected. No shared DB/ports needed.

**Next:** guarded PR to original active QA branch, verify exact PR-head and signed merged QA **all** CI including three previously RED workflows. Do not conflate PR102's first 29/32 with fully passing merged SHA. Preserve strict `FULLY VERIFIED 0/218`, historical 1,392/1,566 green distinct source tests, 216/218 old scoped (not full), 693/4,975 old partial, 54 uncertain, 4,228 unlinked, FINAL 0/4,975, independent pentest incomplete, 10 known external blockers, release NO-GO. Next functional M1.02.03 gap remains actual Worker Profile / Company tenant-scope / six-role notifications error→restore→Retry browser acceptance, plus later final protected staging/providers/UAT.
