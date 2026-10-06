# WORKFLOW-001 — current bounded implementation contract

The overall goal is to finish the frozen HSE Verify Masterplan. Whole-project completion requires actual workflow evidence, exact clean verification and applicable real UI, purpose, security and deployment gates. The working ledger now has 35 passed, 14 partial and 169 unverified scenarios (accepted baseline: 34/15/169; current slice still needs exact candidate acceptance); the product is not consumer-ready.

## Accepted baseline

PR26 was accepted at ecf2ccf698907bb5004859494ac1f5ec4eb2e43a and merged at 260e6f04ad21450b3a67b27c0dec32cf2e5c92e8. All 15 exact local cohorts, four actual QA jobs and both compliance runs passed. The native cohort contained 50 tests, not the previously recorded 51. Historical assessment-timeout and privacy work remains in Git history and the scenario ledger.

## Current slice: M1.02.01 contact and demo intake

Implement one validated public contact/demo form, an opaque receipt and a private paginated Admin/Root queue for manual staff follow-up. Preserve credential-concern reporting. Submission, atomic email/IP quotas and required immutable audit must commit together; duplicates must not create another request, quota consumption or audit. Recheck active account, exact role and live session when reading the queue. Do not claim that email was sent or a meeting booked.

Use the existing database, audit, authorization and request-fingerprint foundations. Retain drafts after rejection, wait for hydration before accepting controlled inputs, use stable explicit labels and test actual denial destinations. No new dependency, provider, CRM or runner configuration is required.

Working checks must cover native validation/ownership/quota/rollback/retry, real public-to-staff browser records, existing credential concerns/navigation, types and lint. A committed candidate additionally needs build/preview/engineering/security checks, exact recorded gates, independent review and fresh applicable CI before merge. Keep tests on isolated databases and free ports with owned process groups; preserve the existing application on port 3000.

Proxy trust, production abuse resistance, actual staff follow-up, live providers and PostgreSQL concurrency remain separate unverified boundaries. Read CURRENT_TASK and ACTIVE_RESUME for the latest stage; do not interpret prototype or cancelled-run evidence as accepted deployment or whole-project readiness.
