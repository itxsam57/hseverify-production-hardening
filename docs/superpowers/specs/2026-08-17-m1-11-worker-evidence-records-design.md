# M1.11 Worker Evidence Records Design

**Status:** Frozen implementation design for M1.11

**Base boundary:** `main@3b32287fecb30f16d682cb130be0e8f1eb466616` — M1.10 merged and post-merge Engineering verification green.

**Canonical authority:** HSE Verify Master Phase 1 Engineering Specification, especially sections 9.1, 9.3, 15.1–15.5, 37.3, 38.1 and Appendix A/B. The historical Version 10 roadmap is a visible-capability reference only; it is not an architectural dependency.

## 1. Goal

Build the Worker evidence-record foundation required by M1.11 so a Worker can manage qualification, experience, employment, skill and leaving-letter records through `/worker/evidence`, with integrated secure-file handling and compliance-history preservation.

M1.11 must make these records real, persisted, Worker-owned and safe enough for later M2.02 verification queues. M1.11 does **not** implement reviewer verification decisions, assessment eligibility, public verification, supervisor-observation workflow, credential issuance or assurance cases.

## 2. Approved product behavior

### Qualification

The Add Qualification experience is one integrated draft surface containing metadata and certificate/supporting file controls. It must not send the Worker to a disconnected upload page or allow a file to become associated with another qualification draft.

Qualification fields:
- title
- category
- awarding/issuing organization
- learning provider
- certificate/candidate number
- issue date
- expiry date
- level
- country
- verification URL
- declaration
- primary certificate PDF/image
- optional supporting evidence

A qualification may be saved as a draft before it is complete. Submission requires all mandatory metadata, the declaration and an available primary certificate file. Submission locks that version. Later edits create a new version; old submitted history is never overwritten or deleted.

### Experience and employment

Experience and employment are separate record kinds with explicit typed fields, not a generic note blob. Each supports company, role/title, duties, country, start/end dates, current/ended state and evidence. Multiple companies and records are supported.

Ending an employment is a state transition, not deletion. It records an end date and optional end reason while preserving the earlier version and the stable employment record identity. An ended employment remains in history and can still own its leaving-letter evidence.

### Skills

A skill is a structured record containing skill name, category, proficiency claim, experience duration, evidence, related trade and assurance status.

The assurance states remain distinct:
- `self_declared`
- `evidence_verified`
- `competency_assessed`

A Worker-created or Worker-edited skill remains `self_declared` in M1.11 even when evidence is attached. M1.11 must never let the Worker promote the skill to `evidence_verified` or `competency_assessed`; those later states require future authorized verification/assessment flows.

A Worker may mark a skill inactive. Inactivation preserves the previous version and does not delete the skill history.

### Leaving letters

A leaving letter is employment-ending evidence attached to one exact employment record. Uploading a letter for Employment A must never make it available inside Employment B. A leaving letter file is PDF/image capable through the accepted M1.06 secure-file pipeline; multi-page PDF is therefore supported without a separate document engine.

Leaving-letter rows are retained. A later replacement may supersede an earlier letter, but no accepted history is physically deleted.

## 3. Architecture decision

### Chosen approach: stable records + immutable typed versions + shared secure-file attachments

Use one Worker evidence service boundary backed by a stable record table, version table and typed version-detail tables. All evidence kinds share ownership/version/attachment rules while keeping qualification, experience, employment and skill schemas explicit.

This is preferred over two rejected alternatives:

1. **Generic JSON evidence blob** — smaller initially, but weakens schema constraints, makes dates/status relationships ambiguous, and makes M2 verification/querying harder.
2. **Independent silo per evidence type** — explicit schemas but duplicates ownership, versioning, upload binding, history and audit logic, increasing the chance of cross-form file bugs.

The chosen design centralizes common invariants without erasing type-specific structure.

## 4. Data model

M1.11 begins with migration `0030_worker_evidence_records`.

