# M2.06 Assessment Catalogue and Eligibility Design

## Status
Approved Phase 1 design mirrored from the frozen HSE Verify roadmap and the implemented M2.02–M2.05 contracts. M2.06 decides which published assessment offering is available for a Worker’s existing Assurance Case. It does not start or run an assessment attempt.

## Purpose
M2.06 gives Administrators a versioned Assessment Catalogue and gives Workers a backend-authoritative list of assessment offerings they are currently eligible to take. Eligibility is derived from the authenticated Worker, an existing `Assessment pending` Assurance Case, the case’s immutable effective-policy framework, an exact M2.05 blueprint version, and approved current submitted qualification evidence from M2.02/M1.11.

## Boundary
M2.06 owns:
- stable Assessment Catalogue entries and immutable catalogue versions;
- Admin create/revise/activate/deactivate catalogue management;
- exact M2.05 blueprint-version pinning on each catalogue version;
- framework consistency between catalogue version and exact blueprint version;
- a dedicated Worker read permission `worker.assessments.read`;
- Worker eligibility read service and `/worker/available-assessments` UI;
- strict non-enumerating case ownership for Worker reads;
- minimum verified-qualification count as the first Phase 1 eligibility requirement;
- audit history for catalogue mutations.

M2.06 does **not** own:
- generating a new Assurance Case;
- generating or regenerating an M2.05 assessment form as a side effect of listing availability;
- attempt creation/start/finish;
- one-question-at-a-time delivery;
- answer persistence/autosave;
- timers, emergency exit, proctoring, scoring, results, retakes, interview scheduling, credential issuance, renewal, or reassessment.

Those remain later bricks, beginning with M2.07 Assessment Attempt Lifecycle.

## Data model
Use migration `0040_assessment_catalogue_eligibility`.

### `assessment_catalogue_entries`
Stable catalogue identity:
- `catalogue_entry_id` opaque `assessment_catalogue_` identifier;
- `catalogue_reference` unique human reference;
- `catalogue_status` `ACTIVE|INACTIVE`;
- `current_version_id` exact immutable version pointer;
- creator and timestamps.

### `assessment_catalogue_versions`
Append-only versions:
- `catalogue_version_id` opaque `catalogue_version_` identifier;
- parent `catalogue_entry_id`;
- monotonically increasing `version_no`;
- `title` and optional `description`;
- exact M2.03 `framework_id`;
- exact M2.05 `blueprint_version_id`;
- `minimum_verified_qualifications` integer `0..50`, default `1`;
- creator and timestamp.

`0` is deliberately supported for platform-authorized offerings whose qualification prerequisite is intentionally zero. The field is an explicit policy value; M2.06 must never infer “zero” because no qualification data exists.

## Cross-version integrity
M2.06 adds/uses database identity constraints so:
- a stable catalogue entry can only point to a version belonging to itself;
- a catalogue version’s `(framework_id, blueprint_version_id)` must refer to an M2.05 blueprint version with that exact framework;
- catalogue version rows are append-only;
- history-preserving rollback cannot erase catalogue versions that may be referenced by later attempt history.

## Admin catalogue rules
Admin service follows M2.04/M2.05 live-session revalidation:
1. Require live, unrevoked Admin session and active Admin account.
2. Normalize unique catalogue reference, title, optional description, framework reference and qualification minimum.
3. Resolve an ACTIVE framework by reference.
4. Resolve the exact blueprint version and require its stable blueprint is ACTIVE.
5. Require the blueprint version’s framework equals the catalogue framework.
6. Create stable entry as INACTIVE, insert immutable v1, then point stable entry at v1 and activate it in one transaction.
7. Revision locks the stable entry, requires `expectedCurrentVersionId`, inserts the next immutable version, then advances the pointer.
8. Status change mutates only the stable entry.
9. Duplicate/stale writers fail with a catalogue conflict error; no SQL internals are exposed.

## Worker assessment permission
Add platform permission:
```text
worker.assessments.read
```
Grant it only to `worker` in the canonical role matrix. It authorizes availability reads only. It does not authorize generating a form, starting an attempt, reading another Worker’s case, saving answers, or scoring.

## Eligibility source of truth
Worker identity is always `principal.accountId`. A browser-supplied Worker account id is never accepted.

A catalogue version is available for a case only when **all** of these are true:
1. live authenticated principal role is `worker`;
2. principal holds `worker.assessments.read`;
3. `assurance_cases.worker_account_id = principal.accountId`;
4. `assurance_cases.case_status = 'Assessment pending'`;
5. exactly one immutable `assurance_case_policy_snapshots` row exists for that case;
6. snapshot `framework_id` equals catalogue version `framework_id`;
7. stable catalogue entry is `ACTIVE` and points to that exact current catalogue version;
8. exact M2.05 `assessment_blueprint_versions.blueprint_version_id` exists;
9. that blueprint version belongs to the same framework and its stable `assessment_blueprints.blueprint_status = 'ACTIVE'`;
10. the Worker has at least `minimum_verified_qualifications` distinct qualifying evidence records.

