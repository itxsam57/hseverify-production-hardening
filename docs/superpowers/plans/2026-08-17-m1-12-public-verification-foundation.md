# M1.12 Public Verification Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the frozen Milestone 1 public verification foundation: Worker ID lookup, privacy-safe public projection, abuse controls, opaque result/QR routes, concern triage with optional scanned evidence, and permanent release gates.

**Architecture:** Add one dedicated `src/lib/public-verification` boundary. Reuse the immutable M1.07 Worker ID authority and M1.06 private upload/scan primitives; do not bypass authenticated repositories. Public result authority is a short-lived authenticated-encrypted capability, while server-owned rate limits and concern intake are durable in M1.12-owned tables.

**Tech Stack:** Next.js App Router 16.2.12, React 19.2.8, TypeScript 6.0.3, direct SQL repository layer, PGlite/PostgreSQL migrations, Node crypto, existing M1.05 audit and M1.06 secure-file pipeline.

## Global Constraints

- Frozen Phase 1 scope controls; no M2/M3 credential issuance, Living Record, scoped sharing, review decisions, assessment or interview authority.
- Worker IDs come only from `worker_identity_worker_ids`.
- Public not-found must be neutral and non-enumerating.
- Public data excludes passport/national ID numbers, full DOB, address, contacts, assessment answers, integrity methods/thresholds, reviewer notes, private employment/company data and unpublished scores.
- Public result states are exactly `valid`, `expired`, `suspended`, `revoked`, `not_found_or_invalid`, `temporarily_unavailable`.
- Result URLs use opaque authenticated encryption; no raw account/identity-version/tenant/evidence/storage ID is route authority.
- Camera access is explicit user activation only; manual lookup always remains available.
- Concern creation is idempotent and creates a triage intake record; optional evidence must pass the existing quarantine/malware-scan lifecycle before binding.
- No public evidence preview/download route.
- Root-cause fixes only; never weaken accepted M1.01–M1.11 tests.
- Exact-head targeted/full gates, expected-head merge lock and merged-main full gate are mandatory before engineering release.

---

### Task 1: Domain, projection and capability RED→GREEN

**Files:**
- Create: `tests/platform/public-verification-domain.test.mjs`
- Create: `src/lib/public-verification/public-verification-domain.ts`
- Create: `src/lib/public-verification/public-verification-capability.ts`
- Modify: `scripts/run-public-verification-tests.mjs` once the first test exists.

**Interfaces:**
- Produces: `normalizePublicVerificationIdentifier(raw: string): PublicVerificationIdentifier | null`
- Produces: `mapWorkerIdentityStatusToPublicStatus(status: string): PublicVerificationStatus`
- Produces: `projectPublicWorkerVerification(row, verifiedAt): PublicWorkerVerificationProjection`
- Produces: `mintPublicVerificationCapability(input, now): string`
- Produces: `verifyPublicVerificationCapability(token, now): PublicVerificationCapabilityPayload | null`

- [ ] **Step 1: Write the failing domain test**

Create tests that assert:

```js
assert.deepEqual(PUBLIC_VERIFICATION_STATUSES, [
  "valid", "expired", "suspended", "revoked",
  "not_found_or_invalid", "temporarily_unavailable"
]);
assert.equal(normalizePublicVerificationIdentifier(" worker_id_ABCDEFGHIJKLMNOPQRSTUVWX ")?.kind, "worker");
assert.equal(normalizePublicVerificationIdentifier("not-an-id"), null);
assert.equal(mapWorkerIdentityStatusToPublicStatus("verified"), "valid");
assert.equal(mapWorkerIdentityStatusToPublicStatus("expired_document"), "expired");
assert.equal(mapWorkerIdentityStatusToPublicStatus("suspended"), "suspended");
assert.equal(mapWorkerIdentityStatusToPublicStatus("manual_review"), "not_found_or_invalid");
```

Also construct an internal row containing `workerAccountId`, `identityId`, `identityVersionId`, DOB, nationality, email, phone, employer and secure-file fields; assert the projection object's keys are exactly the public allow-list and none of those private values appear in `JSON.stringify(projection)`.

- [ ] **Step 2: Run the test and prove RED**

