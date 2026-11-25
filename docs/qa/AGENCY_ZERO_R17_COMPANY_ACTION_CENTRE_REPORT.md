# ZERO-R17 — Company Action Centre trusted analytics and signed-out browser boundary

**Candidate application SHA:** `7ff30ea140a5145e5d5ba761f7c7aef24c895269` (unchanged). **Original scenarios:** chiefly `M3.04.03` case next-actions and `M3.04.05` readiness/gaps; this is a **four-actual-test related revisit**, not full coverage of either original scenario. Maximum five complied. Company and anonymous browser roles; isolated PGlite for projection cases and headless Chromium on disposable localhost for signed-out negative UI. **SCOPED PASS 4/4. TECH FULL 0/218.**

## Four executed cases

1. **PGlite/runtime:** `M3.04 projects live workflow, approvals, readiness and competency gaps inside the trusted tenant` — PASS. Role/tenant-bound live action-centre calculation (not only static UI).
2. **PGlite/security:** `M3.04 excludes cancelled/closed work from live readiness and fails closed on the wrong permission` — PASS. Denied cross-permission reads and excluded stale records.
3. **Source/UI contract:** `M3.04 Company Action Centre UI is wired to the live analytics projection` — PASS. This is **source inspection/contract test**, not an authenticated render success.
4. **Real Chromium negative UI:** `M3.04 Company Action Centre crosses the rendered browser boundary` — PASS, real `/company/action-centre` route safely navigates anonymous user to `/company/login`; no private competency/credential/owner/action field leaked and no browser console/page exceptions.

**Executed:** `node scripts/run-assurance-order-case-runtime-tests.mjs --m3-04` (3/3, exit0), and `node --test --test-concurrency=1 tests/browser/m3-04-company-action-centre.browser.test.mjs` (1/1, exit0).

**Immutable private evidence and SHA256**
- Analytics three-case TAP log: `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r17/M3.04.action-centre-analytics.log` SHA256 `f07d2db4fa478540738fcdc1fd4a19cb53e009d26ee61341c96fe8f99bf6f553`; source `tests/platform/company-action-centre-analytics.test.mjs` SHA256 `cb48c684655d6aaf062e3a088b8aac5b2341fb225bdaae025f20083e9e3006a0`.
- Anonymous Chromium TAP log: `/home/ubuntu/work/.hse-qa-tmp/agency-zero-r17/M3.04.action-centre-anon-chromium.log` SHA256 `7267f78dbea867f82007c0d1d7d1973e89045c71cf1e6d892e58f3c10a9bdc68`; source `tests/browser/m3-04-company-action-centre.browser.test.mjs` SHA256 `3bc4b8f713ee622ae2b7eba95eec5557c1116ca6e5a251f39bb373acc219cf59`.

**ENGINEER — SCOPED PASS:** Live projected Company action/readiness/gaps, cancelled/closed exclusion, correct backing UI service contract and anonymous browser route verified. Missing: all signed-in Company filter/pagination/command clicks with real statuses/notifications on 320/390/1440, mixed Worker cases and cross-role receiving.

**CYBERSECURITY — SCOPED PASS:** Wrong permission read denied in actual PGlite service and unsigned browser access redirected without private data. Missing dedicated two-tenant IDOR/BOLA, XSS/CSRF, stale/revoked membership replay, and full security run.

**REVIEWER — SCOPED PASS (independent full signoff pending):** Four distinct source names and TAP outcomes match raw hashes. Source-contract test is not mislabeled as real signed-in UI. No scenario awarded TECH FULL; no production/shared stage altered.

**NEXT:** Inspect full 28-case separate funding-notification regression (unrelated to R17 <=5-case limit) and guard committed R16 fixture fix if green. Dispatch new full independent hosted audit at exact patched test SHA. Continue actual authenticated M3.04 multi-status and cross-tenant browser verification before promoting original scenario. **OWNER TESTING READY: NO.**