### `worker_evidence_records`
Stable identity and ownership:
- `record_id`
- `worker_account_id`
- `record_kind`: `qualification | experience | employment | skill`
- `lifecycle_status`: `active | ended | inactive`
- `current_version_id`
- `created_at`
- `updated_at`

`worker_account_id` is server-derived from the authenticated Worker principal. No browser action may supply or override it.

### `worker_evidence_versions`
Immutable/superseding record content:
- `version_id`
- `record_id`
- monotonically increasing `version_number`
- `version_status`: `draft | submitted | superseded`
- `supersedes_version_id`
- `created_at`
- `updated_at`
- `submitted_at`

Only the current draft version is editable. Submitting a new version marks the previously submitted version `superseded` in the same transaction while preserving its content and attachments.

### Typed version detail tables

`worker_qualification_versions`
- qualification metadata listed in section 2

`worker_experience_versions`
- company
- role/title
- duties
- country
- start date
- end date
- current-status flag/state

`worker_employment_versions`
- company
- role/title
- duties
- country
- start date
- end date
- employment status
- end reason

`worker_skill_versions`
- skill name
- category
- proficiency claim
- experience duration
- related trade
- assurance status

### `worker_evidence_attachments`
Shared record/version file binding:
- `attachment_id`
- `record_id`
- `version_id`
- `attachment_kind`: `primary_certificate | supporting_evidence | experience_evidence | employment_evidence | skill_evidence`
- `secure_file_id`
- `display_filename`
- `created_at`
- `superseded_at`

The attachment service verifies the file belongs to the same authenticated Worker and the exact record/version before binding.

### `worker_employment_leaving_letters`
- `leaving_letter_id`
- `employment_record_id`
- `employment_version_id`
- `secure_file_id`
- `display_filename`
- `status`: `active | superseded`
- `supersedes_leaving_letter_id`
- `created_at`
- `superseded_at`

Only an owned `employment` record may receive a leaving letter.

## 5. Secure-file integration

Reuse M1.06; do not create another storage, MIME, malware-scan or preview pipeline.

For an upload, the server must:
1. authorize the current Worker session;
2. load the exact owned draft/record;
3. reserve a secure file through `SecureFileService.reserveForPrincipal`;
4. generate a server-owned business reference containing record ID, version ID and attachment slot;
5. quarantine through `SecureFileUploadService` with trusted PDF/PNG/JPEG policy;
6. schedule/run the accepted scan adapter;
7. require the secure file to be `available` before binding;
8. re-check record/version ownership before final attachment;
9. persist the attachment and audit consequence atomically where the repository boundary permits.

Browser-supplied file IDs, account IDs, version ownership or business references are never trusted as authorization evidence.

The business reference format is server-generated and namespaced, for example:
`worker-evidence:<record-id>:<version-id>:<attachment-kind>:<nonce>`.

A file reserved for one record/version cannot be attached to another record/version. This is a release-blocking regression contract.

## 6. Cross-brick migration safety

M1.11 compliance history is retained. Therefore retained M1.11 tables must not own hard foreign keys into reversible lower bricks such as authentication, Worker identity or secure-file tables.

Internal M1.11 relationships may use hard foreign keys. Cross-brick ownership/file integrity is enforced through authenticated service guards and database mutation guards that do not prevent lower-brick rollback. M1.11 migration tests must explicitly roll lower bricks back and reapply them after M1.11 history exists.

The M1.11 down migration is monotonic for accepted compliance history; it must not silently destroy submitted evidence or leaving-letter history.

## 7. Worker workflow and UX

Add `/worker/evidence` and a visible Worker navigation entry.

The page has one evidence workspace with sections/tabs for:
- Qualifications
- Experience
- Employment
- Skills

Leaving letters live inside the exact employment card/form rather than as a detached global upload list.

Primary Worker actions:
- Add Qualification
- Add Experience
- Add Employment
- Add Skill
- Save Draft
- Submit
- Start Revision
- End Employment
- Mark Skill Inactive
- Upload/Replace Leaving Letter