Run `node scripts/run-public-verification-tests.mjs` after the runner is created. Expected failure: missing `src/lib/public-verification/public-verification-domain.ts`.

- [ ] **Step 3: Implement bounded domain types**

Implement the fixed identifier/status vocabulary and strict projection builder. `displayName` is legal first + last name only; `competencyTitle=null`, `expiresAt=null`, `restrictions=[]` for M1.12 Worker-ID verification.

- [ ] **Step 4: Add capability tests before implementation**

Test that:

```js
const token = mintPublicVerificationCapability({
  identifierKind: "worker",
  normalizedIdentifier: workerId
}, now);
assert.ok(!token.includes(workerId));
assert.deepEqual(verifyPublicVerificationCapability(token, plusMinutes(now, 5))?.normalizedIdentifier, workerId);
assert.equal(verifyPublicVerificationCapability(tamper(token), now), null);
assert.equal(verifyPublicVerificationCapability(token, plusMinutes(now, 11)), null);
```

- [ ] **Step 5: Implement AES-256-GCM public capability**

Derive a 32-byte key from the configured server secret with a fixed M1.12 context. Payload version is `1`, purpose is exactly `public-verification-result`, lifetime is at most 10 minutes, and token parsing has a bounded byte/string ceiling before decrypting.

- [ ] **Step 6: Run domain suite GREEN**

Run `node scripts/run-public-verification-tests.mjs`. Expected: all Task 1 tests pass.

- [ ] **Step 7: Commit**

Commit only domain/capability/test/runner changes with `feat: add public verification domain boundary`.

---

### Task 2: Durable rate-limit and concern schema RED→GREEN

**Files:**
- Create: `database/migrations/0031_public_verification_foundation.up.sql`
- Create: `database/migrations/0031_public_verification_foundation.down.sql`
- Create: `tests/platform/public-verification-migration.test.mjs`
- Create: `tests/platform/public-verification-rate-limit.test.mjs`
- Create: `src/lib/public-verification/public-verification-repository.ts`

**Interfaces:**
- Produces: `PublicVerificationRepository.consumeRateLimit(input): Promise<number>`
- Produces: `PublicVerificationRepository.findPublicWorkerByPermanentId(workerId): Promise<PublicWorkerSourceRow | null>`
- Produces: `PublicVerificationRepository.createConcern(input): Promise<PublicVerificationConcern>`

- [ ] **Step 1: Write migration RED**

Test full migration stack through `0031_public_verification_foundation` and assert existence/shape of:
- `public_verification_rate_limits` primary key `(action, bucket_key)`;
- `public_verification_concerns` with opaque concern ID, subject reference hash, category, description/contact, fixed `received` status and unique idempotency key;
- immutable concern identity/provenance trigger;
- no foreign-key deletion cascade into accepted M1.07/M1.11 history.

- [ ] **Step 2: Run migration test and prove RED**

Expected: migration `0031_public_verification_foundation` is missing.

- [ ] **Step 3: Implement additive migration**

Use fixed rate-limit actions `lookup`, `result`, `concern`, `concern_upload`. Keep bucket keys 64-char lowercase hex. Concern IDs use `public_concern_` + 24 opaque characters. Concern categories are a fixed small vocabulary: `identity_mismatch`, `suspected_fraud`, `status_dispute`, `document_concern`, `other`.

- [ ] **Step 4: Write atomic concurrency RED**

Fire concurrent `consumeRateLimit` calls against one bucket and assert the returned/final count reflects every request. Then cross-check a second action and second bucket remain isolated.

- [ ] **Step 5: Implement SQL atomic counter**

Use `INSERT ... ON CONFLICT ... DO UPDATE` with SQL window reset, matching the proven auth rate-limit concurrency pattern but in the M1.12 table.

- [ ] **Step 6: Prove Worker lookup SQL is allow-list-only**

Add a test that seeds a verified Worker identity + permanent Worker ID + private draft fields. `findPublicWorkerByPermanentId` must return only public source fields required to build the projection; the repository type/query must not select DOB, nationality, residence, email, phone, previous legal name, evidence, employment or secure-file metadata.

- [ ] **Step 7: Run Task 2 suite GREEN**

Run migration/rate-limit/public lookup tests, including rollback/reapply and persistent PGlite restart.

- [ ] **Step 8: Commit**

