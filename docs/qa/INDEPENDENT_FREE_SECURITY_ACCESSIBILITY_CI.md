# HSE Verify — no-API-cost independent QA extensions

This extension **reuses** the existing `.github/workflows/independent-full-system-audit.yml`. It does not replace the Masterplan acceptance process.

## Run
1. On GitHub, select **Actions → Independent full-system audit → Run workflow**.
2. Select the isolated QA candidate branch. Do not target a live production deployment.
3. Download the **independent-full-system-audit-<SHA>** artifact after completion.

## New evidence
- `exact-sha-218.json` and `exact-sha-218-summary.json`: canonical frozen 218-scenario ledger, checked against the actual checkout SHA.
- `axe.json`: WCAG automated check of the public homepage and six role login screens at 320, 390, and 1280px.
- `zap/zap.json`, `zap/zap.html`: **passive** OWASP ZAP baseline using synthetic localhost only, no active attack.
- `QA-EXTENSIONS.json` and `QA-EXTENSIONS.md`: unified scanner coverage, findings needing triage, and exact commit.
- Existing `FINAL-AUDIT.json`, browser screenshots, server logs and regression cross-checks remain unchanged as report sources.

The workflow is manually dispatchable, does **not** run a second independent full-app matrix, and runs on GitHub Actions (public repository runner allowance). There is no paid model/API requirement.

## Trust boundaries
- Localhost synthetic data only. No production credentials, provider hooks, public staging ZAP scans, or live customer records.
- ZAP baseline is unauthenticated, spider + passive analysis; it is **not** a complete penetration test.
- Axe WCAG automation is **not** complete accessibility certification or an authenticated six-role UI audit.
- If a scanner fails, results are missing, or high-impact alerts exist, the extra gate fails closed while preserving artifacts.
- Historical or partial Masterplan evidence is **never** counted as fully release verified.
- The independent audit's browser runner uses test/development mode; application production-mode configuration protections remain enabled.

## Existing known-red baseline (2026-11-21)
A manual run at protected QA SHA `7ff30ea140a5145e5d5ba761f7c7aef24c895269`, GitHub run `44915185823`, reported six raw critical and 20 raw high findings. Review identified synthetic test configuration mode conflict, MFA counter replay/timing complications and one sharding test counting a diagnostics-only step. These are not independently validated exploits. Review original artifact before classifying findings as product defects.

**Release verdict remains NO-GO** until 218/218 exact-SHA full verification, signed-in six-role pentest, real provider acceptance, stage load/restore/rollback and owner UAT.
