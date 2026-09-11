# M2.01 — Assurance Order and Case Engine Implementation Plan

> Canonical authority: HSE Verify Master Product, Feature, Workflow, UX and Engineering Specification — Phase 1 Frozen Scope — 1 August 2026. M1.12 merged-main engineering release `612d95068f2dc50cc7cb6c47051dfd97cbc3ab01` is the immutable base.

## Goal

Implement the first Milestone 2 brick as the authoritative Company assurance-order intake and worker-specific Assurance Case engine. A Company must be able to draft an order, add eligible linked workers, validate all currently-buildable dependencies, submit exactly once, create exactly one worker-specific case per target, and see every pending case represented by an explicit Action Centre owner and next action. Submitted scope and case history are immutable; cancellation preserves history.

This brick must not invent M2.02+ reviewer decisions, M2.03 framework authoring, M2.04+ question/assessment delivery, M2.11+ interviews/decisions, or M3 credential/billing provider authority.

## Canonical product contract

### Assurance Order fields
- Order name/reference.
- Company tenant — server-derived, never browser-selected authority.
- Site and department.
- Workers or invitation targets.
- Requested identity/evidence checks.
- Assessment frameworks.
- Interview requirement.
- Credential target.
- Deadline.
- Funding method per worker.
- Effective policy.
- Company notes.
- Purchase order / billing reference.

### Order actions
- **Save Draft** — persists draft only; creates zero Assurance Cases.
- **Add Workers** — active linked workers/Worker IDs are supported in M2.01; invitation targets may be retained as unresolved targets but cannot silently become active cases.
- **Validate Order** — evaluates Company/tenant state, site/department, worker links, currently-available dependencies, funding readiness and policy conflicts. Unsupported future engines fail closed with explicit validation reasons.
- **Submit Order** — only a validated READY order; locks scope, records any M2.01-supported funding responsibility, creates exactly one Assurance Case per eligible worker, creates initial timeline/action items and audit records atomically and idempotently.
- **Cancel Draft** — only unsubmitted draft, after confirmation. No case history exists.
- **Cancel Submitted Order** — controlled state transition; cases/timeline/audit history remain.

### Order state vocabulary
`DRAFT`, `VALIDATION_FAILED`, `READY`, `SUBMITTED`, `PARTIALLY_FUNDED`, `ACTIVE`, `COMPLETED`, `CANCELLED`, `CLOSED`.

### Assurance Case status vocabulary
`Created`, `Awaiting worker acceptance`, `Identity pending`, `Evidence pending`, `Funding pending`, `Assessment pending`, `Assessment in progress`, `Review pending`, `Interview pending`, `Decision pending`, `Approved`, `Conditionally approved`, `Reassessment required`, `Rejected`, `Suspended`, `Closed`.

Every non-terminal pending state must identify one explicit owner (`worker`, `company`, `reviewer`, `assessor`, `admin`, `payment`, `background_job`) and an exact bounded next action. Generic `processing` is forbidden.

### Worker-specific source of truth
Each Assurance Case connects the worker/order to timeline, pending actions, evidence, assessment, integrity, review, interview, decision, credential and audit references. Later-brick references may be null in M2.01; M2.01 does not fabricate them.

### Action Centre
Route: `/company/action-centre`.
Each item contains severity, worker/order, reason, due date, owner and exact allowed action.
- **Open** deep-links to source order/case and requirement.
- **Assign owner** changes internal Company responsibility only; it cannot reassign platform reviewer/assessor tasks.
- **Mark internally acknowledged** records acknowledgement but does not resolve the source requirement.
- **Snooze** is allowed only for non-statutory informational items and requires date/reason.
- Bulk action is accepted only when one command is valid for every selected target; outcome/audit remains independent per target.

Primary Company route: `/company/assurance-orders/new` plus list/detail routes required for usable refresh/deep-link navigation.

## Architecture

### M2.01-owned persistence
Migration `0033_assurance_order_case_engine` owns:
- `assurance_orders`
- `assurance_order_workers`
- `assurance_cases`
- `assurance_case_timeline_events`
- `assurance_action_items`

Hard foreign keys are allowed between these M2.01-owned tables. References to earlier bricks (tenant, membership, worker, site, department, policy/framework references) are bounded opaque identifiers and are revalidated by trusted services before writes. This preserves lower-brick rollback/reapply independence.

### Tenant and permission authority
Reuse `company.orders.read` and `company.orders.manage` through current server-resolved tenant permission principals. Never accept `tenantId`, `membershipId`, actor account, tenant scope or permission from form fields.

### Worker authority
Reuse active `company_worker_links`. A target can create an active Assurance Case only when the live link belongs to the same tenant and is active. No Company ownership of the portable Worker identity is created.

### Audit
Extend the centralized audit vocabulary; use `DatabaseAuditRepository` only. Planned actions:
- `assurance_order.created`
- `assurance_order.updated`
- `assurance_order.validated`
- `assurance_order.submitted`
- `assurance_order.cancelled`
- `assurance_case.created`
- `assurance_case.status.changed`
- `assurance_action.created`
- `assurance_action.assigned`
- `assurance_action.acknowledged`
- `assurance_action.snoozed`

### Notifications
Submission must produce durable notification work for responsible parties only where the accepted notification/outbox contract can support it safely. If a future recipient channel is not yet available, the case/action state remains authoritative; no fake provider delivery success is recorded.

