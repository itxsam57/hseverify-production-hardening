# ZERO — HSE Verify agency-style technical verification (owner-approved 2026-11-21)

**THIS is the active testing policy.** It supersedes the previous *scheduling* and *FULLY_VERIFIED* meaning in the M1-first/strict final-owner-signoff loop. It does **not** waive security, the repository's Autopilot V4 guard, signed commits, code safety, provider-live launch checks, or production release gates.

**Mission:** inspect every built feature, its complete cross-role workflow, UI, implementation, database/API effects, security boundaries, and intentionally open adapters. Establish **218/218 TECH FULLY VERIFIED = OWNER TESTING READY** before the owner's last acceptance pass. There is no requirement to perform owner UAT or real external-provider delivery before technical verification. **LAUNCH APPROVED** is a separate later status and still requires owner UAT and real provider/production readiness.

## One source, one queue, no resets

- **Canonical scenarios and order:** `docs/qa/evidence/MASTERPLAN_218_ALL_PREVIOUS_EVIDENCE_ACTIONS_20261114.csv` (218 IDs, 37 related bricks). Do not rewrite IDs, duplicate them, shrink scope or create another Masterplan. `docs/qa/AGENCY_ZERO_BATCHES.json` is only a deterministic *view* of the original queue: **58 initial batches with 1–5 original scenario/workflow units each**. A scenario is a single cohesive tested journey, potentially with many linked assertions; never schedule more than **five independently executed test cases or five workflow units in one batch**. A full test *file* with many cases is not a single unit; enforce the actual case count.
- Keep all previous engineering/browser/CI evidence; reconcile by source-case ID and exact tested SHA. Historical 1,436/1,610 sourced green claims and the 216/218 partial scoped report **cannot be automatically promoted**. At initial inventory, 68 scenarios have an explicit source-case link in the old index, 150 require evidence mapping/reconciliation, **not necessarily new tests**.
- `docs/qa/AGENCY_ZERO_EVIDENCE.json` stores **attestations only** for original scenario IDs; it is not a competing 218-row ledger. Only `scripts/agency_zero_control.py --status` derives the current exact-SHA **technical** numerator. The pre-existing `npm run audit:current-218-scenarios` remains the separate *production-release* certificate and does not redefine technical owner-readiness.
- **Progress cannot reset merely because a QA report is committed.** `docs/qa/AGENCY_ZERO_CANDIDATE.json` pins the tested **application source commit** separately from the moving Git QA tooling/evidence HEAD. `scripts/agency_zero_control.py --check` rejects runtime/config code drift against that pin. Documentation, test-logging and audit commits do not invalidate prior signed app-SHA technical results. Actual application changes require an explicitly reviewed candidate repin, affected-check revalidation and final common regressions; prior receipts remain preserved for comparison.
- Every artifact: source SHA (40 chars), configuration fingerprint, tested feature and roles/tenants, expected and observed results, commands, exact testcase IDs, timestamps, logs/screenshots/traces with hashes, security findings, reviewer decision and next action. Store raw sensitive evidence only in the already-private evidence vault after safety review. Do not overwrite old receipts or delete dirty/work-in-progress worktrees.
- Confirmed technical outcomes are **frozen against their exact tested SHA/config**. They are not erased when the chat rotates. For later changes, invalidate and re-run the affected checks and the required common regressions; do not blindly restart all 218, and do not claim old-SHA evidence certifies untested new code. Final confirmation requires a consistent final candidate.

See [AGENCY_ZERO_REVIEW_MATRIX.md](AGENCY_ZERO_REVIEW_MATRIX.md) for the **37 domain-specific engineering/security/reviewer charters** and the original scenario description for the actual test obligations.

## Required independent disciplines for *each* applicable workflow

**Engineering lead** — Inspect clear, compact and maintainable code (remove confirmed dead or duplicate code only with dependency proof); run real user-visible browser controls, valid and invalid forms/text/document upload/replacement, refresh, keyboard/mobile, error/retry/cancel/expiry/concurrent actions; verify persisted PostgreSQL state and audit, error boundaries, notifications/deep links, next-role and final-role correct action and feedback. Test every connected step rather than assuming a route exists.