M2.06 does not require the catalogue’s exact blueprint version to still be the stable blueprint’s current version. Catalogue publication intentionally pins an immutable exact blueprint version. A later blueprint revision must not silently rewrite an already-published catalogue version.

## Verified qualification definition
Count a qualification only when the **same exact current submitted version** has a terminal approved review lineage:
```sql
evidence_review_tasks t
JOIN evidence_review_decisions d
  ON d.task_id = t.task_id
 AND d.source_version_id = t.source_version_id
JOIN worker_evidence_records r
  ON r.record_id = t.source_record_id
 AND r.worker_account_id = :authenticated_worker
 AND r.record_kind = 'qualification'
 AND r.current_version_id = t.source_version_id
JOIN worker_evidence_versions ev
  ON ev.version_id = t.source_version_id
 AND ev.record_id = r.record_id
 AND ev.version_status = 'submitted'
WHERE t.worker_account_id = :authenticated_worker
  AND t.evidence_kind = 'qualification'
  AND t.task_status = 'APPROVED'
  AND d.outcome = 'APPROVED'
```
Count `DISTINCT r.record_id`.

This means:
- an approved old/superseded version does not qualify after the Worker revises the record;
- a submitted current version without an approved decision does not qualify;
- a review task/decision for another Worker does not qualify;
- REJECTED/CHANGES_REQUESTED/SUPERSEDED/CANCELLED tasks do not qualify.

## Worker read service
`AssessmentCatalogueEligibilityService` exposes:
- `listAvailableForWorker(principal)` — all currently eligible catalogue/case pairs for the authenticated Worker;
- `findAvailableForCase(principal, caseId)` — eligible items for one owned case, returning no result for malformed, missing, or copied other-Worker case ids.

The service is read-only. It must not generate an M2.05 form, create an attempt, mutate case status, or expose hidden qualification/reviewer data.

Recommended Worker DTO:
```ts
{
  catalogueEntryId,
  catalogueVersionId,
  catalogueReference,
  title,
  description,
  frameworkId,
  blueprintVersionId,
  minimumVerifiedQualifications,
  verifiedQualificationCount,
  caseId
}
```
No verifier ids, decision reasons, evidence filenames, answer keys, rubrics, blueprint nonce, or other Worker’s data.

## Worker UI
Add `/worker/available-assessments` and a visible Worker portal navigation link `Available assessments`.

The page must:
- require `worker.assessments.read`;
- show only eligible backend-returned items;
- identify the Assurance Case and offering clearly;
- explain an empty state without exposing which hidden rule failed;
- contain no “Start assessment” button until M2.07 supplies real attempt authority. M2.06 may show a non-action status such as `Eligible — attempt runtime not yet opened` only if needed for QA, but should avoid presenting dead controls.

## Admin UI
Add `/admin/assessment-catalogue` and visible Admin navigation.

Controls:
- create catalogue entry;
- revise with exact expected current version id;
- deactivate/reactivate;
- visible validation/conflict feedback.

Every visible button executes a real server action.

## Audit
Add explicit native actions:
- `assessment.catalogue.created`
- `assessment.catalogue.revised`
- `assessment.catalogue.status.changed`

Audit metadata may include catalogue/version/framework/blueprint ids and qualification minimum, but must not contain qualification document details or reviewer reasons.

## Security and non-enumeration
- Admin mutations revalidate live Admin session.
- Worker reads revalidate live Worker session and permission.
- `findAvailableForCase()` first scopes case ownership to the authenticated account; a copied other-Worker case id returns the same null/empty shape as an unavailable id.
- No browser Worker id parameter exists.
- Availability SQL is the authority; client filtering is never used for security.
- No eligibility read changes evidence, review, blueprint, form, case, or attempt state.

## Verification gates
M2.06 is accepted only when fresh tests prove:
- valid catalogue create/revise/status and dedicated audit actions;
- stale 8-way revisions have exactly one winner;
- version UPDATE/DELETE tamper is rejected;
- revoked Admin mutation is denied;
- inactive/missing framework, blueprint or cross-framework reference is rejected;
- Worker permission exists and is Worker-only;
- another Worker’s copied case id is non-enumerating;
- non-`Assessment pending` cases are unavailable;
- missing policy snapshot is unavailable;
- framework mismatch is unavailable;
- inactive catalogue or blueprint is unavailable;
- zero-prerequisite catalogue can be available without qualification evidence;
- minimum `1` fails without qualifying evidence;
- an approved exact-current submitted qualification makes minimum `1` available;
- an approved old version stops qualifying after a new current version is submitted;
- rejected/changes-requested/other-Worker evidence never qualifies;
- Worker availability DTO leaks no reviewer/evidence secrets;
- listing availability creates no form/attempt rows and changes no case status;
- Admin and Worker real-browser routes/navigation work through visible controls;
- history-preserving rollback/reapply retains catalogue history;
- M2.06 targeted suite, strict TypeScript, lint, M2.05 regression, Hard Browser QA and full Engineering verification are green on the exact head.