## TDD tasks

### Task 1 — Governance/base proof
- Prove branch base is merged M1.12 SHA.
- Update active-build governance from M1.12 to M2.01 without converting deferred owner acceptance to PASS.
- Add M2.01 targeted CI skeleton and package commands only after RED source/test surfaces exist.

### Task 2 — Domain/permission RED
Create tests for:
- exact order/case/action vocabularies;
- bounded identifiers and text/date fields;
- manager/admin/owner manage permission; viewer read-only;
- browser cannot supply tenant/membership/actor authority;
- future M2/M3 authority absent.
Expected RED: missing M2.01 domain/service.

### Task 3 — Persistence/rollback RED
Create migration tests for:
- M2.01 table/constraint/index shape;
- no cross-brick FK to tenant/workforce/site/department/Worker tables;
- submitted scope immutability;
- timeline append-only;
- one case per order-worker target;
- explicit pending owner + next action;
- terminal-state action rules;
- monotonic restart/rollback/reapply;
- retained M2.01 history cannot block independent lower-brick rollback.
Expected RED: missing `0033`.

### Task 4 — Draft/save/worker-target RED → GREEN
Implement domain/repository/service for:
- create/save draft;
- add/remove draft workers;
- same-tenant active link validation;
- site/department live validation;
- zero cases before submission;
- tenant isolation under copied order/worker IDs;
- optimistic concurrency/idempotency for duplicate saves.

### Task 5 — Validation RED → GREEN
Validation result must be deterministic and explicit.
- required order metadata;
- verified/active Company tenant;
- active site/department when selected;
- at least one eligible worker target;
- current identity/evidence requirements;
- future assessment framework/interview/credential targets that require unbuilt engines are explicit blockers rather than fake READY state;
- funding method captured per worker but no M3 live payment reservation is invented;
- deadline/policy conflicts fail closed;
- READY only when every M2.01-buildable requirement is satisfied.

### Task 6 — Submit/concurrency RED → GREEN
Prove:
- only READY can submit;
- 20+ concurrent identical submits create one submission, one case per worker and no duplicate initial actions/timeline events;
- submitted order scope cannot mutate;
- one worker = one case in the order;
- case starts at exact next state based on known live dependencies;
- every pending case gets an explicit owner/next action;
- audit is transactional with submission;
- refresh/retry resolves to existing durable result.

### Task 7 — Cancellation/history RED → GREEN
- Cancel Draft only before submit; confirmation belongs to UI.
- Submitted cancellation transitions order/cases without deleting case/timeline/audit history.
- timeline update/delete denied;
- cancelled submitted order cannot submit again;
- case/order references survive restart and rollback/reapply.

### Task 8 — Action Centre RED → GREEN
Implement tenant-scoped read/commands:
- severity, worker/order, reason, due date, owner, exact allowed action;
- deep link to order/case;
- internal owner assignment cannot alter platform reviewer/assessor ownership;
- acknowledgement does not resolve source action;
- snooze only allowed for informational/non-statutory item with reason/date;
- bulk command all-or-reject validation with per-target transactional audit;
- copied cross-tenant action IDs denied.

### Task 9 — Company UI/routes
Create:
- `/company/assurance-orders`
- `/company/assurance-orders/new`
- `/company/assurance-orders/[orderId]`
- `/company/action-centre`
- server actions and Company navigation links.

UI must render happy/empty/loading/validation/failure/denial states, exact status/owner/next action, confirmation for destructive/cancellation actions, accessible labels, refresh-safe deep links and no manual refresh requirement.

### Task 10 — Permanent M2.01 release gate
Create:
- `scripts/check-assurance-order-case-engine.mjs`
- `scripts/run-assurance-order-case-tests.mjs`
- `.github/workflows/m2-01-targeted-ci.yml`
- `check:m2-01`, `test:m2-01` package wiring into quick/integration/full Engineering gates.

Targeted CI must check exact SHA and run source guard, M2.01 runtime/migration/concurrency suites, strict TypeScript and lint.

### Task 11 — Full hard-test matrix
Require GREEN for:
- M2.01 targeted tests;
- M1.12 and M1.11 historical gates;
- all lower-brick application tests;
- typecheck/lint;
- production dependency audit;
- runtime/database smokes;
- optimized build;
- preview smoke/release manifest.

Review exact diff for tenant leakage, duplicate cases, mutable submitted scope, vague pending ownership, unsafe cancellation, audit bypass, cross-brick FK coupling and scope creep.

### Task 12 — Exact-head merge/release
- Freeze exact head.
- Record exact targeted/full run IDs and engineering review.
- Merge with `expected_head_sha` lock.
- Require merged-main full Engineering PASS and unchanged `main` SHA.
- Record M2.01 engineering release; do not infer browser/owner PASS.
- Only then begin M2.02.

## Definition of engineering complete

M2.01 is engineering complete only when a verified Company user with `company.orders.manage` can create a tenant-scoped draft, select eligible linked workers, receive explicit validation results, submit exactly once under concurrency, obtain one durable worker-specific Assurance Case per target, see immutable timeline/action ownership, cancel through controlled history-preserving transitions, and navigate all relevant Company routes without refresh hacks—while all historical gates remain green and no later-brick authority has leaked in.
