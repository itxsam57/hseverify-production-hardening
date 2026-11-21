# M1.04.02 — real PDF parser prerequisite for report export Chromium CI (scoped only)

Date: 2026-11-14 Asia/Karachi. Branch `qa/fix-m10402-pdf-parser-ci-20261114` at source PR #90 head `51ddc49cb5ab02e2ffd8943e9f4b2ca46d770fe0` (PR #90 remains OPEN). New isolated worktree used; original PR #90 worktree and existing tests untouched.

**FULLY VERIFIED 0/218 | PENTEST INCOMPLETE | >=10 known BLOCKED_EXTERNAL | RELEASE NO-GO.**

## Actual CI RED recovered

Earlier [PR #90 run 43093164606](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/43093164606), head `7f3b11f085b80462104ef18168b59a2fee1b719b`, real x86 Chromium job `130775161169` FAILED. GitHub API now returned its genuine uploaded browser artifact ID `13890091043` after earlier download/502 failures. It says `parsedReportPdf` from `tests/helpers/report-artifact-inspection.mjs` failed with `result.status === null` (expected 0) when invoking actual `spawnSync("pdftotext", ...)`. That is a **PDF parser subprocess launch failure**, not evidence of a cross-tenant report leak or invalid generated PDF. The original workflow installed Chromium and Node dependencies, but **did not check/install the `pdftotext` Poppler command**. Specific underlying spawn error is not included in that original helper output; don't claim `ENOENT` definitively.

Original current head `51ddc49c` missing `pdftotext -v` in workflow: controlled `rg -n 'pdftotext -v' .github/workflows/m1-04-company-report-tenant-bola.yml` **exit1**. Evidence `.autopilot/artifacts/20261114_PR90_MISSING_PDF_PREREQUISITE_RED.log`. New engineering test `tests/engineering/m10402-report-pdf-ci-runtime.test.mjs` **RED exit1** on missing setup, `.autopilot/artifacts/20261114_PR90_PARSER_DEPENDENCY_TEST_TDD_RED.log`.

## Targeted fix and local verification

- Before actual report browser BOLA/PDF test, workflow runs an explicit test that requires parser setup/real browser integrity assertions; then `command -v pdftotext`, installs `poppler-utils` with `apt-get` **only if missing**, and runs `pdftotext -v` as a fail-closed executable check. Does **not** substitute a mock/parser or weaken PDF byte checks; the real `node --test` Chromium + GitHub artifact failure gating remain.
- `node --test tests/engineering/m10402-report-pdf-ci-runtime.test.mjs`: **1/1 PASS** local; actual `pdftotext -v` **exit0** on authorized Ubuntu workstation, `node --check` PASS, YAML parse PASS, `git diff --check` PASS. Log `.autopilot/artifacts/20261114_PR90_PARSER_DEPENDENCY_TEST_GREEN.log`.
- CI real x86 rerun **not yet verified**. Original PR #90 local independent Company A/B MFA Chromium PDF/CSV/print BOLA test **1/1 PASS** previously, native 1/1, TS/lint PASS; prior SHA evidence is scoped only.

## Next and strict remaining

Commit/push this isolated focused fix through V4 guard, target PR to original `qa/verify-m10402-company-report-bola-20261112` branch, require actual x86 Chromium/native/compliance green on the new head and then separately on PR #90 (do not merge PR #90 while red/queued). Current QA signed release `006ff741cdd531669e2eb9bdae76d254a66deddf` merged PR #92 and passed **27/27 exact merged-SHA GitHub workflows**, but it is still **NO-GO** pending 218/218 full exact-stage, comprehensive pentest, production providers, realistic load/restore and owner UAT. Do not upgrade `M1.04.02` to FULLY_VERIFIED based on this harness repair.
