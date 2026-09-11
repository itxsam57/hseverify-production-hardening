# M1.04 Subunit 4 — Company-Scope Demonstration Final Owner Acceptance

## Final status

**DONE — OWNER PASS — 6 AUGUST 2026**

M1.04 subunit 4 is accepted. The overall M1.04 Authorization and Tenant Isolation brick remains **IN PROGRESS** until subunit 5 and final brick acceptance pass.

## Accepted implementation

- Implementation pull request: `#28`
- Validated implementation head: `d7999d50763775bc97d433451db869abbdfdc809`
- Implementation merge commit: `752e6cec8b7e83981cece5113748c8c48e52d52d`
- Implementation merged-main run: `31032355746`
- Implementation merged-main job: `92395916146`
- Delete repair pull request: `#32`
- Validated repair head: `bf82255de88f174f73eea8c2d8cb77911b556f89`
- Final repaired merge commit tested: `012ee75764b857345fc69499e8c19597dfceeffa`
- Final repaired merged-main run: `31065467924`
- Final repaired merged-main job: `92502148456`

## Owner-visible acceptance

The owner completed the merged Windows browser handoff and confirmed all required behavior passed:

1. Company password and TOTP login completed successfully.
2. The Company dashboard opened the protected `/company/tenant-scope` demonstration.
3. The page showed the masked tenant reference, membership role, synthetic-data warning and only current-tenant demonstration records or the explicit empty state.
4. Desktop and narrow layouts remained aligned, contained and free of page-wide horizontal overflow.
5. Invalid create input returned field validation without losing the page.
6. A synthetic record was created and appeared without a manual refresh.
7. The record was edited, the value/version updated, and the result appeared without a manual refresh.
8. Navigation away and back preserved the record.
9. Delete opened a confirmation dialog without submitting the surrounding edit form.
10. Cancel was non-destructive.
11. Confirmed deletion executed once, showed the pending state, blocked duplicate submission, removed the selected record, reduced the visible count and displayed the success result without a manual refresh.
12. A Worker who pasted `/company/tenant-scope` never saw Company content and retained a usable Worker session.
13. The development server stopped normally.
14. The repository returned to a clean synchronized `main` state without Administrator or Windows Developer Mode requirements.

## Automated acceptance

The exact repaired branch head and the merged-main commit passed the complete engineering gate, including:

- environment and migration validation;
- engineering, route, authorization and tenant-scope source contracts;
- Company-scope demonstration source and database tests;
- authentication, authorization, registration and session regressions;
- cross-tenant, stale-authority and concurrency tests;
- design-system, UX and overflow checks;
- production dependency and audit policy checks;
- strict TypeScript and ESLint;
- development server and signed-out portal redirect smoke;
- runtime database checks;
- production build and standalone preview startup;
- generated owner handoff and release evidence.

## Resolved owner defect

- `LATER-OWNER-016` — destructive confirmation used an invalid nested form and did not reliably execute the delete command.
- Resolution record: `docs/testing/results/LATER_OWNER_016_COMPANY_SCOPE_DELETE_CONFIRMATION.md`
- Permanent regression: `REG-023`

## Accepted security boundary

- Browser input contains no trusted tenant, membership, role, permission, ownership or scope values.
- Reads and mutations derive the current Company tenant and permission context on the server.
- Tenant-owned operations remain SQL-scoped.
- Sensitive commands revalidate authority transactionally.
- Cross-tenant and missing identifiers remain non-enumerating.
- Worker copied-route access remains denied without role switching or session corruption.
- Demonstration data remains synthetic and separate from future Company, Worker, evidence, notification, assessment, interview and billing entities.

## Next gate

M1.04 subunit 5 is now the only permitted implementation scope:

**Complete cross-role/cross-tenant direct-endpoint and concurrency suite, migration rollback verification, and final M1.04 owner acceptance.**

M1.05 and all later bricks remain blocked until the whole M1.04 brick is DONE.
