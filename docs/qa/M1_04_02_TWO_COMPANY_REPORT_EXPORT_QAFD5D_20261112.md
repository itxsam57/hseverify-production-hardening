# M1.04.02 — independently authenticated Company tenant cannot fetch another Company's generated report artifacts (SCOPED ONLY)

Date 2026-11-12 Asia/Karachi. **Source signed QA** `fd5d6bdb7fedf133288bbf8fc8e86267a6cde9e6` (PR #89 signed two-parent verified GitHub merge, **26/26 merged exact-SHA workflows PASS**). Isolated `hseverify-m10402-company-report-bola-20261112`, branch `qa/verify-m10402-company-report-bola-20261112`, V4 audit `3ce5fd9e-31a8-4d2f-b549-466b02940f30`, cycle `3e29ae4034264e2e9476a30f3216e753`. Only synthetic fixture accounts, local actual Chromium/Next/PGlite and private test object storage; no real provider.

**FULLY VERIFIED 0/218 | M1.04.02 NOT FULLY VERIFIED | PENTEST INCOMPLETE | ≥10 known BLOCKED_EXTERNAL | RELEASE NO-GO.**

## Baseline coverage gap (not an exploit)

Existing `tests/browser/report-company-generation.browser.test.mjs` verified actual owner Company CSV/PDF/print queue, outbox generation, private artifact hash and bytes, visible UI downloads, missing/queued 404/409, and live revocation of the owner's export permission. It lacked any **second independent Company MFA tenant replaying actual existing delivered report IDs**. `rg -n M10402_REPORT_FOREIGN_COMPANY_DENIED` was expected exit1 before test addition. This is **test-only missing coverage**, not an application defect. Raw `.autopilot/artifacts/M10402_REPORT_CROSS_TENANT_HTTP_BASELINE_RED_20261112.log`.

## Fresh actual browser + direct authenticated HTTP negative/positive

Command `node --test --test-name-pattern='An authenticated Company can request, generate and download actual scoped CSV, PDF and printable reports' tests/browser/report-company-generation.browser.test.mjs` -> **1/1 PASS, exit0** on signed QA base plus focused browser test.

- Company A: actual MFA form sign-in, queued **three** report formats through real Company UI, processed real `report.generation` outbox, persisted exact private local storage bytes and content hashes; `GET /api/company/reports/[reportId]/export` **200 exact CSV/PDF/print bytes** and visible browser CSV/PDF download plus safe printable popup. Existing source hygiene and permission-deny checks retained.
- Independently active **Company B**: distinct tenant and membership, independent account/MFA login at 390px. Its report workspace had **zero** A report rows. For **each of three exact existing A report IDs**, B's direct GET returned **404**, no A artifact bytes. Attacker-forged `tenantId/accountId` query parameters and `x-hse-tenant-id/account-id/active-role=root` headers **also 404**, no private bytes. This tested actual HTTP BOLA, not merely a missing UI link.
- An anonymous browser context GET of all three copied actual report export URLs returned **307** without owner bytes. No HTTP 500s or browser page errors.
- Final authoritative PGlite DB confirmed **3 delivered reports for original A tenant, zero report records for B**. Existing report artifact content digest assertions and A's later permission-revoked download denial still passed.
- Raw actual Chromium `.autopilot/artifacts/M10402_TWO_COMPANY_GENERATED_REPORT_HTTP_CHROMIUM_GREEN_20261112.log`.

## Adjacent native and quality tests

- `node --test --test-name-pattern='Member scope, tenant isolation, permission ceiling and fresh session checks hold at the report boundary' tests/platform/report-company-generation-runtime.test.mjs`: **1/1 PASS**, native exact tenant-scoped report access, live permission/sessions. Raw `.autopilot/artifacts/M10402_COMPANY_REPORT_TENANT_NATIVE_GREEN_20261112.log`.
- `npm run typecheck` PASS (strict TS/Next-generated routes), `npm run lint` exit0 (**0 errors, 9 inherited unrelated warnings**), source `node --check`, two-job GitHub YAML parse and `git diff --check` PASS. Raw `.autopilot/artifacts/M10402_COMPANY_REPORT_{TYPECHECK_GREEN,LINT_EXIT0_WARN9}_20261112.log`.
- Exact-PR/merged-SHA two-job workflow `.github/workflows/m1-04-company-report-tenant-bola.yml` runs the real x86 Chromium targeted report generation/download test and native report tenant checks, retaining logs. CI is **pending until it runs**.

## Strict limitations and next action

Synthetic local private filesystem; external storage/scan/mail provider and final HTTPS production staging are **not tested**. Also missing full matrix of report definitions/filters/exports across all roles, cross-role receiving/audit/notification, API replay/race/expiry/restore/load, all 218 scenarios on final exact SHA and owner UAT. No release signoff.

Next: V4 guarded commit/push only focused test, exact-SHA CI, report/TSV/resume. Require every exact PR-head x86 browser/native/compliance check green before signed two-parent GitHub merge, then independently verify every merged SHA workflow; continue remaining M1.04.02 API/role/tenant matrix and pentest. **NO-GO, 0/218 FULL.**
