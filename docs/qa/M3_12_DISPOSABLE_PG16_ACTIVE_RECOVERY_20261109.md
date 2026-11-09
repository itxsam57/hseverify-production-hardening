# HSE Verify M3.12.04 — actual PostgreSQL active consumer case restoration

Date: 2026-11-09 UTC. Isolated workstation QA, **not** protected staging or provider signoff.
Base QA commit: `0ba89d31b91eb8c7a8bf5cc58cb79c8f8908d377`.
Worktree: `hseverify-m312-release-audit-20261109`; branch `qa/verify-m312-release-20261109`.

## Proven on disposable PostgreSQL 16 (locally)

A cold PostgreSQL custom-format `pg_dump` / `pg_restore` plus copied private object bytes restored an actual in-progress Worker's Assurance Case with:

- submitted short answer and immutable question/version history;
- draft for the next question, position, and revision;
- permanent verified Worker ID and versioned qualification evidence;
- three actual private file objects (PDF, profile photo, selfie) with original SHA-256;
- signed download of restored original bytes for the owning Worker;
- independent foreign Worker read and file access denied.

New regression: `tests/platform/m3-12-active-case-postgres-restore.test.mjs`, now included in the canonical `test:postgres-json` script.

## Verification receipts

- Active-case PG16 + private files test: **1/1 PASS exit 0**. `.autopilot/artifacts/20261109-M312-exact0ba-active-case-actual-PG16-restore.log`.
- Existing nonempty report standard PostgreSQL custom-archive restore: **1/1 PASS exit 0**. `.autopilot/artifacts/20261109-M312-exact0ba-actual-PG16-report-archive-restore-retry.log`.
- Full canonical PostgreSQL integration suite (9 files): **13/13 PASS exit 0** after adding synthetic minimum-length test-only session secret and auth pepper. `.autopilot/artifacts/20261109-M312-exact0ba-full-PG16-suite-retry.log`.
- Strict TypeScript: **PASS exit 0**. ESLint: **PASS exit 0**, 0 errors/9 existing warnings. `.autopilot/artifacts/20261109-M312-active-PG-restore-{typecheck,lint}.log`.
- Initial PostgreSQL fixture failed due overly long Unix socket path; corrected to short workspace path. First full-suite run: 12/13 PASS, runtime-adapter missing required synthetic test-only secrets; corrected harness, entire suite 13/13 PASS. Neither was shown to be an application product defect.

All test database clusters were isolated on random loopback ports and stopped/removed. **No real providers, customer information, protected staging, production database, or other worktrees used.**

## What remains OPEN

**FULLY VERIFIED 0/218; RELEASE NO-GO.** These synthetic/local results are scoped clauses, **not** scenario M3.12.04 full verification. Real protected exact-SHA staging, realistic recovery objectives (RPO/RTO), multi-tenant concurrent live PostgreSQL backup/restore, deployed private object storage durability, incident/rollback runbook execution, monitoring/alerts, real providers, complete six-role feature-by-feature pentest, and Owner UAT remain unverified. Do not mark any of the 218 scenarios fully certified on this evidence.

## NEXT actionable

M3.12.02–.03: verify operational alerting/rollback/release checklist honestly blocks GO without evidence; the Admin UI currently derives `Release readiness: ready` from five self-reported checkboxes even without actual provider, staging, pentest or Owner UAT signoff. Reproduce as a release-gate control defect in isolated browser and address misleading readiness status without claiming real provider certification. Then test real managed staging recovery and provider behavior when credentials become available. Inspect live tests and current QA SHA before running.
