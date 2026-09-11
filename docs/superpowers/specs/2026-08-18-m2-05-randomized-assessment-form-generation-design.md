# M2.05 Randomized Assessment Form Generation Design

## Status
Approved Phase 1 design mirrored from the frozen HSE Verify roadmap and prior milestone decisions. This document does not expand M2.05 into attempt runtime, scoring, results, interview, or credential authority.

## Purpose
M2.05 creates immutable assessment blueprints and generates a complete worker-specific assessment form server-side from the active Question Bank. The generated form is the authoritative question set and order for a later assessment attempt milestone.

## Boundary
M2.05 owns:
- versioned assessment blueprints;
- selector validation;
- generation of a complete form for an Assurance Case;
- permanent Worker-level question non-repetition based on stable question identity;
- cryptographically seeded randomized selection and persisted order;
- exact question-version pinning;
- answer-safe form delivery DTOs;
- append-only blueprint/form/item history;
- Admin blueprint management UI.

M2.05 does not own:
- attempt start/finish state;
- one-question-at-a-time attempt delivery;
- answer persistence or autosave;
- timers, emergency exit, proctoring, scoring, results, retakes, interviews, credentials, catalogue/eligibility, or reassessment policy.

## Data model
Use migration `0039_randomized_assessment_forms` on the current QA-derived branch.

### `assessment_blueprints`
Stable identity record:
- `blueprint_id` opaque `assessment_blueprint_` identifier;
- `blueprint_reference` unique human reference;
- `blueprint_status` `ACTIVE|INACTIVE`;
- `current_version_id` exact immutable version pointer;
- creator and timestamps.

### `assessment_blueprint_versions`
Append-only versions:
- `blueprint_version_id` opaque `blueprint_version_` identifier;
- parent `blueprint_id`;
- monotonically increasing `version_no`;
- exact `framework_id` from M2.03;
- `title`;
- `selectors_json`, an ordered array of selector objects;
- creator and timestamp.

Selector shape:
```json
{
  "count": 5,
  "questionType": "MULTIPLE_CHOICE",
  "domainReference": "Hazard control",
  "difficulty": "MEDIUM",
  "tagsAll": ["hazards"]
}
```
Only `count` is required. `questionType`, `domainReference`, `difficulty`, and `tagsAll` are optional filters. `tagsAll` means every listed tag must be present. Each selector count must be 1-100 and the total blueprint count must be 1-500.

### `generated_assessment_forms`
Immutable generated form identity:
- `form_id` opaque `assessment_form_` identifier;
- exact `case_id` and Worker account identity from the Assurance Case;
- exact `blueprint_version_id`;
- cryptographically random 32-byte nonce stored as lowercase hex;
- `question_count`;
- generation timestamp;
- uniqueness on `(case_id, blueprint_version_id)` so concurrent generation converges to one form.

### `generated_assessment_form_items`
Immutable ordered items:
- `form_item_id` opaque `assessment_form_item_` identifier;
- parent `form_id`;
- 1-based `position` unique within form;
- stable `question_id`;
- exact `question_version_id`;
- uniqueness on `(form_id, question_id)`.

The stable question id is retained specifically so a later revision cannot make an already-seen question eligible again for the same Worker.

## Generation rules
1. Load the Assurance Case and its immutable M2.03 `assurance_case_policy_snapshots` row.
2. Load the exact blueprint version and require its `framework_id` to equal the case snapshot framework.
3. If a form already exists for the same `(case_id, blueprint_version_id)`, return it unchanged.
4. Gather every stable `question_id` previously persisted in generated form items for the same `worker_account_id`, across all cases and blueprint versions.
5. For each selector in blueprint order, query only Question Bank rows where:
   - stable question is `ACTIVE`;
   - current question version is the candidate version;
   - version framework matches the blueprint framework;
   - optional selector filters match exactly;
   - all `tagsAll` values are present;
   - stable question id has never appeared in any prior form for that Worker;
   - stable question id has not already been selected by an earlier selector in the same form.
6. Fail closed before inserting any form if any selector has fewer unseen matches than requested.
7. Generate 32 random bytes with Node `randomBytes(32)`.
8. Rank candidates deterministically for that generation using SHA-256 over nonce + selector index + stable question id + exact question version id. Select the first `count` rows after ranking.
9. Persist the final ordered form and exact question-version pins in one transaction. Persisted item position is authoritative; future delivery must never re-randomize.
10. Under concurrent requests, the unique `(case_id, blueprint_version_id)` constraint is the convergence boundary. A loser rereads and returns the winning form rather than creating duplicates.

## Permanent non-repetition rule
For a Worker, once a stable `assessment_questions.question_id` has appeared in any persisted generated form, that stable question can never be selected again for that Worker. This exclusion applies across Assurance Cases, blueprint revisions, and question revisions. Different Workers may receive the same stable question.

M2.05 enforces stable-question non-repetition. A future milestone may add explicit question-family equivalence if a family identifier is introduced; M2.05 must not silently invent or infer family equivalence from text.

## Answer-safe delivery
`AssessmentFormDeliveryService` returns only:
- form id;
- exact blueprint version id;
- case id;
- ordered items containing position, stable question id, exact question version id, question type, prompt, options (when applicable), domain reference, difficulty, and tags.

It must never return:
- `answer_key_json`;
- `rubric_json`;
- content fingerprints;
- creator account ids;
- random nonce;
- internal audit metadata.

M2.05 may return the complete answer-safe form to trusted server consumers. One-question-at-a-time Worker runtime delivery belongs to M2.07.

## Admin UI
Add `/admin/assessment-blueprints` under the existing isolated Admin portal. The surface must:
- list stable blueprints with active/inactive state and current version;
- create a blueprint from reference + title + framework reference + selector JSON;
- revise a blueprint only when the caller supplies the expected current version id;
- activate/deactivate a blueprint;
- show validation/conflict errors visibly;
- contain no decorative or dead controls.

Every mutation revalidates a live Admin session in the service, following M2.04 patterns.

## Security and integrity
- All mutations require a live, unrevoked Admin session and active Admin account.
- Blueprint versions, generated forms, and generated form items are append-only.
- Generated forms cannot be partially persisted.
- Form generation derives Worker identity from the Assurance Case, never from browser-supplied worker identity.
- Cross-framework generation fails closed.
- Missing case policy snapshot fails closed.
- Insufficient unseen Question Bank capacity fails closed.
- Correct answers and written rubrics never cross the delivery DTO boundary.

## Audit
Add explicit native audit actions:
- `assessment.blueprint.created`
- `assessment.blueprint.revised`
- `assessment.blueprint.status.changed`
- `assessment.form.generated`

Audit metadata may contain counts, framework/blueprint identifiers, and case/form identifiers, but never answer keys, rubrics, secrets, or the generation nonce.

## Verification gates
M2.05 is accepted only when fresh tests prove:
- valid blueprint creation and revision;
- malformed selectors rejected;
- framework mismatch rejected;
- same Worker receives zero repeated stable question ids across generated forms;
- a question revision does not make its stable question eligible again;
- different Workers may receive the same stable question;
- insufficient unseen capacity fails with no partial form;
- concurrent generation converges to exactly one form;
- generated form/item update and delete attempts are rejected;
- answer-safe delivery contains no answer/rubric/fingerprint/nonce fields;
- rollback/reapply preserves generated history;
- Admin browser surface works through visible controls;
- targeted runtime tests, strict TypeScript, lint, Hard Browser QA, and Engineering verification are green on the exact branch head.