**Cybersecurity lead** — Use OWASP ASVS/WSTG/API testing principles. Assess authenticated and anonymous access, all six roles and cross-company/worker/tenant isolation; stale, forged, revoked and replayed tokens; auth/OTP/MFA/session boundaries; upload quarantine and document data exposure; XSS, CSRF, injection, SSRF, authorization bypass, BOLA/IDOR, secrets/log leakage, rate limits, integrity/proctoring, payments/webhooks, concurrency and business logic relevant to the scenario. Include both automated scanners **and manual/targeted adversarial tests**. Passive ZAP or green dependencies alone are never pentest completion. Record scope, executed attacks, exploit proofs or negatives, confidence, false positives, and remaining coverage. No unresolved known high/critical finding in tested scope qualifies for TECH FULLY VERIFIED.

**Independent reviewer** — Check the original Masterplan intent, expected receiving role/result, real visible UI/UX/responsiveness/accessibility, untested edge cases, raw evidence/code/CI consistency and any proposed fix. Reject "green" from mocks or scripts that never exercise the required behavior. Reviewer may be another AI agent or qualified person, but must **never be falsely represented as a licensed outside agency**. Report the actual reviewer/source of judgment.

**Intentionally disconnected adapters** (email, SMS/OTP sending, payment, scanning, identity, video, storage etc. where applicable) count as **ADAPTER CONTRACT PASS** only when the adapter is genuinely implemented and successfully exercises sandbox/fake-provider delivery intents or acceptance, validation/authentication, error/retry/idempotency, duplicate/replay/outage recovery, observability and configuration failure behavior as applicable. `PROVIDER_LIVE_NOT_TESTED` is a clearly separate launch gate. The entire functional workflow cannot be called working if an intended internal handoff is broken.

## Per-case statuses and closure

- `NOT_TESTED`: not yet technically verified on this candidate.
- `SCOPED_PASS`: one or more checks passed; **not** a verified feature.
- `FAIL`: actual reproducible product/security or test issue; identify subtype.
- `NEEDS_EVIDENCE`: old matching evidence exists or candidate link missing; investigate before duplicate work.
- `BLOCKED_EXTERNAL`: genuinely cannot safely exercise a test now, with exact dependency/action; keep it visible, continue independent work.
- `TECH_FULLY_VERIFIED`: engineer, full functional+cross-role, UI/a11y, relevant security pentest, independent reviewer, and adapter contracts (or documented not applicable) all **PASS on exact SHA/config**, with evidence and zero unresolved high/critical security findings. This means **owner testing ready**, not deployed/provider-live/owner-approved.
- `INVALIDATED`: a change affects evidence; repeat targeted checks before recertifying on new SHA.
- `LAUNCH_APPROVED`: separate post-218 owner UAT, signed deployable release, real providers, supported production configuration, full scope pentest, load/restore/oncall/rollback and owner approval.

Only the actual evidence-attestation checks can award technical verification. A passed GitHub job, unit test, scanner, source-code review or green adapter mock by itself is `SCOPED_PASS`, never `TECH_FULLY_VERIFIED`. No guessing or numerator inflation.

## Bounded no-stall batch algorithm

