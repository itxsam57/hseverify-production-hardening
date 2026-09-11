# M1.11 Worker Evidence Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/worker/evidence` with integrated qualification, experience, employment, skill and leaving-letter records, exact secure-file binding, immutable history and permanent M1.11 regression coverage.

**Architecture:** Add a stable Worker-owned evidence record plus immutable typed version model, with shared attachment binding to the already accepted M1.06 secure-file pipeline. Worker actions derive ownership from the live Worker principal, submitted versions are never edited in place, ending/inactivating preserves history, and M1.11 introduces no reviewer-verification workflow.

**Tech Stack:** Next.js 16 App Router, React, TypeScript strict mode, PostgreSQL/PGlite migrations, existing authorization/audit/secure-file services, Node test runner, GitHub Actions Node 24.

## Global Constraints

- Base only on `main@3b32287fecb30f16d682cb130be0e8f1eb466616`, the M1.10 merged-main Engineering Green boundary.
- Canonical Phase 1 scope is frozen. No M1.12 or M2 feature implementation.
- `/worker/evidence` is the canonical Worker route for qualifications, experience, employment, skills and leaving letters.
- Qualification metadata and certificate upload must be on the same draft surface and remain bound to the exact record/version.
- Multiple experience/employment records are supported.
- Ending employment changes status/end date and never deletes history.
- Skill states `self_declared`, `evidence_verified`, `competency_assessed` remain distinct; Worker writes in M1.11 may only create/retain `self_declared`.
- Leaving letters bind to one exact employment and must not leak between employer forms.
- Reuse M1.06 secure upload/quarantine/scan/private-file pipeline; no parallel upload/storage system.
- Reuse live Worker session authorization; browser-supplied owner/account authority is forbidden.
- Submitted evidence history is immutable and versioned; no destructive record delete path.
- Centralized `DatabaseAuditRepository` only; no direct `platform_audit_events` inserts from service code.
- Retained M1.11 tables must not hard-reference reversible lower bricks such as auth or secure-file tables.
- M2.02 owns Reviewer evidence verification queues and decisions.
- Owner/browser acceptance remains deferred to M1.13.

---

### Task 1: Freeze M1.11 ownership in repository governance and create the permanent RED source contract

**Files:**
- Modify: `docs/bookmarks/MILESTONE_PATH.md`
- Modify: `docs/IMPLEMENTATION_STATUS.md`
- Modify: `docs/NEXT_BUILD_UNIT.md`
- Create: `scripts/check-worker-evidence-records.mjs`
- Modify: `package.json`
- Create: `.github/workflows/m1-11-targeted-ci.yml`

**Interfaces:**
- Consumes: merged M1.10 boundary `3b32287fecb30f16d682cb130be0e8f1eb466616`.
- Produces: `npm run check:m1-11`, targeted Node-24 workflow, and repository bookmark declaring M1.11 IN PROGRESS.

- [ ] **Step 1: Update governance docs without claiming M1.11 completion**

Record:
- M1.10 = Engineering Green, merged and post-merge gate passed.
- M1.11 = IN PROGRESS on `build/m1-11-worker-evidence-records`.
- M1.13 still owns combined owner/browser acceptance.
- M1.12 remains untouched.

- [ ] **Step 2: Write `scripts/check-worker-evidence-records.mjs` as a missing-surface RED contract**

The checker must require these production surfaces:

```js
const required = [
  "database/migrations/0030_worker_evidence_records.up.sql",
  "database/migrations/0030_worker_evidence_records.down.sql",
  "src/lib/worker-evidence/worker-evidence-domain.ts",
  "src/lib/worker-evidence/worker-evidence-repository.ts",
  "src/lib/worker-evidence/worker-evidence-service.ts",
  "src/lib/worker-evidence/worker-evidence-attachment-service.ts",
  "src/app/worker/(portal)/evidence/page.tsx",
  "src/app/worker/(portal)/evidence/actions.ts",
  "src/components/worker/worker-evidence-workspace.tsx",
  "tests/platform/worker-evidence-records.test.mjs",
  "tests/platform/worker-evidence-migration-stack.test.mjs"
];
```

