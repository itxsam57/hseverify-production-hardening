# M1.04.02 — two Company tenant-private PDF conditional HTTP and cache-bypass checks

**2026-11-15. Local scoped real-browser evidence, not release signoff. Original frozen M1.04.02 remains NOT_FULLY_VERIFIED.**

## Exact source, reuse, scope

- Signed QA base `fad500fb35df88721e37d34640b89870d2d2709c` from PR #116, actual **32/32 merged SHA workflows SUCCESS**. Original 218 and 4,975 final counts not increased by merge.
- Previous original case `tests/browser/company-secure-files-cross-tenant.browser.test.mjs` already passed on exact QA CI: two authenticated Company tenants, positive own PDF issue/download/preview, copied token and forged header denial, signed-out token revocation, authoritative DB audit. Reused same file, same test identity, same fixture; **no duplicate new test case**.
- New actual missing branch was conditional and ranged HTTP GET or HEAD with another Company's signed capability: could a server/cache respond `206 Partial Content` or `304 Not Modified` without checking the active tenant session first? Evidence gap was reproduced by a deterministic source-coverage assertion **RED exit1** before changing the test, not by exploiting a product bug: `.autopilot/artifacts/M10402_CONDITIONAL_RANGE_COVERAGE_GAP_RED.log` SHA256 `458495be937f7b330e709db8e81385a1c009d62f84534414f2d7706914a70623`.

## Real Chromium + PGlite, exact observed results

- Existing named browser test amended in place; synthetic local files, signed Company A and B sessions and anonymous client. **Actual browser 1/1 PASS**; ~27.9s, exit0; `node --test tests/browser/company-secure-files-cross-tenant.browser.test.mjs`.
- For Company B's copied Company A signed download capability and for a separate anonymous browser, **four real GET header variants each**: `Range: bytes=0-15`, matching content-hash `If-None-Match`, future `If-Modified-Since`, and `Range + If-Range`. **8/8 HTTP 404**, **0 response body bytes**, restrictive **`Cache-Control: private, no-store, max-age=0`**, `Pragma: no-cache`; no `206`, `304` or tenant A PDF leak.
- Company A's own signed `Range` GET returned expected full private PDF bytes HTTP200 and `no-store` (current GET route ignores Range, which is permitted and is NOT an authorization defect). Foreign Company `HEAD` with Range was denied without bytes (404/405 allowed as denial).
- Unchanged existing bidirectional tenant PDF access, purpose-bound preview/download, malformed signed URL and body parameters, explicit browser logout old token replay, 2 tenant-owned authoritative DB secure files and 7 strictly owner-bound immutable audit records also passed.
- Raw complete log: `.autopilot/artifacts/M10402_CONDITIONAL_TENANT_FILE_RANGE_BROWSER_20261115.log`; SHA256 **`a90ba1f09dc331487d52bd74c11cf1a5251dc918ba4300a1edfca771c39c9bf0`**.
- No product/security defect exposed by these probes. No product source change. Final independent full-stage pentest of other endpoints, real providers, protected staging, load/restore and Owner UAT remain absent.

## Original ledger and counters

- Source identity index `MASTERPLAN_218_EXECUTED_TESTS.json`: after reindex from immutable *previous* sibling-worktree logs, previous green **1,399/1,572**, 173 without prior matching pass. This is +1 from prior **M1.04.01** actual clean log, **NOT** new M1.04.02 test-case identity; new assertions extend the original source case and are attested by the raw current Chrome log above. Source index must remain honest about historic vs current.
- Original frozen **FULLY VERIFIED 0/218 | LEFT 218 | NO-GO**; previous old scoped **216/218 not fully certified**. 4,975 provisional planned checks **693 PARTIAL + 55 UNCERTAIN + 4,227 UNLINKED**, final **0/4,975**. PENTEST incomplete, 2,008 provisional attack slots, independently completed unknown, critical/high unknown, known external blocked 10.
- Isolated worktree `hseverify-m10402-conditional-http-20261115`, branch `qa/m10402-conditional-http-20261115`, base QA SHA `fad500fb35df88721e37d34640b89870d2d2709c`; V4 audit session `771965c5-fd9d-4936-bbfe-9bf81153efd0`, cycle `1dc9c445d2024cf4aa6953d08b70d9ef`. Test environment synthetic PGlite / real Chromium; no production or third-party traffic.
- NEXT: original 218/4975 integrity and source index verification, guarded commit and PR with existing browser case extended plus same-CI workflow; exact PR-head real Chromium, native authz, 218/4975 Autopilot checks, merge and verify exact merged QA SHA. Then resume first uncovered frozen M1.04.02 tenant scope export/filter abuse, or mark remaining protected-stage/provider/pentest/owner UAT BLOCKED_EXTERNAL and proceed next original M1.04.03. Do not award FULLY_VERIFIED.


**Engineering integrity proof:** original indexed 218/4,975/216 verify checks, four engineering suites, JS release ledger, current release audit and all-counter taskbar exit 0, log `.autopilot/artifacts/M10402_ORIGINAL_LEDGER_AND_4975_ALL_GATES_20261115.log`, SHA256 `1cab6547bde40299f62c0b93bd33800aa13d64f56846dd632882091167d77850`. This is not final-stage evidence.
