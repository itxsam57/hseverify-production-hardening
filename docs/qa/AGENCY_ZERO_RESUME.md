# ZERO — exact agency QA continuation checkpoint (2026-11-21)

**CURRENT CONTROL:** [AGENCY_ZERO_PROTOCOL.md](AGENCY_ZERO_PROTOCOL.md), not the old M1-first owner-signoff loop.

## Immutable starting inventory (read-only)
- Frozen original Masterplan: **218 scenarios**, **37 related bricks**, **4,975 historical planned check slots** (these slots are not 4,975 verified test executions).
- Deterministic initial agency test scope: **58 batches**, maximum **5 related scenarios/test units per batch**; first **ZERO-001** (M1.01, 4).
- Historical evidence index: **1,610 distinct preexisting source-case identities**, **1,436 historical clean-green case claims**, **561 indexed .test.mjs files**, **68/218 scenarios linked to existing exact source-case IDs**; remaining **150 require evidence reconciliation, NOT automatically new tests**.
- At the starting checkout: 106 existing GitHub workflow files, 626 files under `tests/` of all types, and ~190 registered canonical worktrees. Most are historic/idle; **do not delete**.
- Recent 60 GitHub Actions runs checked 2026-11-21: 58 success, two independent-audit failures; no queued or in-progress in that 60-run sample. Host `ps` snapshot: no matching active HSE test runner. This is **one snapshot**, not a guarantee that no other work exists.
- Original final-release certificate `npm run audit:current-218-scenarios`: 0/218 **full production acceptance**, because live providers, trusted final staging, full pentest, owner UAT remain outstanding. The **new technical owner-ready count starts separately at 0/218**; historic scoped cases cannot be promoted by fiat.

## Open genuine red and pending checks
- Independent audit [GitHub run 44917041107](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/44917041107) on `fb220061ae78c3aae957184e366f22e7a85acb54`: existing `npm run verify:full` failed on a PG rollback test `tests/platform/interview-finalization-runtime.test.mjs:333`, "Appeal response notification contract drift prevents rollback". **Not fixed, no false green.** Determine application migration drift vs test fixture, preserve exact evidence, open a scoped fix only once independently reproduced. This is a known-red release gate, not a reason to stop unrelated read-only testing.
- Same CI run: 21/21 automated signed-out axe page+viewport scans produced zero axe violations; passive unauthenticated localhost ZAP found 14 alert categories, zero high-risk **in that limited synthetic scan**. Neither is authenticated/full security certification. Other full test/product issues may exist.
- Draft [PR #206](https://github.com/itxsam57/hseverify-production-hardening/pull/206) adds independent QA checks; **unmerged and undeployed**. This ZERO protocol/batch plan is appended only in its isolated branch, and must pass Autopilot V4 and CI before any merge.
- Other old chat and its worktrees/processes: **do not restart governors or start duplicate environments**. Existing signed staging PG16 and all other active/private work remain untouched. Owner UAT/provider-live final verification comes later.

## Exact next action
1. Verify current GitHub branch, SHA, active tests and V4 guard. Run:
   `python3 scripts/agency_zero_control.py --check && python3 scripts/agency_zero_control.py --status && python3 scripts/agency_zero_control.py --batch ZERO-001`
2. Review the batch's old source cases and earlier raw artifacts before choosing missing real browser/workflow/security tests. Do not treat the one-case scoped smoke GitHub job as entire scenario certification.
3. Use one isolated disposable test environment and at most five scheduled cases per batch, three documented expert lenses and exact-SHA evidence. If one fails, park its exact cause and test other independent batches, without touching other worktrees.
4. Append evidence receipts only after real reproducible full-tech pass, commit guarded state and update this handoff. Commit/push via Autopilot V4; never fake a merge, deployment or independent accreditation.

**Status template**
```text
ZERO | TECH VERIFIED 0/218 [░░░░░░░░░░░░░░░░░░░░] | OWNER READY NO
BATCH ZERO-001/058 | 4 units | PASS 0 | FAIL 0 | BLOCKED 0 | NEEDS EVIDENCE 4
ENGINEER: NOT RUN | CYBERSECURITY: NOT RUN | REVIEWER: NOT RUN
NEXT: reconcile M1.01.01 legacy artifacts | SHA: see git HEAD | EVIDENCE: this file
```