The checker must also forbid:

```js
const forbidden = [
  /DELETE\s+FROM\s+worker_evidence_records/i,
  /INSERT\s+INTO\s+platform_audit_events/i,
  /workerAccountId\s*:/,
  /export\s+const\s+\w+[\s\S]{0,200}=\s*Object\.freeze\s*\(/
];
```

and require markers for:
- `/worker/evidence` navigation;
- `self_declared`, `evidence_verified`, `competency_assessed`;
- `SecureFileService`/secure-file binding reuse;
- `DatabaseAuditRepository`;
- `worker_employment_leaving_letters`;
- no M2 reviewer decision modules.

- [ ] **Step 3: Add package script**

Add:

```json
"check:m1-11": "node scripts/check-worker-evidence-records.mjs"
```

Do not wire `check:m1-11` into the full `check` command until the M1.11 slice is GREEN.

- [ ] **Step 4: Create `.github/workflows/m1-11-targeted-ci.yml`**

Use Node 24, `npm ci`, then:

```yaml
- name: M1.11 static architecture contract
  run: npm run check:m1-11
```

Later tasks add the runtime command to the same workflow.

- [ ] **Step 5: Run the targeted workflow and verify RED**

Expected: `check:m1-11` fails because migration/domain/service/route/test surfaces do not exist. Existing M1.01–M1.10 code must remain untouched.

- [ ] **Step 6: Commit the RED contract**

Commit message:

```text
test: freeze M1.11 Worker evidence contract
```

---

### Task 2: Build the monotonic M1.11 relational migration and migration-stack RED/GREEN proof

**Files:**
- Create: `database/migrations/0030_worker_evidence_records.up.sql`
- Create: `database/migrations/0030_worker_evidence_records.down.sql`
- Create: `tests/platform/worker-evidence-migration-stack.test.mjs`
- Create: `scripts/run-worker-evidence-record-tests.mjs`

**Interfaces:**
- Produces stable tables `worker_evidence_records`, `worker_evidence_versions`, four typed detail tables, `worker_evidence_attachments`, `worker_employment_leaving_letters`.
- Produces migration boundary constant `0030_worker_evidence_records` for all M1.11 tests.

- [ ] **Step 1: Write migration-stack test before migration SQL**

Test must:
1. open filesystem PGlite;
2. apply migrations through `0030_worker_evidence_records`;
3. verify all M1.11 tables/constraints/indexes;
4. seed a Worker-owned submitted qualification, employment, attachment and leaving letter;
5. close/reopen database;
6. verify history remains;
7. roll back 0030 and assert the rollback is monotonic/non-destructive;
8. reapply 0030 and verify checksums/history;
9. prove retained M1.11 history does not block lower-brick rollback/reapply.

Expected RED: unknown migration/table.

- [ ] **Step 2: Create `0030_worker_evidence_records.up.sql`**

Required core enums are CHECK constraints, not PostgreSQL enum types:

```sql
record_kind IN ('qualification','experience','employment','skill')
lifecycle_status IN ('active','ended','inactive')
version_status IN ('draft','submitted','superseded')
attachment_kind IN (
  'primary_certificate',
  'supporting_evidence',
  'experience_evidence',
  'employment_evidence',
  'skill_evidence'
)
skill_assurance_status IN ('self_declared','evidence_verified','competency_assessed')
leaving_letter_status IN ('active','superseded')
```

Create:

```sql
worker_evidence_records(
  record_id text primary key,
  worker_account_id text not null,
  record_kind text not null,
  lifecycle_status text not null default 'active',
  current_version_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null
)
```