Commit with `feat: add public verification persistence boundary`.

---

### Task 3: Public lookup service RED→GREEN

**Files:**
- Create: `src/lib/public-verification/public-verification-service.ts`
- Create: `src/lib/public-verification/public-verification-request.ts`
- Create: `tests/platform/public-verification-service.test.mjs`

**Interfaces:**
- Produces: `lookupPublicVerification(input): Promise<PublicVerificationLookupResult>`
- Produces: `resolvePublicVerificationCapability(token): Promise<PublicVerificationResult>`
- Produces: `publicVerificationRequestFingerprint(headers): string`

- [ ] **Step 1: Write non-enumeration RED**

Assert malformed Worker ID, unknown well-shaped Worker ID, credential-shaped identifier without a real credential source, and non-public Worker lifecycle all return the same `not_found_or_invalid` public shape and no internal reason.

- [ ] **Step 2: Write rate-limit-order RED**

Use a spy repository and assert the request-fingerprint bucket is consumed before `findPublicWorkerByPermanentId`. When the request bucket exceeds its threshold, assert the repository lookup is never called and the result is `temporarily_unavailable`.

- [ ] **Step 3: Implement request fingerprint hashing**

Bound IP/user-agent inputs, combine them server-side, hash with purpose-separated server secret, and never persist plaintext IP or user-agent in rate-limit rows.

- [ ] **Step 4: Implement lookup orchestration**

Request bucket → normalize → identifier bucket → allow-list query → public status map → mint encrypted result token. A successful lookup returns only redirect token + generic status; the actual projection is resolved fresh from the token on result render.

- [ ] **Step 5: Write copied/tampered/stale result RED**

Assert copied valid token resolves only while live, tampered/expired token returns neutral safe miss, and a Worker moved to suspended after token issuance renders `suspended` on later result resolution.

- [ ] **Step 6: Run service suite GREEN**

Run all public-verification domain/repository/service tests.

- [ ] **Step 7: Commit**

Commit with `feat: add non-enumerating public verification service`.

---

### Task 4: `/verify`, opaque result and QR route RED→GREEN

**Files:**
- Create: `src/app/verify/page.tsx`
- Create: `src/app/verify/actions.ts`
- Create: `src/app/verify/result/[publicToken]/page.tsx`
- Create: `src/app/verify/qr/[publicToken]/page.tsx`
- Create: `src/components/public-verification/public-verification-form.tsx`
- Create: `src/components/public-verification/public-qr-scanner.tsx`
- Create: `tests/platform/public-verification-routes.test.mjs`
- Modify: `src/app/verify/worker/[workerId]/page.tsx`

**Interfaces:**
- Server Action: `verifyPublicIdentifierAction(previousState, formData)`
- QR client emits one decoded HSE Verify token/identifier to the existing manual submission path.

- [ ] **Step 1: Write route/static UX RED**

Assert `/verify` exists with one manual identifier input, `Verify` action, `Scan QR` activation control, public-data privacy copy and no automatic camera call. Assert old `/verify/worker/[workerId]` cannot directly serialize Worker data and instead redirects to/calls the new safe verification boundary.

- [ ] **Step 2: Implement `/verify` manual flow**

Server Action reads only the identifier plus server request metadata. Success redirects to `/verify/result/[token]`. Miss/unavailable renders safe state without raw identifier in URL query params.

- [ ] **Step 3: Implement result route**

Resolve capability and live public projection server-side. Render status, public identifier, approved display name, issue date, expiry if present, competency if present, restrictions if present, and verification timestamp. Never expose private fields in the component props.

- [ ] **Step 4: Implement QR route base**

`/verify/qr/[publicToken]` validates the same encrypted capability and redirects to the canonical result route or `/verify` safe miss. It contains no second lookup path.

- [ ] **Step 5: Implement explicit camera activation**

Client component calls `navigator.mediaDevices.getUserMedia` only inside a click handler. Use native `BarcodeDetector` when available; unsupported/denied state shows a non-blocking message and manual input remains usable. Never upload frames.

- [ ] **Step 6: Run route tests + typecheck GREEN**

Run `test:m1-12`, strict TypeScript and lint. Route changes must not require manual refresh.

- [ ] **Step 7: Commit**

