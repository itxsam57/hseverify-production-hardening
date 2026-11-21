# M1.11.04 — independently authorized employment Verifier two-client PGlite and real PostgreSQL16 security (2026-11-19)

Signed QA base b23e2060730cac9299ca8d31c1168c9ef629fac5, **74/74 exact merged SHA CI SUCCESS**. Previous original Company-linked employment + original Company skill real Chromium **1/1 each** downloaded original SHA256 a0e4a421afd4e104d0e757967e25046254ee98083867251fb0f84a051456309e and c58ad1c0bd865fd8b766d1cb3a4a46975d745054e86b0f7d126e29f200695f6f. This is scoped synthetic QA, **not release-certified**.

## New direct security test scope

Add one employment-specific test to original tests/platform/independent-evidence-review-runtime.test.mjs; original skill test remains exactly unchanged. On real original EvidenceReviewService and independently authenticated test Workers, Verifiers and Company with transparent synthetic accounts, test:

1. Foreign Worker cannot queue another Worker's employment record. Company cannot claim Verifier-only task. Unauthorized competing Verifier cannot decide copied task ID.
2. Worker corrected v2 after v1 CHANGES_REQUESTED, one idempotent requeue. Two independent PostgreSQL16 SQL connections compete for same v2 claim and final approval: only one successful claim/finalize, no duplicate decision; loser rejected. Local PGlite cannot simulate real parallel SQL race, so it takes deterministic loser-denied path.
3. Superseded v1 task cannot be approved after Worker revision; zero stale decision rows; current v2 can get independently authorized approval. Four review tasks across original and stale parallel record, three immutable source-version-bound decision rows, original vs current version preserved. DB UPDATE attempt on final decision triggers immutability denial.
4. Fail closed four named receipts in **both** PGlite and actual postgres:16, using original exact SHA GitHub Actions workflow m1-11-04-employment-stale-verifier-pg16.yml. Original sibling m1-11-03-skill-stale-verifier-pg16.yml automatically triggers and protects unchanged skill behavior.

**Actually completed:** new in-memory local PGlite targeted test **1/1 GREEN**, zero skipped, four distinct marker receipts, original raw at .autopilot/artifacts/M11104_EMPLOYMENT_NATIVE_PGLITE_LOCAL_20261119.log. **Actual independent two-client PostgreSQL16 NOT YET RUN**, so no PG16 pass claim. Test source is the 1,609th case, *not* historically passed: 1,434/1,609 previous green,175 unmatched. 218 FULL0, original 4975 FINAL0. Full independent penetration testing and protected final stage+real external providers/Owner UAT remain BLOCKED/NO-GO. No shared PostgreSQL16 touched.

**NEXT:** source index regen and strict regression, guarded commit+push/PR, new GitHub Actions real SQL 1/1 + PGlite1/1 marker evidence, download original raw both SHA256 and verify; root-fix any failure and retest, normal signed QA merge then full exact merged QA sweep. Continue HTTP API tenant/session/race/expiry/security and real provider/protected final stage gates.

### Local original synthetic evidence SHA256
Employment PGlite 1/1 original raw SHA256 517d7a68f736b0275afbe83db3bb83302872d880f67b21281730fefe15c8df74; unchanged Skill PGlite1/1 original raw SHA256 2052a0adec6a97fc383f0440d787afa5c1956b0f1292d3576ab4b2c1302a0a3e. Both four-marker fail-closed receipts, no skips; **genuine isolated PostgreSQL16 remote CI not yet executed**.
