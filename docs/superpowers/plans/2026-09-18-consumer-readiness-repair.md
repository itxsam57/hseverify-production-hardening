# HSE Verify Consumer-Readiness Root-Cause Repair Plan

> **For agentic workers:** Execute inline task-by-task with test-first development. Steps use checkboxes for durable tracking.

**Goal:** Remove every confirmed release blocker with the smallest root-cause change, prove each fix in automated and live browser tests, and leave a resumable evidence ledger.

**Architecture:** Preserve the existing domain/repository/service boundaries. Prefer additive migrations and narrowly scoped contract corrections; do not fake tenant identity, hide provider outages, or weaken authorization. Each task must pass a reproducing test before its checkbox becomes complete.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, PostgreSQL/PGlite, Node test runner, Playwright.

**Spec:** `docs/Masterplan(HSE Verify).md`

## Global Constraints

- The masterplan is authoritative where current tests or implementation disagree.
- Write and run a failing regression test before production code.
- Use additive database migrations; never rewrite an applied migration.
- Preserve portal isolation and worker ownership checks.
- Mark an item complete only with focused automated evidence, full gate evidence, and live browser/API evidence where applicable.
- Do not claim providers are production-ready without real credentials and successful health checks.

---

### Task 1: Standalone Worker Privacy

**Root cause:** Worker privacy was modeled as tenant-owned even though workers are globally owned and can exist without company membership.

**Files:**
- Modify: `tests/platform/privacy-operations-runtime.test.mjs`
- Modify: `src/lib/privacy/privacy-operations-domain.ts`
- Modify: `src/lib/privacy/privacy-operations-service.ts`
- Modify: `src/lib/privacy/privacy-operations-repository.ts`
- Modify: `src/app/worker/(portal)/privacy/actions.ts`
- Create: `database/migrations/0064_worker_owned_privacy_scope.up.sql`
- Create: `database/migrations/0064_worker_owned_privacy_scope.down.sql`

- [ ] Add a failing test proving a worker with no tenant can list, create, and own privacy/accommodation records.
- [ ] Verify the test fails specifically on the tenant requirement.
- [ ] Make tenant scope nullable only for worker-owned privacy/accommodation records.
- [ ] Keep worker ownership mandatory and keep retention jobs tenant-bound.
- [ ] Run focused privacy and migration-stack tests.
- [ ] Apply migrations to a disposable database and test page actions.
- [ ] Verify the live Worker Privacy journey.

### Task 2: Migration Integrity and Credential APIs

**Root cause:** The deployed schema is behind the code, migration 0057 has a checksum mismatch, and duplicate numeric prefixes obscure ordering. Credential queries select columns absent from the deployed database.

- [ ] Capture the exact recorded/current checksum and migration ledger from the deployed database.
- [ ] Determine the historical 0057 SQL from Git and classify the checksum drift; do not whitelist it until semantic equivalence is proven.
- [ ] Add a migration-lineage test that rejects duplicate numeric prefixes.
- [ ] Add a deployment preflight that blocks startup/release when migrations are mismatched or pending.
- [ ] Repair the live ledger safely, apply pending migrations, and verify credential columns.
- [ ] Map schema-unavailable credential failures to a bounded 503 response; preserve 404 for unknown IDs.
- [ ] Retest credential detail and PDF APIs locally and live.

### Task 3: Company Registration Failure

**Root cause:** Fresh unique registrations fail inside a broad catch block that hides the actual database/provider exception.

- [ ] Add structured error logging with a correlation ID at the action/service boundary, without leaking secrets to the user.
- [ ] Reproduce once with a fresh unique registration and capture the precise failing statement.
- [ ] Add a failing regression test for that exact failure.
- [ ] Apply the minimal schema or transaction fix.
- [ ] Verify no partial account, tenant, membership, or case remains after failure.
- [ ] Retest registration, OTP verification, duplicate claims, expiry, and login in browser.

### Task 4: Integrity Capture and Permissions

**Root cause:** `/integrity` is a public developer harness while the global Permissions-Policy disables camera and microphone.

- [ ] Add tests for route authorization and permission policy on integrity capture routes.
- [ ] Move simulation controls to test-only code or remove them from production.
- [ ] Integrate the real integrity UI with assessment/interview session state.
- [ ] Scope camera/microphone permission to the exact routes that require it; keep it disabled elsewhere.
- [ ] Verify allow, deny, unavailable, retry, and degraded flows in Chromium.

### Task 5: Security Headers

- [ ] Add a failing header contract test for CSP and production HSTS.
- [ ] Add a nonce-compatible CSP and production-only HSTS without breaking Next.js assets.
- [ ] Retest auth, uploads, notifications, PDF, and integrity routes.
- [ ] Verify live headers over HTTPS.

### Task 6: Navigation, Raw UI, and Copy

- [ ] Add Worker Privacy and Share Links to desktop/mobile navigation.
- [ ] Replace raw styling on access-denied, sessions, share links, and integrity surfaces using existing design-system classes.
- [ ] Resolve provisional/permanent Worker ID wording against the masterplan.
- [ ] Run keyboard, mobile overflow, focus, contrast, and screen-reader smoke checks.

### Task 7: Test Harness and CI Truthfulness

- [ ] Replace fixed retrospective Worker credentials with deterministic fixture creation.
- [ ] Add deployed-database migration parity to browser test setup.
- [ ] Add live registration/privacy/credential/integrity smoke tests.
- [ ] Make lint warnings release-visible and document accepted exceptions.
- [ ] Configure GitHub CI for this branch and require the verified gate before merge.
- [ ] Update stale status/memory/test-matrix documents from executable evidence.

### Task 8: Provider and Release Readiness

- [ ] Configure real email, SMS, storage, malware scanning, identity, video, and payment providers.
- [ ] Verify each provider health check and one real end-to-end delivery.
- [ ] Run the full automated gate and all masterplan journeys.
- [ ] Run responsive, accessibility, security, recovery, concurrency, and cross-role isolation tests.
- [ ] Publish a final defect closure report; release only when no P0/P1 blocker remains.
