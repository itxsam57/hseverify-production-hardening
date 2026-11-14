# M1.04.02 — two independently authenticated Company tenants, secure-file HTTP BOLA and capability binding

Date: 2026-11-11 Asia/Karachi. **Source:** signed merged QA `63e3f2582e5a883a671d9034ec0eefade210547c` (PR #87, **23/23 merged exact-SHA CI workflows SUCCESS**). Isolated worktree `hseverify-m10402-tenant-exports-20261111`, branch `qa/verify-m10402-tenant-exports-20261111`, Autopilot V4 session `194aa7ec-8685-4df5-8783-b2f5a3d4ccc9` and cycle `1e9926db9e6347a092a18a2ab779d48e`.

**FULLY VERIFIED 0/218 | M1.04.02 NOT_FULLY_VERIFIED | PENTEST INCOMPLETE | ≥10 BLOCKED_EXTERNAL known | RELEASE NO-GO.** Local actual Chromium/Next/PGlite/private filesystem test adapter, controlled synthetic company identities/data. Not real production object storage, final staging HTTPS or external scan.

## Baseline missing dedicated security verification

There was no `tests/browser/company-secure-files-cross-tenant.browser.test.mjs` on the signed source (git ls-files exit1). Previous Company billing/receipt refund real-browser **1/1**, Worker private report CSV/PDF real-browser **4/4**, tenant repository native **3/3**, signed-file runtime native **5/5** and scan tenant native **3/3** were scoped passing on earlier source but did **not** exercise actual Company A/B file issue/download/preview POST/GET route with signed capability cross-session and persisted audit. This was **test coverage missing**, not proof of an app vulnerability. Baseline raw `.autopilot/artifacts/M10402_COMPANY_FILE_DIRECT_HTTP_COVERAGE_RED_20261111.log`.

## Fresh real authenticated browser and direct HTTP results

`node --test tests/browser/company-secure-files-cross-tenant.browser.test.mjs`: **1/1 PASS, exit 0** on signed source plus focused test addition.

- Two independent active Company tenant/member records and account-specific MFA login forms operated in actual Chromium, at 390px and 320px. PGlite had two separately owned `available` PDF object records with clean-scan lifecycle metadata, physically separate bytes in isolated **local test object storage**. This setup did **not** run an external malware scanner.
- Company A **POST `/api/secure-files/access`** returned 200 for its own file; **GET signed download** returned 200 with exact original bytes. Company B did the same independently. Both tenant-specific objects were confirmed authoritative DB persisted.
- Company B requested A's real existing file reference: **404**. Company B replayed A's previously issued signed capability URL: **404**. Anonymous replay also **404**. The same attempted in reverse (A→B): **404**. Company B forged `x-hse-tenant-id`, `x-hse-account-id`, `x-hse-membership-id` to match Company A: **404**. No foreign file contents returned.
- Signed capability **purpose separation**: a download token used on the preview endpoint was rejected **404**. A legitimate preview token issued correctly and fetched its own file, while B's copied preview token was **404**. Duplicate `access` URL parameters were **404**. Adding forged `tenantId` to the exact two-field JSON request was rejected **400**.
- Via real authenticated Company UI, Company A explicitly signed out. Its previously valid signed file token returned **404** after revocation.
- Final PGlite DB asserted **exactly two tenant-owned available files and six immutable security audit events**, each bound to the correct original account, tenant and file reference. No cross-tenant authorized/served event.
- Raw `.autopilot/artifacts/M10402_TWO_TENANT_SECURE_PDF_HTTP_CHROMIUM_GREEN_20261111.log`. Both test identities and file contents entirely synthetic, no user data or external providers.

## Adjacent source/security regression

Dedicated exact-SHA two-job CI `.github/workflows/m1-04-tenant-private-file-http.yml`: real Chromium two-company HTTP abuse, plus native signed-file access/service/revocation/audit **5 cases**, with retained artifacts. Real browser still required on GitHub x86; no mocks substituted for the browser. Fresh local native secure-file tests **5/5 PASS**, strict `npm run typecheck` PASS and `npm run lint` exit 0 (**0 errors / 9 inherited unrelated warnings**); syntax/YAML/diff PASS. GitHub exact PR-SHA CI is pending. Raw `.autopilot/artifacts/M10402_{SIGNED_FILE_NATIVE5_GREEN,TYPECHECK_GREEN,LINT_EXIT0_WARN9}_20261111.log`.

## Strict remaining gates

- Real production object storage ACL, scanning/malware provider, upload and final staged HTTPS behavior.
- All other tenant-scoped records and filters, Worker files/exports, entire API/role matrix, rate/race/expiry/timeout/retry, stale credentials, XSS/CSRF, signed URL leaks/logging, real provider failures, load/restore.
- Every applicable end-to-end receiving-role notification and audit, full 218 ledger reconciliation on **one** signed release SHA and Owner UAT.

This targeted local success is **NOT M1.04.02 FULLY_VERIFIED**, no release GO is allowed.

## Next

Check native+TS+lint+JS/YAML/diff and V4 guard. Commit/push focused test/workflow/evidence and resume in isolated branch. Require exact PR SHA Chromium/native/Autopilot compliance all green, signed two-parent GitHub merge, and full merged-SHA CI. Then continue M1.04.02 direct tenant filtering/exports and other file workflows; external provider blockers stay explicit.
