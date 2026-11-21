# M1.04.02 — current signed QA Company A/B generated report isolation + real PDF parser (SCOPED, NOT FULL)

Date: 2026-11-14 Asia/Karachi. Clean signed QA base **`006ff741cdd531669e2eb9bdae76d254a66deddf`** with **27/27 exact merged-SHA GitHub workflows green**. Isolated worktree `hseverify-m10402-report-cleanqa-20261114`, branch `qa/verify-m10402-report-clean-20261114`. V4 cycle `465d819a810f40f5ae49f1bd150b41e6`, session `384f3ee8-26e0-45b9-b9aa-a8b08aefe757`.

**FULLY VERIFIED 0/218 | PENTEST INCOMPLETE | >=10 known BLOCKED_EXTERNAL | RELEASE NO-GO.**

## Why a clean QA integration instead of merging old PR #90
- Original PR #90 (Company report HTTP BOLA) was built from older signed QA `fd5d6bdb...`, not current QA006ff; it had conflicting current QA changes. The nested PR #93's real GitHub x86 Chromium/native/PR compliance all passed after adding the Poppler prerequisite. However its merge commit `389202ba2ee188dfbeee99ed6899e6e0fbfd0134`, while GitHub signature verified, had a nonstandard merge title and failed the repo's exact commit guard in push run `43559186956` (missing recognized Autopilot-Cycle trailer). It must **not** be merged, bypassed or force-rewritten.
- We **preserved** PR #90 and all original worktrees, did not alter application source, and copied only its additive two-company report browser assertions, prior scoped evidence report/TSV, and PR #93's reviewed mandatory PDF-parser CI workflow plus engineering test into a new clean branch based on current QA006ff. Before copying, a diff proved the report browser file contained only **83 added lines**, with no removal of current QA behavior.
- Initial current-QA coverage RED: `rg -n FOREIGN_REPORT_COMPANY tests/browser/report-company-generation.browser.test.mjs` expected exit1; diagnostic artifact `.autopilot/artifacts/20261114_QA006FF_M10402_COMPANY_REPORT_BOLA_COVERAGE_RED.log`. Missing test coverage is **not** a proven product defect.

## Real independent Company browser + direct HTTP (fresh current QA local)
`node --test --test-concurrency=1 --test-name-pattern='An authenticated Company can request, generate and download actual scoped CSV, PDF and printable reports' tests/browser/report-company-generation.browser.test.mjs`: **1/1 PASS, exit0, 61.394s**. Real Chromium, Next forms/actions/API and isolated migrated PGlite; only synthetic MFA tenant fixtures and local private storage.

- Company A actually signed in, queued CSV/PDF/print reports via UI, processed three genuine local report-outbox deliveries, and fetched each **200** with exact private bytes and SHA256 checks; PDF parsed using actual Poppler `pdftotext`.
- Independent Company B MFA-signed in at 390px. Its report list showed zero Company A deliveries. Replaying each real existing foreign CSV/PDF/print ID returned **404**. Forged `tenantId/accountId` query and `x-hse-tenant-id/account-id/active-role=root` headers returned **404**. Anonymous requests each redirected **307**; no original private bytes returned. No HTTP 500 assertion recorded.
- Authoritative DB asserted **3 delivered reports for Company A and 0 for Company B**; original artifact hash checks remained intact. No production object-storage/scanning/provider delivery verified.
- Raw actual Chromium `.autopilot/artifacts/20261114_M10402_QA006FF_ACTUAL_TWO_COMPANY_REPORT_CHROMIUM.log`.

## Adjacent gates on current QA source + focused changes
- Native report tenant membership, permission ceiling and fresh session  **1/1 PASS**, `.autopilot/artifacts/20261114_M10402_QA006FF_NATIVE.log`.
- Mandatory PDF-parser CI prerequisite contract **1/1 PASS**, `.autopilot/artifacts/20261114_M10402_QA006FF_PDF_PREREQ.log`.
- Strict `npm run typecheck` PASS; `npm run lint` exit0 **0 errors / 9 inherited warnings**.
- `npm run audit:current-218-scenarios` exit0, immutable 218 IDs/37 bricks, **0 FULLY_VERIFIED, 1 IN_PROGRESS, 10 known BLOCKED_EXTERNAL, 207 NOT_STARTED, NO_GO** on base SHA006ff with focused uncommitted changes; machine-readable ignored artifact `.autopilot/artifacts/current-release-218-ledger.json`.
- Real x86 Chromium/native/Autopilot GitHub PR-head and signed merged-SHA checks are **NOT YET performed** on this new candidate; they are mandatory next. Local suite before commit is scoped evidence, not exact signed final staging proof.

## Next exact action
Guarded commit/push only the additive Company A/B report test, actual PDF parser requirement, engineering test, prior historical (clearly labelled) scoped evidence, this report and current checkpoint. Require exact GitHub PR x86 real Chromium/native/compliance and branch-push compliance PASS. Merge via **GitHub's canonical signed two-parent merge title** only after all green; then independently verify all GitHub workflows on the new merged SHA. Mark old PR #90 superseded **only after replacement is proven**, never forge its pass. Remaining six-role/full API, stage/providers, realistic concurrency/load/restore, full pentest and Owner UAT block release.
