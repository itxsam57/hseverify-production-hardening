# M1.07 Subunit 5 Acceptance

## Scope

M1.07 Subunit 5 — **Duplicate Signals, Recovery and Worker-ID Eligibility**.

This acceptance closes only S5. M1.07 remains IN PROGRESS. S6 — Correction Versions, Worker Identity UX and Cumulative Acceptance — is next and is the first new browser-visible owner-test boundary. M1.08 remains blocked until the complete M1.07 brick receives owner PASS and formal closure.

## Accepted implementation evidence

- implementation PR: `#66`;
- accepted base main before S5: `9f35335e206eb899e630908efc425d2727dc5d91`;
- exact final implementation head: `8d7d3485a4d1f8017e0b5f0dab46ef8d9be5cb8c`;
- exact-head full engineering gate: `31415441023` — **PASS**;
- implementation merge: `538948402c703970fe6f6d84ab3a6e8cf61d8ab8`;
- merged-main full engineering gate: `31431146567` — **PASS**;
- browser/owner test: **NOT REQUIRED — S5 introduced no browser-visible product surface**.

## Accepted behavior

1. Duplicate evaluation is server-owned and runs only against the exact current submitted post-check identity version. It is not browser-selected recovery or decision authority.
2. Duplicate signals are conservative, deterministic and bounded to fixed signal types: exact verified email, exact verified phone, exact accepted identity-document identifier, and exact legal-name/date-of-birth equivalence.
3. Persisted duplicate-signal rows contain opaque identity/version references, signal type and bounded strength only. Compared email, phone, name, DOB and document values are not copied into duplicate-signal history.
4. Signal generation never silently or automatically merges identities or accounts.
5. Duplicate checks, signals and dispositions are append-only/immutable and version-bound enough to explain later eligibility decisions.
6. A review-required duplicate check must receive an explicit server-authorized disposition. Supported dispositions are bounded to `continue`, `recover_existing_account`, `duplicate_review` and `block_worker_id`; dispositions are auditable and cannot target a stale check.
7. Matching personal facts never grants account-recovery authority. Recovery remains separate from authenticated account/security authority established by M1.03.
8. Permanent Worker-ID issuance is permitted only for the exact current `verified` identity with a submitted current version and a current duplicate evaluation whose state allows issuance.
9. A clear duplicate evaluation permits issuance. A review-required evaluation permits issuance only when its latest authorized disposition is `continue`; unresolved recovery/review/block dispositions fail closed.
10. Permanent Worker IDs are server-generated, opaque, non-sequential, globally unique within the persistence boundary and idempotent for the identity. Accepted Worker-ID rows are immutable.
11. Worker own-status reads revalidate the live Worker session and expose only the Worker's own bounded duplicate/eligibility state and permanent Worker ID; other roles or revoked authority cannot read through this boundary.
12. Material duplicate evaluation, disposition and Worker-ID issuance append bounded immutable audit facts without copying compared personal values, secure-file authority, provider credentials or tokens.
13. Migration `0020_worker_identity_duplicate_worker_id` is monotonic: logical rollback cannot erase durable duplicate/recovery history or permit reissuing a different Worker ID, and deterministic reapply/restart behavior is tested.
14. S5 introduces no reviewer queue and no `/worker/identity` browser UX; those boundaries remain S6/M2.02 respectively.

## Cumulative regression evidence

The exact-head and merged-main gates reran the complete accepted application gate, including M1.01-M1.06 and M1.07 S1-S4. S5 focused coverage verifies server-created eligibility authority, deterministic bounded signals, normalization, fail-closed eligibility, opaque identifiers/reason codes, migration persistence/restart, monotonic rollback/reapply, append-only storage and Worker-ID immutability.

The first S5 full-gate attempt exposed a runtime-test harness dependency omission: the S5 platform test directly exercised accepted S4 repository code that the isolated runtime compiler had not included. The root fix added the direct S4 modules to the S5 runtime harness rather than weakening the test or product boundary. The replacement exact-head gate and merged-main gate both passed. This was a test-harness dependency defect, not a reproduced independent product/security defect, so no new stable regression identifier was assigned.

## Closure decision

**S5: ACCEPTED FOR CLOSURE.**

After this closure branch passes its own exact-head full engineering gate and merged-main verification:

- S5 becomes **DONE**;
- S6 — Correction Versions, Worker Identity UX and Cumulative Acceptance becomes **READY TO BUILD**;
- S6 must be built automatically next;
- the new `/worker/identity` surface requires targeted owner/browser PASS before M1.07 can close;
- M1.08 remains blocked.