```sql
worker_evidence_versions(
  version_id text primary key,
  record_id text not null references worker_evidence_records(record_id),
  version_number integer not null,
  version_status text not null,
  supersedes_version_id text references worker_evidence_versions(version_id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  submitted_at timestamptz,
  unique(record_id, version_number)
)
```

Add internal FK from `worker_evidence_records.current_version_id` to `worker_evidence_versions.version_id` after both tables exist.

Typed detail tables use `version_id` as primary/internal FK and explicit columns from the design spec. Draft columns that can be incomplete remain nullable; service submission validation enforces completion.

Create attachment and leaving-letter tables exactly as defined in the design spec. `secure_file_id` and `worker_account_id` have **no hard FK to lower-brick tables**.

Add indexes on Worker ownership, record kind/status, version record/status, attachment version/kind and leaving-letter employment/status.

- [ ] **Step 3: Add mutation guards for internal type consistency**

Database guards must reject:
- qualification details on non-qualification record versions;
- experience details on non-experience versions;
- employment details on non-employment versions;
- skill details on non-skill versions;
- leaving letter targeting a non-employment record;
- `evidence_verified`/`competency_assessed` skill status being written by the Worker-service role marker when that marker is present.

Do not create static hard dependencies on lower auth/secure-file tables.

- [ ] **Step 4: Create monotonic down migration**

`0030_worker_evidence_records.down.sql` must be a documented no-op for accepted compliance history:

```sql
-- M1.11 evidence history is monotonic. Rollback removes only the migration ledger entry;
-- accepted Worker evidence/history tables remain to prevent destructive compliance loss.
SELECT 1;
```

- [ ] **Step 5: Run migration test**

Run:

```bash
node --test tests/platform/worker-evidence-migration-stack.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Create runner shell and add `test:m1-11`**

`run-worker-evidence-record-tests.mjs` initially runs only the migration test. Add:

```json
"test:m1-11": "node scripts/run-worker-evidence-record-tests.mjs"
```

Add runtime step to M1.11 targeted workflow:

```yaml
- name: M1.11 runtime and migration contract
  run: npm run test:m1-11
```

- [ ] **Step 7: Commit**

```text
feat: add M1.11 Worker evidence persistence
```

---

### Task 3: Implement Worker evidence domain, repository and stable version service

**Files:**
- Create: `src/lib/worker-evidence/worker-evidence-domain.ts`
- Create: `src/lib/worker-evidence/worker-evidence-repository.ts`
- Create: `src/lib/worker-evidence/worker-evidence-service.ts`
- Create: `src/lib/worker-evidence/worker-evidence-action-state.ts`
- Create: `tests/platform/worker-evidence-records.test.mjs`
- Modify: `scripts/run-worker-evidence-record-tests.mjs`

**Interfaces:**
- Produces `WorkerEvidenceService` with Worker-owned CRUD-by-version operations but no destructive delete.
- All public methods consume `AuthorizationPrincipal`; none consume `workerAccountId` from request input.

- [ ] **Step 1: Write service RED tests**

Test cases:
- Worker A creates a qualification draft; Worker B cannot find/edit it and receives the same safe error as a missing ID.
- Save with expected revision/version detects stale concurrent writes.
- Submitted version cannot be edited.
- `startRevision` creates version N+1, preserves N and copied metadata, and does not mutate attachments from N.
- record list returns current versions plus retained history only for the Worker principal.
- no delete method exists on service/repository API.

- [ ] **Step 2: Define domain types and errors**

Required exported types:

```ts
export type WorkerEvidenceRecordKind =
  | "qualification"
  | "experience"
  | "employment"
  | "skill";

export type WorkerEvidenceLifecycleStatus = "active" | "ended" | "inactive";
export type WorkerEvidenceVersionStatus = "draft" | "submitted" | "superseded";
export type WorkerSkillAssuranceStatus =
  | "self_declared"
  | "evidence_verified"
  | "competency_assessed";