Every action has server-side authorization, stale-version conflict handling, loading/pending state and visible success/error feedback. No route requires manual refresh after a successful mutation.

Dashboard evidence/qualification calls-to-action and the Worker navigation deep-link to `/worker/evidence` once the route is real.

## 8. State and history rules

- Drafts are editable only by the owning Worker.
- Submitted versions are immutable.
- A revision creates a new draft; it does not reopen the old submitted row.
- Old submitted versions and their attachment bindings remain queryable as history.
- Ending employment creates/persists ended state; no delete action exists.
- Inactivating a skill preserves prior state; no delete action exists.
- Leaving letters are never cross-shown between employers.
- Evidence presence does not equal evidence verification.
- M1.11 does not create reviewer decisions or verified qualification/skill outcomes.

## 9. Authorization and non-enumeration

All Worker reads/writes re-derive the current Worker principal server-side. Cross-Worker record IDs, version IDs, attachment IDs or employment IDs return the same not-found/access-safe outcome as nonexistent resources.

No Company, Reviewer, Assessor or Admin write path is introduced by M1.11. Later role-specific projections may consume M1.11 data through separately authorized services in later bricks.

## 10. Audit

Use the accepted centralized audit repository; do not insert directly into `platform_audit_events`.

M1.11 records auditable events for material transitions, including:
- evidence record created
- draft saved
- file attached/replaced
- version submitted
- revision started
- employment ended
- skill inactivated
- leaving letter attached/replaced

Audit actors remain the true Worker actor.

## 11. Error handling

User-visible failures are bounded and do not expose another Worker’s existence or file metadata.

Specific recoverable classes cover:
- invalid metadata/date range
- stale revision/version conflict
- wrong record kind
- record/version not owned or unavailable
- unsupported/oversize/unsafe file
- file not yet scan-available
- attachment belongs to another record/version
- leaving letter targets a non-employment record
- submitted version cannot be edited in place

An upload failure never overwrites an accepted record version or another form’s attachment.

## 12. Permanent regression contract

M1.11 is not engineering-green until permanent tests prove:
- qualification metadata and primary file stay bound to the exact draft/version;
- PDF/image upload goes through M1.06 and unsafe/quarantined files cannot bind;
- a file from Record A cannot bind or appear in Record B;
- cross-Worker record/file access is non-enumerating and denied;
- multiple employment/experience records coexist;
- ending employment preserves history and has no delete path;
- leaving letter is scoped to one employment and supports PDF;
- skill assurance states remain distinct and Worker writes cannot self-promote beyond `self_declared`;
- revisions preserve submitted versions and attachments;
- stale concurrent edits fail safely;
- audit is centralized;
- `/worker/evidence` is discoverable and Worker-only;
- M1.11 `"use server"` modules export functions only;
- M1.11 migrations are restart-safe, rollback/reapply-safe and do not block lower-brick rollback;
- M1.01–M1.10 regression gates remain green;
- strict TypeScript, lint, production build and dependency audit remain green.

## 13. Explicit exclusions

Not in M1.11:
- Reviewer evidence-verification queue or approve/reject/changes-requested decisions — M2.02.
- Structured supervisor observation workflow — later evidence verification/assurance work.
- Assessment eligibility/catalogue — M2.06.
- Public Worker-ID/evidence projection — M1.12.
- Credentials/Living Record/share links — Milestone 3.
- Company-side ending of employment in directory — company workforce/assurance follow-on; M1.11 only establishes Worker evidence history.

## 14. Completion boundary

M1.11 is Engineering Green only after targeted M1.11 gates, the full Engineering gate, independent scope/security/migration/UI review, exact-SHA Gatekeeper acceptance, exact-head merge and post-merge `main` verification.

Milestone 1 remains owner/browser-test pending until M1.13. M1.11 must not introduce an intermediate owner/browser stop that contradicts the canonical milestone path.
