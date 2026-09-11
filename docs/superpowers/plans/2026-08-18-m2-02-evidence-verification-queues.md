# M2.02 — Evidence Verification Queues

## Frozen scope
Build Reviewer/Verifier evidence queues for identity, qualification, experience, employment, skill and structured supervisor observation evidence. Reuse M1.06 secure files, M1.07 identity, M1.11 evidence and M2.01 Assurance Cases.

## Required invariants
- Reviewer authority remains the fixed `verifier` role with `verification.assigned.read` / `verification.assigned.decide`; no Company tenant context is accepted.
- Queue/task IDs, Worker IDs, evidence IDs and file IDs are server-derived. Copied task IDs fail non-enumerating.
- Every task snapshots one exact evidence version. A later Worker correction creates a new task; it never mutates an old decision.
- Decision vocabulary is exactly `APPROVED`, `REJECTED`, `CHANGES_REQUESTED`.
- Exactly one terminal decision per task under concurrency. Decisions and conflict declarations are append-only history.
- A reviewer cannot decide an unassigned task, a stale/superseded version, or a task with an active conflict declaration.
- Reviewer detail exposes Worker identity/reference, evidence type/version and authorized secure-file preview reference; raw storage keys are never exposed.
- Reviewer file access must reuse the accepted M1.06 signed-access boundary.
- `CHANGES_REQUESTED` returns ownership to the Worker and preserves the reviewed version. Approval/rejection retains reasons and audit.
- Case status/owner/next action are explicit; no generic `processing` state.
- Structured supervisor observation is typed workplace evidence, not a free-form reviewer note.
- No M2.03 policy engine, M2.04 question bank or M2.05 form generation authority is introduced.

## Hard tests
RED→GREEN source contracts plus real PGlite runtime tests for queue creation, exact version binding, claim races, copied-ID attacks, conflict denial, stale version denial, one-decision concurrency, changes-requested lineage, secure-file reference safety, append-only history, case ownership transitions and rollback/reapply.
