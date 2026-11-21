# HSE Verify — 4,975-slot coverage reconciliation (2026-11-14)

**Authoritative source baseline:** signed release QA SHA `8c60c0b789513f427fb56db3fa96dad4afe38d47`, branch `qa/a28-eligibility-read-guard-20261107`, after PR #94 merge. **Release: NO-GO.** This report is a *coverage planning and historical evidence inventory*, **not** a completion or pen-test certificate.

## Exact 4,975 planning slots, now enumerated

| Coverage family | Source observed at baseline | Unique planning slots | Exact protected-stage certified |
|---|---|---:|---:|
| Frozen Masterplan scenario checks | 218 frozen IDs × 12 broad acceptance dimensions | 2,616 | **0** |
| Security candidate checks | 40 exported HTTP handlers + 211 exported server-action functions, × 8 broad abuse families | 2,008 | **0** |
| Responsive UI checks | 117 `src/app/**/page.tsx` files × 320, 390, 1280 px | 351 | **0** |
| **TOTAL** | 37 frozen bricks, 251 candidate entry points | **4,975** | **0** |

**4,975/4,975 pending complete release attestation.** Do **not** mistake that for 4,975 unexecuted software tests. The same code may have been exercised previously. It means no independently attested, exact-*final*-SHA protected-stage check can currently be marked complete under the owner's full gates.

The full row-level preliminary CSV is `docs/qa/evidence/QA_4975_PROVISIONAL_REGISTER_20261114.csv`. Each row includes stable target/dimension/check ID, historical hint, source baseline and **NOT_CERTIFIED** state. The deterministic generator is `python3 scripts/audit-4975-coverage.py`; its machine-readable summary goes to `.autopilot/artifacts/verification-4975-coverage.json`.

**Important limit:** This is a **provisional planning budget**, not a real executable-test denominator. Some slots overlap or are inapplicable, and some complex flows demand more cases; security families exclude additional specialized exploitation, providers, ransomware/safe operations and business logic. The true executable-test denominator requires per-action case inventory, applicability review, multiple roles/tenants and independent pentest scope signoff. Do not market the 4,975 figure as an exhaustive penetration test.

## Existing passing evidence is real but cannot be subtracted from 4,975

1. Frozen historical `docs/qa/2026-10-02-evidence.json`: **36 old `passed` scenario labels**, **15 old partially verified**, **167 not yet verified in the expanded run**, total **218**. None represents a final protected-stage FULLY_VERIFIED scenario.
2. **26 preserved historical/scoped TSVs** under `docs/qa/evidence` contain **146 result rows** associated with **20 scenario IDs**. Conservative row parser flags **98 green rows**, including **173 *reported* passing-case executions in the rows with a numeric test count**, with **10 green rows lacking a numeric test count**. There are **16 RED/FAIL-tagged rows**, some intentionally expected TDD failures. These counts include older SHA reruns, possible duplicate suites and non-test checks; raw logs were **not independently re-executed and adjudicated one-by-one** as part of this bookkeeping audit. Thus the count of **unique, exact-final-stage passed slots among the 4,975 remains 0**, not 173.
3. Actual GitHub CLI inspected `gh run list --repo itxsam57/hseverify-production-hardening --commit 8c60c0b789513f427fb56db3fa96dad4afe38d47 --limit 100 --json databaseId,status,conclusion,workflowName`: **28/28 exact-SHA GitHub workflow runs concluded success**. Those indicate scoped CI passed, not total staged/browser/provider/role/pen-test/owner signoff.
4. Repository contains substantial tests (545 `tests/**/*test.mjs` source files when counted on this baseline), but a test's existence, static `test()` invocation or green CI is not unique coverage of an acceptance slot.

## Current canonical release statuses

Fresh run of `npm run audit:current-218-scenarios` on QA baseline:

- **FULLY_VERIFIED: 0/218**.
- **IN_PROGRESS: 1**; **BLOCKED_EXTERNAL known: 10**; **NOT_STARTED: 207**.
- **PENTEST: incomplete**. High/critical open finding inventory is **unknown**, not zero.
- **NO-GO**, regardless of historical TDD or 28/28 CI.

**Ten known externally blocked IDs:** `M1.01.04`, `M1.03.02`, `M3.10.01`, `M3.10.02`, `M3.10.03`, `M3.10.04`, `M3.10.05`, `M3.12.02`, `M3.12.03`, `M3.12.04`. Dependencies include protected production-like stage, real email/SMS, payment, storage/scan/identity, media/TURN, operational monitoring/alerts, managed backup/rollback and owner UAT.

## Which coverage is still missing?

- **Scenario 2,616 slots:** per frozen ID and every applicable dimension, final exact-SHA actual browser interactions (all roles), negative/retry/expiry/replay/race, notifications and receivers, DB/audit, legitimate providers and Owner UAT.
- **Security 2,008 provisional slots:** for each exported HTTP handler and server-action candidate, direct unauthorized role/tenant/object inputs, stale/replay sessions, injection/input abuse, workflow/race abuse and privacy leakage. Also inventory actual reachability and specialize for CSRF/XSS/SSRF, file malware/polyglots, public links/QR, proctoring, payment/refunds/webhooks and abuse/rate-limit protection.
- **UI 351 slots:** true browser screenshots/interaction assertions for each page at **320/390/1280**, including overflow, keyboard/accessibility and state transitions. A static page file's existence is not proof.
- **Cross-cutting (outside budget):** full authorized staged penetration test, real providers, controlled load, restoration, security fixes and independent retests, final owner acceptance and identical SHA/config signoff.

## Execution and honest promotion procedure

1. Turn provisional slots into **actual executable case IDs** with exact role(s), prerequisites, attack inputs, success/denial outcomes, assertions and logging; mark truly inapplicable dimensions only with reviewed justification. Recompute executable denominator; never silently assume 4,975 covers all cases.
2. Rerun required browser/API/providers on **one protected final candidate SHA/config**. Attach exact commands, exit codes, role/tenant/DB/audit assertions, raw logs and artifacts; map case IDs to the register.
3. Run independent full authorized stage pentest and realistic load/restore/rollback. Fix confirmed leaks, retest exploit + regressions, record owner UAT.
4. Only after independently verifying every applicable dimension, promote the related frozen scenario in the separate **218 canonical release ledger**. The planning CSV does **not** have automatic promotion logic.
5. Reconcile all 218 and full pentest **again** on any final code/config change.

**First actionable next step:** add individual scenario-action test cases for `M1.01.01` and release staging gate; assign linked evidence to the 12 dimensions, then expand in frozen ID order while unblocking real providers. Historical passing M1.04 scoped BOLA coverage can be reused as *test design*, never as final certification.