```

Errors:
- `WorkerEvidenceNotFoundError`
- `WorkerEvidenceConflictError`
- `WorkerEvidenceContractError`
- `WorkerEvidenceAttachmentUnavailableError`

- [ ] **Step 3: Implement repository ownership queries**

Every Worker-owned query includes `worker_account_id=$principal.accountId`. Cross-Worker rows are never loaded and therefore cannot be enumerated.

Repository methods include:

```ts
createDraft(...)
saveDraft(...)
findCurrentForWorker(...)
listCurrentForWorker(...)
listVersionsForWorker(...)
submitDraft(...)
startRevision(...)
endCareerRecord(...)
inactivateSkill(...)
```

No `delete` method.

- [ ] **Step 4: Implement `WorkerEvidenceService`**

Key signatures:

```ts
createDraft(principal, kind): Promise<WorkerEvidenceRecord>
saveQualificationDraft(principal, input, expectedVersion): Promise<...>
saveExperienceDraft(principal, input, expectedVersion): Promise<...>
saveEmploymentDraft(principal, input, expectedVersion): Promise<...>
saveSkillDraft(principal, input, expectedVersion): Promise<...>
submit(principal, recordId, expectedVersion): Promise<...>
startRevision(principal, recordId, expectedVersion): Promise<...>
endEmployment(principal, recordId, expectedVersion, endDate, reason): Promise<...>
markSkillInactive(principal, recordId, expectedVersion): Promise<...>
```

Worker skill saves always persist `self_declared` regardless of attached evidence.

- [ ] **Step 5: Validate type-specific contracts**

Submission rules:
- qualification: required title/category/issuer/candidate-or-certificate number/issue date/level/country/declaration and primary certificate attachment;
- experience/employment: company, role, country, start date; if ended, end date required and start <= end;
- skill: name, category, proficiency claim, non-negative integer experience months, related trade optional;
- expiry cannot precede qualification issue date;
- verification URL, when present, must be HTTP(S).

- [ ] **Step 6: Run test runner**

Expected: service + migration tests PASS.

- [ ] **Step 7: Commit**

```text
feat: add Worker evidence record version service
```

---

### Task 4: Reuse M1.06 for exact record/version attachment binding

**Files:**
- Create: `src/lib/worker-evidence/worker-evidence-attachment-service.ts`
- Create: `tests/platform/worker-evidence-attachments.test.mjs`
- Modify: `scripts/run-worker-evidence-record-tests.mjs`

**Interfaces:**
- Consumes: `SecureFileService`, `SecureFileUploadService`, `SecureFileScanService`, existing trusted upload policy.
- Produces: attachment reservation/upload/bind method that accepts record/version/attachment kind and current Worker principal.

- [ ] **Step 1: Write attachment RED tests**

Prove:
- PDF, PNG and JPEG genuine files can reach the accepted `available` state and bind.
- unsupported/oversize/unsafe/quarantined file cannot bind.
- file reserved for Record A/version A cannot bind to Record B/version B.
- Worker B cannot bind Worker A file/record.
- replacing a draft attachment supersedes only the same attachment slot; no other form/file changes.
- submitted-version attachments are immutable.

- [ ] **Step 2: Implement server-owned business-reference builder**

```ts
function workerEvidenceBusinessReference(input: {
  recordId: string;
  versionId: string;
  attachmentKind: WorkerEvidenceAttachmentKind;
  nonce: string;
}): string {
  return [
    "worker-evidence",
    input.recordId,
    input.versionId,
    input.attachmentKind,
    input.nonce
  ].join(":");
}
```

- [ ] **Step 3: Implement attachment service**

Core flow:

```ts
const owned = await records.requireOwnedDraft(principal, recordId, versionId);
const reservation = await secureFiles.reserveForPrincipal({
  principal,
  businessReference: workerEvidenceBusinessReference(...),
  displayFilename
});
await uploads.quarantineForPrincipal(...);
await scans.scheduleForPrincipal({ principal, fileRef: reservation.file.fileId });
const scanned = await secureFiles.findForPrincipal(principal, reservation.file.fileId);
if (!scanned || scanned.lifecycleStatus !== "available") {
  throw new WorkerEvidenceAttachmentUnavailableError();
}
await repository.bindAttachment(...);
```

Policy:

```ts
createTrustedSecureFileUploadPolicy({
  policyKey: `worker.evidence.${attachmentKind}`,
  allowedKinds: ["pdf", "png", "jpeg"],
  maxBytes: SECURE_FILE_UPLOAD_DEFAULT_MAX_BYTES
});
```

Use the existing local test scan settlement hook only in the same environment pattern already accepted by M1.07; do not weaken production scan requirements.

- [ ] **Step 4: Add business-reference recheck before binding**

The scanned file record must have the exact expected `businessReference` prefix for `recordId`, `versionId` and attachment kind. Mismatch fails before repository bind.

- [ ] **Step 5: Run tests and commit**

```text
feat: bind Worker evidence to secure files
```

---

### Task 5: Add centralized M1.11 audit events and qualification integrated draft behavior

**Files:**
- Modify: `src/lib/audit/audit-domain.ts`
- Modify: `src/lib/worker-evidence/worker-evidence-service.ts`
- Create: `tests/platform/worker-qualification-flow.test.mjs`
- Modify: `scripts/run-worker-evidence-record-tests.mjs`

**Interfaces:**
- Produces qualification draft/save/upload/submit/revision workflow with centralized audit.

- [ ] **Step 1: Write qualification RED test**

One end-to-end service test must create a qualification draft, save metadata, attach a primary PDF through the secure-file service boundary, submit, start revision, replace the revision file, and prove version 1 metadata/file still exists unchanged.

Also prove a supporting file cannot silently become the primary certificate and a file from another qualification cannot be rebound.

- [ ] **Step 2: Add audit action keys**

Add exact keys:

```ts
"worker_evidence.record.created"
"worker_evidence.draft.saved"
"worker_evidence.file.attached"
"worker_evidence.file.replaced"
"worker_evidence.version.submitted"
"worker_evidence.revision.started"
"worker_evidence.employment.ended"
"worker_evidence.skill.inactivated"
"worker_evidence.leaving_letter.attached"
"worker_evidence.leaving_letter.replaced"
```

- [ ] **Step 3: Inject/use `DatabaseAuditRepository` in WorkerEvidenceService**

Audit must carry true Worker actor and stable record/version targets. No service file may contain `INSERT INTO platform_audit_events`.

- [ ] **Step 4: Make qualification submission atomic**

Within one database transaction:
- lock current draft/version;
- validate mandatory metadata;
- verify active primary-certificate attachment for same version;
- mark previous submitted version superseded when applicable;
- mark draft submitted;
- update current version pointer;
- append audit event.

- [ ] **Step 5: Run tests and commit**

```text
feat: complete integrated qualification evidence flow
```

---

### Task 6: Implement experience and employment history transitions

**Files:**
- Modify: `src/lib/worker-evidence/worker-evidence-service.ts`
- Create: `tests/platform/worker-career-evidence.test.mjs`
- Modify: `scripts/run-worker-evidence-record-tests.mjs`

**Interfaces:**
- Produces multiple experience/employment records, safe versioning and `endEmployment` history transition.

- [ ] **Step 1: Write RED tests**

Prove:
- Worker can own multiple company records simultaneously.
- employment/experience records do not overwrite one another.
- current employment forbids end date; ended employment requires end date.
- `endEmployment` creates/persists new ended version and leaves old submitted version intact.
- no DELETE removes the record/history.
- cross-Worker employment ID is non-enumerating.

- [ ] **Step 2: Implement career validators**

```ts
if (startDate && endDate && startDate > endDate) {
  throw new WorkerEvidenceContractError("End date cannot be before start date.");
}
```

Current status requires `endDate === null`; ended status requires non-null end date.

- [ ] **Step 3: Implement `endEmployment` transaction**

Lock the current owned record/version, create version N+1 with copied details + end date/reason, mark old submitted version superseded, mark new version submitted, set record lifecycle `ended`, audit `worker_evidence.employment.ended`.

Do not delete Company link history or M1.10 workforce link records; M1.11 changes Worker evidence history only.

- [ ] **Step 4: Run tests and commit**

```text
feat: preserve Worker employment and experience history
```

---

### Task 7: Implement skills without status conflation

**Files:**
- Modify: `src/lib/worker-evidence/worker-evidence-service.ts`
- Create: `tests/platform/worker-skill-evidence.test.mjs`
- Modify: `scripts/run-worker-evidence-record-tests.mjs`

**Interfaces:**
- Produces Worker skill draft/save/submit/revision/inactivate behavior while preserving future verification states.

- [ ] **Step 1: Write RED tests**

Prove:
- Worker skill saves default to `self_declared`.
- attaching skill evidence does not change assurance status.
- browser/service input attempting `evidence_verified` or `competency_assessed` is ignored/rejected for Worker path.
- three status values remain representable in persistence for later authorized M2 transitions.
- mark inactive preserves submitted history.

- [ ] **Step 2: Implement Worker skill input without assurance-status field**

```ts
export type WorkerSkillDraftInput = Readonly<{
  skillName: string | null;
  category: string | null;
  proficiencyClaim: string | null;
  experienceMonths: number | null;
  relatedTrade: string | null;
}>;
```

The Worker service sets `skillAssuranceStatus: "self_declared"` itself.

- [ ] **Step 3: Implement `markSkillInactive`**

Create preserved version/state transition, lifecycle `inactive`, audit `worker_evidence.skill.inactivated`.

- [ ] **Step 4: Run tests and commit**

```text
feat: add structured Worker skills and inactive history
```

---

### Task 8: Attach leaving letters to exact employment only

**Files:**
- Create: `src/lib/worker-evidence/worker-leaving-letter-service.ts`
- Create: `tests/platform/worker-leaving-letter.test.mjs`
- Modify: `scripts/run-worker-evidence-record-tests.mjs`

**Interfaces:**
- Consumes exact owned employment record/version and existing secure-file upload pipeline.
- Produces immutable/superseding leaving-letter rows.

- [ ] **Step 1: Write RED tests**

Prove:
- leaving letter accepts genuine multi-page PDF bytes through existing PDF policy;
- only `employment` record can receive a leaving letter;
- letter uploaded for Employment A is absent when listing Employment B;
- Worker B cannot read/replace Worker A letter;
- replacement marks old letter superseded rather than deleting it;
- history survives restart/migration reapply.

- [ ] **Step 2: Implement `WorkerLeavingLetterService`**

Signature:

```ts
attachOrReplace(principal, input: {
  employmentRecordId: string;
  employmentVersionId: string;
  upload: {
    originalFilename: string;
    declaredMime: string;
    bytes: Uint8Array;
  };
}): Promise<WorkerLeavingLetterRecord>
```

The service loads exact owned employment, reserves with `attachmentKind=leaving_letter`, scans, verifies available/business reference, then inserts replacement atomically with audit.

- [ ] **Step 3: Add list method scoped to employment**

```ts
listForEmployment(principal, employmentRecordId): Promise<readonly WorkerLeavingLetterRecord[]>
```

Query must include both Worker ownership and employment ID.

- [ ] **Step 4: Run tests and commit**

```text
feat: bind leaving letters to exact Worker employment
```

---

### Task 9: Build the real `/worker/evidence` UX and navigation

**Files:**
- Create: `src/app/worker/(portal)/evidence/page.tsx`
- Create: `src/app/worker/(portal)/evidence/actions.ts`
- Create: `src/components/worker/worker-evidence-workspace.tsx`
- Create: `src/components/worker/worker-qualification-form.tsx`
- Create: `src/components/worker/worker-career-form.tsx`
- Create: `src/components/worker/worker-skill-form.tsx`
- Create: `src/components/worker/worker-leaving-letter-form.tsx`
- Modify: `src/components/worker/worker-navigation.tsx`
- Modify Worker dashboard CTA component/file identified by repository search during implementation.
- Modify: `scripts/check-worker-evidence-records.mjs`

**Interfaces:**
- Consumes service/read models from Tasks 3–8.
- Produces canonical Worker evidence route with integrated forms and no manual-refresh workflow.

- [ ] **Step 1: Extend static contract before UI**

Require:
- `/worker/evidence` page;
- Worker nav entry;
- same qualification form contains metadata fields and `file` control;
- leaving-letter form receives exact employment record ID;
- `"use server"` actions file exports functions only;
- server action file contains `requirePortalAuthorization("worker")`;
- no `workerAccountId` form input.

Run `npm run check:m1-11` and verify RED before UI exists.

- [ ] **Step 2: Implement server page**

Page authorizes Worker server-side, loads Worker evidence read model and renders workspace. Loading/error boundaries follow accepted Worker portal patterns.

- [ ] **Step 3: Implement function-only server actions**

Use shared `worker-evidence-action-state.ts` for state objects/types. `actions.ts` exports only async functions such as:

```ts
saveQualificationDraftAction
submitEvidenceRecordAction
startEvidenceRevisionAction
saveExperienceDraftAction
saveEmploymentDraftAction
endEmploymentAction
saveSkillDraftAction
markSkillInactiveAction
attachLeavingLetterAction
```

Every successful action calls:

```ts
revalidatePath("/worker/evidence");
revalidatePath("/worker/dashboard");
```

- [ ] **Step 4: Implement integrated qualification form**

Same visible form contains qualification metadata and primary certificate file input. The action saves metadata and, when a file is present, uploads/binds it to the exact current draft. Submit button reports missing certificate/metadata instead of navigating to a different upload page.

- [ ] **Step 5: Implement experience/employment forms**

Cards show current and history status. `End Employment` requires confirmation inputs for end date and optional reason. No delete button exists.

- [ ] **Step 6: Implement skill form**

Display assurance status read-only. Worker cannot choose verified/assessed status.

- [ ] **Step 7: Implement leaving-letter control inside employment card**

The form includes hidden `employmentRecordId` and `employmentVersionId` but server revalidates ownership/kind. List only letters returned for that employment.

- [ ] **Step 8: Wire navigation/dashboard**

Add:

```ts
{ href: "/worker/evidence", label: "Evidence", icon: "▣" }
```

Update real dashboard evidence CTAs to `/worker/evidence`; do not add decorative actions.

- [ ] **Step 9: Run source/runtime/type/build checks**

```bash
npm run check:m1-11
npm run test:m1-11
npm run typecheck
npm run lint
npm run build
```

Expected: all PASS.

- [ ] **Step 10: Commit**

```text
feat: add Worker evidence workspace
```

---

### Task 10: Permanently wire M1.11 into aggregate gates and regression isolation

**Files:**
- Modify: `package.json`
- Modify: `scripts/check-engineering-automation-kit.mjs` if it enumerates milestone-owned gates.
- Modify: `.github/workflows/m1-11-targeted-ci.yml`
- Modify full engineering workflow only if package aggregation is insufficient.
- Modify: `scripts/check-worker-evidence-records.mjs`

**Interfaces:**
- Produces permanent M1.11 ownership in quick/full/integration gates.

- [ ] **Step 1: Add aggregate scripts**

Wire `check:m1-11` and `test:m1-11` into:
- `verify:quick`
- `test:integration`
- full `check`

Do not remove or weaken M1.01–M1.10 commands.

- [ ] **Step 2: Add lower-brick regression to targeted workflow**

Run at least:

```yaml
- name: M1.11 runtime and migration contract
  run: npm run test:m1-11