Commit with `feat: add public verification routes and QR foundation`.

---

### Task 5: Concern triage RED→GREEN

**Files:**
- Create: `src/app/verify/concern/page.tsx`
- Create: `src/app/verify/concern/actions.ts`
- Create: `src/components/public-verification/public-concern-form.tsx`
- Extend: `src/lib/public-verification/public-verification-domain.ts`
- Extend: `src/lib/public-verification/public-verification-service.ts`
- Extend: `src/lib/public-verification/public-verification-repository.ts`
- Create: `tests/platform/public-verification-concern.test.mjs`

**Interfaces:**
- Produces: `submitPublicVerificationConcern(input): Promise<{ concernReference: string }>`
- Server Action accepts opaque result token, fixed category, bounded description/contact fields and browser idempotency nonce only.

- [ ] **Step 1: Write concern authority RED**

Assert browser-supplied account ID, identity ID, tenant ID, evidence ID or storage key is ignored/rejected. Only a valid public result token can bind a concern subject. Invalid/expired token returns neutral failure.

- [ ] **Step 2: Write idempotency RED**

Submit the exact same nonce + valid result twice concurrently and assert one concern row is created and both calls resolve to the same opaque concern reference.

- [ ] **Step 3: Implement bounded concern validation**

Category fixed to the migration vocabulary; description 10–4000 chars; contact name/email/phone individually bounded and optional except at least one contact method is required. Strip control characters; never treat HTML as trusted markup.

- [ ] **Step 4: Implement transaction**

Resolve public token → consume concern rate bucket → hash subject reference → insert idempotent concern → append centralized audit event atomically. M1.12 does not create reviewer outcomes/assignment.

- [ ] **Step 5: Implement concern form**

`Report a Concern` on result page links to `/verify/concern?ref=<opaque-token>`. Form preserves user input on validation failure, disables duplicate submit while pending, and displays an opaque concern reference on success.

- [ ] **Step 6: Run concern suite GREEN**

Run concurrent/idempotency/audit/privacy tests.

- [ ] **Step 7: Commit**

Commit with `feat: add public verification concern intake`.

---

### Task 6: Optional concern evidence through M1.06 RED→GREEN

**Files:**
- Modify: `database/migrations/0031_public_verification_foundation.up.sql` only before migration is accepted, otherwise add `0032_public_verification_concern_evidence` and preserve 0031 checksum.
- Modify narrowly: `src/lib/secure-files/secure-file-domain.ts`
- Create: `src/lib/public-verification/public-concern-file-service.ts`
- Extend: `src/lib/public-verification/public-verification-repository.ts`
- Create: `tests/platform/public-verification-concern-evidence.test.mjs`

**Interfaces:**
- Produces branded server-only `PublicConcernUploadAuthority` bound to one received concern.
- Produces `uploadConcernEvidence` and `finalizeConcernEvidenceCandidate` using existing M1.06 validation/quarantine/scan lifecycle.

- [ ] **Step 1: Write private evidence RED**

Assert PDF/PNG/JPG/JPEG are independently validated and an uploaded file is only a pending concern candidate until `platform_secure_files.lifecycle_status='available'`. Unsafe/failed/pending file never binds.

- [ ] **Step 2: Write authority/isolation RED**

Assert copied concern IDs, expired public result tokens, browser-selected file IDs/reservation keys and cross-concern candidates cannot bind. Assert no public signed preview/download route exists for concern evidence.

- [ ] **Step 3: Add narrowly branded public-concern secure-file authority**

Do not weaken existing Worker/Company role ownership. If extending the M1.06 table owner shape would violate accepted invariants, use an M1.12-owned concern-file metadata row referencing the existing secure-file reservation only through a server-created intake authority and prove the same quarantine/scan constraints in SQL. The chosen implementation must still use M1.06 private object bytes/scanner and must not create public object access.

- [ ] **Step 4: Write retry-deadlock RED**

A terminal unsafe/scan-failed candidate must not permanently lock the concern evidence slot against a later clean retry.

- [ ] **Step 5: Implement upload/finalization**

Reuse accepted upload policy and scan scheduling. Only finalization after `available` creates the concern evidence binding. Replacement/history is append-only.

- [ ] **Step 6: Run M1.06 + M1.11 + M1.12 evidence suites GREEN**