1. **Preflight:** exact source branch/SHA, V4 session, active worktrees/tests, free disk, signed canonical scenario/evidence map and last failed jobs. Preserve all active work. Do not create duplicate servers or destructive shared-state tests.
2. **Select one of 58 deterministic related-workflow batches**, maximum five scenario units or scheduled test-case identities. Work through related roles in one actual scenario. Use historical logs to avoid redoing valid work. Avoid unrelated cases in the same batch.
3. **Execute in isolated disposable CI or approved test stage** with realistic browser and database; use test accounts/companies only, no real customer identities. At most two independently isolated batches in parallel after environment-capacity checks; never more than one concurrent writer to the same database. Enforce per-case and per-batch timeouts. Other existing required repository CI regression jobs can continue as **separate release guards**, but must not be misreported as the current five-case batch.
4. Record separate **engineering / cybersecurity / reviewer** findings for each case. Review both positive and negative results, full receiving actor, API/database/audit, mobile UI, retries, misuse and relevant adapters. If evidence incomplete, do **not** certify.
5. **Triage:** classify every red as PRODUCT_DEFECT, TEST_DEFECT, ENVIRONMENT, SECURITY, EXTERNAL, or INCONCLUSIVE. Retry suspected transients **once** with evidence. After at most **two targeted diagnosis/repair attempts**, park the exact blocker and continue other safe independent batches. A known severe security issue gets prioritized for fixes and release prevention, not permission to silently skip security.
6. **Fix separately** in a new protected isolated branch, smallest root-cause change, guarded PR and targeted regression plus related workflows. Never alter a running other worktree, staging, protected branch or production as a side effect. Never weaken the security/compliance tests or bypass hooks.
7. **Persist immediately:** save batch ID, each scenario outcome, external blocker, logs/hashes, SHA/config, current command/run URL, failures, reviewer comments, next actionable case, and progress (tech confirmed, scoped-only, failed, external, pending). Next AI resumes from these records, not chat memory. Stalled/timed-out cases retain their result; independent batches continue. No automatic long unbounded loop and no repeated rechecks without a change.
8. Once all **218 owner-ready** attestations exist, execute a consistent final SHA/config technical regression and a comprehensive authorized *independent-scope* attack campaign. Then present the final evidence package to the owner for their last UAT and subsequent provider-live/launch signoff. Do not represent a self-run AI-led audit as certification by an accredited third-party agency.

## GitHub workflow activation

The new `agency-zero-governance.yml` checks schema, tamper prevention and the 218 original IDs without product mutations. The `agency-zero-batch.yml` supports one selected batch or `ALL`, at most two parallel isolated runners, `fail-fast: false`, one exact-SHA artifact per batch, and a hard maximum of five selected source test cases per batch. **These initial scoped checks are not the full three-reviewer agency examination.** Missing old source-case links are reported as evidence gaps rather than automatically passed.

GitHub manual workflow dispatch may require the workflow to exist on the repository default branch before it is visible. Until then, preserve the guarded PR, use safe local validation and review PR checks. Never merge a known-red build just to expose a button.

## Safe pentest scope

The owner authorizes extensive testing **of their own application** through the workstation and browser. Active exploitation, load tests, account attacks, payment callbacks, provider requests and any destructive behavior must be limited to an explicitly bounded, synthetic, isolated and approved environment. No attack on unrelated websites, third parties, production users/data, or live provider systems; no credential leakage. Use genuine PostgreSQL 16 and production-like stage where the test requires them. Report constraints honestly.

## Mandatory ZERO chat/report contract

Every testing response begins with the literal uppercase word `ZERO`, including responses to "continue", "yes", "blue" or any other brief instruction while this testing project is active. No exceptions in the testing project.

**Always use this compact structure, no walls of text:**

```text
ZERO | TECH VERIFIED 0/218 [░░░░░░░░░░] | OWNER READY: NO
BATCH ZERO-001/058 | x/5 units | PASS p | FAIL f | BLOCKED b | NEEDS EVIDENCE e
ENGINEER: <short> | CYBERSECURITY: <short> | REVIEWER: <short>
NEXT: <one precise test or fix> | SHA: <short> | EVIDENCE: <link/path>
```

- The bar refers **only** to exact-SHA technical fully verified scenarios, never source test pass counts, number of scans, task volume or external launch approval.
- `PASS` means evidence-backed scoped check pass unless explicitly labelled `TECH FULLY VERIFIED`. All unknowns must be `UNKNOWN`, never zero.
- If nothing ran, say `INSPECTION ONLY`. If interrupted, include exact next step and retained batch ID. Never claim autonomous background work unless a real scheduled job exists.
- A complete result is **test evidence, its limitations, a brief status and one next action**, not more text.