- name: Secure-file lower-brick regression
  run: npm run test:secure-files
- name: Worker identity lower-brick regression
  run: npm run test:worker-identity-final
```

Use exact repository script names discovered from `package.json`; if the accepted scripts have different names, use those existing names rather than inventing aliases.

- [ ] **Step 3: Run production dependency audit**

```bash
npm audit --omit=dev --audit-level=high
```

Expected: zero high/critical vulnerabilities.

- [ ] **Step 4: Run full Engineering gate**

```bash
npm run check
```

Expected: complete PASS including production build.

- [ ] **Step 5: Commit**

```text
ci: permanently gate M1.11 Worker evidence records
```

---

### Task 11: Independent review, Gatekeeper, exact-SHA merge and merged-main verification

**Files:**
- No production files unless review identifies a defect.
- PR comment/review evidence only.

**Interfaces:**
- Consumes immutable candidate SHA with targeted/full gates green.
- Produces M1.11 Engineering Gatekeeper decision and, only on acceptance, exact-SHA merge.

- [ ] **Step 1: Freeze candidate SHA**

No more branch writes while reviewing.

- [ ] **Step 2: Fresh scope review**

Reject if changed-file inventory contains M1.12 public verification or M2 reviewer/assessment implementation.

- [ ] **Step 3: Fresh security/data-integrity review**

Verify:
- Worker ownership derived server-side;
- cross-Worker IDs are non-enumerating;
- no public secure-file path;
- attachment business reference exact binding;
- no destructive employment/evidence deletes;
- Worker cannot self-promote skill assurance status;
- leaving letters cannot cross employment records;
- centralized audit only.

- [ ] **Step 4: Fresh migration review**

Verify 0030 retained history does not hard-own lower bricks and lower rollback/reapply tests pass.

- [ ] **Step 5: Fresh UX review**

Verify `/worker/evidence` discoverability, same-form qualification upload, visible pending/success/error states, no manual refresh, no detached leaving-letter flow, and no non-function `"use server"` exports.

- [ ] **Step 6: Verification-Before-Completion**

Re-read exact-head targeted and full gate results. Confirm PR head equals tested SHA and no unresolved review threads exist.

- [ ] **Step 7: Gatekeeper comment**

Record exact SHA, targeted/full run IDs, review findings and explicit note that M1.13 owner/browser acceptance is still pending.

- [ ] **Step 8: Mark PR ready and merge with expected head SHA**

Use normal merge commit convention and expected head SHA pin. GitHub must reject merge if head drifts.

- [ ] **Step 9: Verify merged `main`**

Confirm `main` points to merge commit and run/observe post-merge Engineering verification. M1.11 is Engineering Released only after that post-merge run succeeds.

- [ ] **Step 10: Advance bookmark to M1.12 without owner/browser stop**

Update `NEXT_BUILD_UNIT.md`, `IMPLEMENTATION_STATUS.md` and milestone bookmark only after post-merge success. M1.13 remains the combined owner/browser acceptance boundary.

---

## Plan self-review

**Spec coverage:** Qualification integrated drafts, experience/employment, skill-state separation, leaving-letter binding, secure upload reuse, history preservation, Worker route, audit, cross-role protection and M2.02 exclusion each have explicit tasks.

**Placeholder scan:** No deferred implementation placeholders are used. Existing script-name discovery in Task 10 is constrained to already-present package scripts rather than an unspecified new behavior.

**Type consistency:** Stable record/version/attachment names and Worker evidence service signatures are used consistently throughout the plan. Worker skill input deliberately contains no assurance-status setter.

**Scope check:** M1.11 remains one cohesive evidence-record engine. Reviewer verification, public verification and assessment eligibility are excluded and remain owned by later frozen bricks.