This task must prove it did not weaken secure-file or async-candidate behavior.

- [ ] **Step 7: Commit**

Commit with `feat: add scanned public concern evidence intake`.

---

### Task 7: Permanent M1.12 gate and governance correction

**Files:**
- Create: `scripts/check-public-verification-foundation.mjs`
- Complete: `scripts/run-public-verification-tests.mjs`
- Create: `.github/workflows/m1-12-targeted-ci.yml`
- Modify: `package.json`
- Modify: `scripts/check-engineering-automation.mjs`
- Modify: `docs/NEXT_BUILD_UNIT.md`
- Modify: `docs/IMPLEMENTATION_STATUS.md`
- Modify: `docs/bookmarks/MILESTONE_PATH.md`
- Modify: `docs/engineering/PROJECT-PROFILE.md`
- Modify: `docs/engineering/PROJECT-TEST-MATRIX.md`
- Modify: `docs/engineering/HSE_BUILD_MEMORY.md`

**Interfaces:**
- `npm run check:m1-12`
- `npm run test:m1-12`

- [ ] **Step 1: Create fail-closed source guard**

Guard required routes, domain/repository/service, migration, test files, fixed public result vocabulary, public-field exclusions, rate-limit SQL, concern triage, explicit camera activation, no public evidence download, and no later M2/M3 authority.

- [ ] **Step 2: Wire permanent scripts**

Add `check:m1-12` to `verify:quick` and full `check`; add `test:m1-12` to integration and full `check`. Update engineering automation required-file/script markers.

- [ ] **Step 3: Add targeted CI**

PR/push/manual workflow checks out exact verified SHA and runs `npm ci --no-audit --no-fund`, `npm run check:m1-12`, `npm run test:m1-12`, `npm run typecheck`, `npm run lint`.

- [ ] **Step 4: Correct concern governance wording**

The frozen spec requires `Report a Concern` to create a triage case. Replace earlier M1.12 governance wording that described only a `/contact` handoff. Keep M2 review decision/queue ownership explicitly blocked.

- [ ] **Step 5: Run targeted gate GREEN**

Require all M1.12 tests pass, strict TypeScript pass and lint with zero errors introduced by M1.12.

- [ ] **Step 6: Commit**

Commit with `test: make M1.12 a permanent release gate`.

---

### Task 8: Exact-head review, full release proof and merge

**Files:**
- Update only release-evidence/governance docs after proof; no product behavior changes after exact-head verification unless the gate is restarted.

**Interfaces:**
- Exact head SHA is immutable during final review/gates.

- [ ] **Step 1: Run exact-head targeted M1.12 CI**

Require successful job and inspect fresh logs for explicit test count, 0 failures, typecheck and lint.

- [ ] **Step 2: Run exact-head full Engineering gate**

Require M1.01–M1.12 application tests, production audit, strict TypeScript, lint, development/runtime smokes, optimized production build, preview smoke and release manifest.

- [ ] **Step 3: Review the exact diff**

Check public field leakage, enumeration, capability crypto, rate-limit concurrency, concern privacy/idempotency, secure-file isolation, migration ownership, QR/camera permission behavior, route refresh behavior and no M2/M3 scope leakage.

- [ ] **Step 4: Record PR evidence without changing product head**

Update PR body/comment with exact SHA and run IDs. Add a comment review for engineering findings; do not fabricate an external approval.

- [ ] **Step 5: Mark PR ready and recheck head**

If head differs from verified SHA, restart targeted/full verification.

- [ ] **Step 6: Merge with expected-head lock**

Use `expected_head_sha=<verified SHA>`. GitHub must reject if head moved.

- [ ] **Step 7: Run merged-main full Engineering gate**

Require the complete gate on the exact merge SHA and recheck `main` did not move underneath the evidence.

- [ ] **Step 8: Advance state to engineering released, owner acceptance deferred**

M1.12 becomes `IMPLEMENTATION MERGED — ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED`. Formal DONE count remains 7/12 until the combined Milestone 1 browser acceptance.

- [ ] **Step 9: Begin combined Milestone 1 owner/browser acceptance only after engineering release**

Test deferred M1.08–M1.12 visible workflows together. Do not infer owner PASS from CI.