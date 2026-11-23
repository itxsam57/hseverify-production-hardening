# ZERO — consolidated eight-batch execution 013–020

**Frozen original app SHA:** `7ff30ea140a5145e5d5ba761f7c7aef24c895269`. **QA tooling/receipt commits may change; app source unchanged.**

**8/8 requested batches attempted; 32 original scenario workflow units; 31/32 selected scoped tests passed; 1 timed out; 0/218 TECH FULLY VERIFIED and not Owner Testing Ready.**

| Batch | Domain | Original units | Scoped PASS | FAILED/TIMEOUT | TECH FULL |
|---|---|---:|---:|---:|---:|
| [ZERO-013](AGENCY_ZERO_BATCH_013_REPORT.md) | Invitations & employment | 5 | 5 | 0 | 0 |
| [ZERO-014](AGENCY_ZERO_BATCH_014_REPORT.md) | Two-employer isolation | 1 | 1 | 0 | 0 |
| [ZERO-015](AGENCY_ZERO_BATCH_015_REPORT.md) | Worker evidence/Verifier | 5 | 4 | 1 | 0 |
| [ZERO-016](AGENCY_ZERO_BATCH_016_REPORT.md) | Observation & history | 3 | 3 | 0 | 0 |
| [ZERO-017](AGENCY_ZERO_BATCH_017_REPORT.md) | Public verification/concerns | 5 | 5 | 0 | 0 |
| [ZERO-018](AGENCY_ZERO_BATCH_018_REPORT.md) | Assurance cases/funding | 5 | 5 | 0 | 0 |
| [ZERO-019](AGENCY_ZERO_BATCH_019_REPORT.md) | Order cancellation/handoff | 3 | 3 | 0 | 0 |
| [ZERO-020](AGENCY_ZERO_BATCH_020_REPORT.md) | Evidence review queues | 5 | 5 | 0 | 0 |

## Three engineering disciplines (no fabricated independent certification)

- **ENGINEER:** Actual Chromium UI/inputs and isolated database source tests were executed, with case IDs and SHA256 raw log references. Some tests are unit/platform-only rather than full-browser journeys, and some selected source tests do not cover their complete original scenario. See explicit gaps below. No product runtime changed.
- **CYBERSECURITY:** Source cases meaningfully exercised copied/expired capability isolation, tenant boundaries, concurrent invitation and credit reservation races, immutability, refusal of stale review and public rate limits. The entire authenticated API surface, multi-role penetration campaign, all real adapter contracts and relevant stage exploit scope are **NOT yet fully tested**. Do not count a lack of observed exploits as proof no exploitable issues exist. Open high/critical app-wide count remains **UNKNOWN**.
- **REVIEWER:** Source test titles, actual execution results, log hashes and frozen original IDs are reconciled, but no independent second expert has signed complete UI, code quality, all role handoffs, all threat cases and masterplan acceptance. Full technical certification therefore remains **0/218**.

## One nonpass and exact triage

- `M1.11.02` (ZERO-015): real independent Worker evidence browser test reached qualification, experience, skill and employment rejected/changes-requested/approved checkpoints but was terminated by the **465-second bounded timeout** before final assertion; TAP did not report PASS. **Status: TIMEOUT / cause unconfirmed** (heavy test or product stall); targeted profiling/retest needed. Other tests continued; this failure was not promoted or erased.

## Requirements not proven by selected related tests

These are **unverified original scenario gaps**, never passed by inference:
- `M1.10.04`: The selected dual-employer browser case does NOT explicitly demonstrate a wrong/unlinked Worker accepting another person’s invitation; perform that attack independently.
- `M1.10.05`: Selected relationship ending test does not establish every site/department transfer, invite and Worker recipient variant.
- `M1.10.06`: Real PostgreSQL concurrency checks passed; full second-company invite UI lifecycle and history receiving actor still require independent review.
- `M1.11.08`: The test proves inactive Skill cannot be reopened, not that all report/competency calculations exclude inactive Skill. Verify actual Worker/Company skill counts.
- `M1.12.01`: Selected source allow-list test does not prove complete public QR/capability UI flow across actual credentials.
- `M1.12.03`: Selected read-only helper import policy check does not inspect actual serialized public responses for personal identity, private answers or reviewer notes. Must test negative disclosure.
- `M1.12.04`: One real public Concern to Admin journey passed; scope includes all validation failures and evidence replay/scan denial beyond selected browser case.
- `M2.01.01`: Selected durable Case/Action Centre creation test does not exercise actual Company draft save/edit/add linked Workers UI.
- `M2.01.02`: Selected repeated READY/revoked Worker link check does not cover all invalid/unlinked/ineligible Worker and missing-funding UI explanations.
- `M2.01.03`: Selected concurrent submit idempotency does not prove multi-worker Site/Deadline scope or exact recipient state.
- `M2.01.05`: Selected Worker funding request → Company approval bell test does not prove mixed funding through assessment to final Credential.
- `M2.01.06`: Selected evidence review resolution and Admin escalation test is NOT proof that an Assurance Order CHANGES_REQUESTED/rejected state reaches both Company and Worker. Add direct order workflow.
- `M2.01.08`: Selected partial completed-order cancellation-denial test does NOT verify completed-order readiness counts and actual report output. Add report reconciliation.
- `M2.02.01`: Selected queue creation covers one immutable evidence version, not all submitted evidence kinds, source file context or role queues.
- `M2.02.02`: Selected claim race/copy denial does not cover conflict declaration, reassignment, finalization and all related audit records.
- `M2.02.03`: Selected CHANGES_REQUESTED Worker handoff does not cover every approve/reject/unable/escalate downstream Company and Worker notification.
- `M2.02.05`: Selected calibration UI failure/gate test does not cover full second-review, workload, scope and two-tenant authorization matrix.

## Evidence provenance and non-destructive execution

- Frozen source candidate: `docs/qa/AGENCY_ZERO_CANDIDATE.json`. Queued original batches: `docs/qa/AGENCY_ZERO_BATCHES.json`. Exact attempted queue: `docs/qa/AGENCY_ZERO_CURSOR.json` now at `ZERO-021`.
- Hash-anchored raw logs: original-scenario technical receipt register `docs/qa/AGENCY_ZERO_EVIDENCE.json` with private-workstation paths. **Raw private logs remain on the isolated workstation, not exposed via public GitHub**.
- Real PG16 scenarios used disposable localhost clusters; others used synthetic PGlite/Next.js browser fixtures. No production release, customer accounts, real provider delivery or shared staging changes.
- All eight batches have at most five original scheduled source test identities. No repeats of already fully verified scenarios were performed. Earlier historic source green counts were not promoted.

## Exact next action

1. Guarded commit and push the eight reports, evidence and cursor; confirm hosted checks.
2. Next independent original batch: **ZERO-021**. Keep `M1.11.02` TIMEOUT and all explicit requirement gaps in the unresolved/revisit register for deep 3-discipline closure.
3. When original 218 scenarios have full applicable positive/negative/retry/UI/security/adapter proof and independent review, only then award **TECH FULLY VERIFIED = OWNER TESTING READY**.

Recorded UTC: 2026-11-22T19:09:05.612248+00:00
