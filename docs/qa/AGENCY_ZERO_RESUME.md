# ZERO — exact agency QA continuation checkpoint (2026-11-21)

**CURRENT CONTROL:** [AGENCY_ZERO_PROTOCOL.md](AGENCY_ZERO_PROTOCOL.md), not the old M1-first owner-signoff loop.

## Frozen application source (prevents progress-reset loop)

`docs/qa/AGENCY_ZERO_CANDIDATE.json` currently pins application runtime/config to **`7ff30ea140a5145e5d5ba761f7c7aef24c895269`**. Later QA policy/report/attestation commits have a different Git HEAD, but do **not** alter this app version or invalidate its technical evidence. Any actual `src`, database, public/config/ops/package/build/runtime-file change fails the ZERO pin check until a source-candidate review and affected regression revalidation. Never silently repin after a new app fix.

## Immutable starting inventory (read-only)
- Frozen original Masterplan: **218 scenarios**, **37 related bricks**, **4,975 historical planned check slots** (these slots are not 4,975 verified test executions).
- Deterministic initial agency test scope: **58 batches**, maximum **5 related scenarios/test units per batch**; first **ZERO-001** (M1.01, 4).
- Historical evidence index: **1,610 distinct preexisting source-case identities**, **1,436 historical clean-green case claims**, **561 indexed .test.mjs files**, **68/218 scenarios linked to existing exact source-case IDs**; remaining **150 require evidence reconciliation, NOT automatically new tests**.
- At the starting checkout: 106 existing GitHub workflow files, 626 files under `tests/` of all types, and ~190 registered canonical worktrees. Most are historic/idle; **do not delete**.
- Recent 60 GitHub Actions runs checked 2026-11-21: 58 success, two independent-audit failures; no queued or in-progress in that 60-run sample. Host `ps` snapshot: no matching active HSE test runner. This is **one snapshot**, not a guarantee that no other work exists.
- Original final-release certificate `npm run audit:current-218-scenarios`: 0/218 **full production acceptance**, because live providers, trusted final staging, full pentest, owner UAT remain outstanding. The **new technical owner-ready count starts separately at 0/218**; historic scoped cases cannot be promoted by fiat.

## 2026-11-21 ZERO first hosted-governance CI correction

- Initial ZERO commit `39f1ee9323e593d5a09e9972e7a8d51aac51221f`: two new ZERO integrity workflow runs **SUCCESS**, and Autopilot V4 check **SUCCESS**. The original 218 release-ledger and 4975 historic-index CI runs initially FAILED because the preceding `fb220061` browser shard diagnostic assertion changed an existing `.test.mjs` source without rebinding the **existing test-source SHA256 index**. This did **not** change the test identity or execution evidence.
- Corrected **only** `counts.current_test_source_content_sha256` in the original `MASTERPLAN_218_EXECUTED_TESTS.json` and the new index's SHA256 parent pointer in original `MASTERPLAN_218_LEGACY_216_OBSERVATIONS.json`. All **four** original index verification commands and original **8+5+9** reconciliation tests passed locally; original 218 ID, 1,610 cases, 1,436 historical green, and 4,975 planned dimensions unchanged. **Re-run hosted checks on the guarded fix commit before merge.**
- Still **no product source edits, no staging changes, no Owner-ready scenario pass and no independent full pentest**.

## 2026-11-21 legacy-policy assertion migration

- Hosted exact-SHA ledger and 4975 integrity checks still RED on `1a5fe54` because two legacy *policy text* tests demanded old M1-first wording in `AGENTS.md`, which the owner explicitly superseded. **The underlying original 218/37 source, 1436/1610 historical case proof, 4975 slot reconciler and scope counters passed.**
- Restored the existing safe bounded `npm run qa:preflight-218` requirement in the new AGENTS block; updated only the old policy-assertion test `tests/engineering/test_vertical_218_progress.py` to enforce the current ZERO owner rules, while retaining all original strict release-ledger numeric and scenario-order checks. Local vertical policy **4/4 PASS**, disk automation **2/2 PASS**. New guarded push/hosted recheck required.

## Open genuine red and pending checks
- Independent audit [GitHub run 44917041107](https://github.com/itxsam57/hseverify-production-hardening/actions/runs/44917041107) on `fb220061ae78c3aae957184e366f22e7a85acb54`: existing `npm run verify:full` failed on a PG rollback test `tests/platform/interview-finalization-runtime.test.mjs:333`, "Appeal response notification contract drift prevents rollback". **Not fixed, no false green.** Determine application migration drift vs test fixture, preserve exact evidence, open a scoped fix only once independently reproduced. This is a known-red release gate, not a reason to stop unrelated read-only testing.
- Same CI run: 21/21 automated signed-out axe page+viewport scans produced zero axe violations; passive unauthenticated localhost ZAP found 14 alert categories, zero high-risk **in that limited synthetic scan**. Neither is authenticated/full security certification. Other full test/product issues may exist.
- Draft [PR #206](https://github.com/itxsam57/hseverify-production-hardening/pull/206) adds independent QA checks; **unmerged and undeployed**. This ZERO protocol/batch plan is appended only in its isolated branch, and must pass Autopilot V4 and CI before any merge.
- Other old chat and its worktrees/processes: **do not restart governors or start duplicate environments**. Existing signed staging PG16 and all other active/private work remain untouched. Owner UAT/provider-live final verification comes later.

## ZERO-002 hosted governance check correction

Hosted PR branch `f821e623b01359dfc5f61665f4a693fc222fb5c0` had 218/4975 release evidence and V4 compliance green, but new ZERO integrity CI 10/11 tests passed and one failed because the **test itself hardcoded the previous next-batch ID `ZERO-002`**. The actual cursor was correctly advanced to `ZERO-003` after 5 successful scoped UI cases. Updated only the governance test to derive the next batch from its attempted count, preserving the frozen 218 order and fail-closed skips. Local ZERO governance **11/11 PASS**. Confirm new hosted checks on the guarded fix commit. No app source changes; no evidence credit added.

## ZERO-007 actually executed

[Batch report](AGENCY_ZERO_BATCH_007_REPORT.md): selected cases 5/5 PASS; 0 technical full. Frozen app SHA 7ff30ea140; full security/role/UI/independent review still pending. Exact raw hashes in receipt and report. Next ZERO-008; no prod code changes.

## ZERO-008 actually executed

[Batch report](AGENCY_ZERO_BATCH_008_REPORT.md): selected cases 5/5 PASS; 0 technical full. Frozen app SHA 7ff30ea140; full security/role/UI/independent review still pending. Exact raw hashes in receipt and report. Next ZERO-009; no prod code changes.

## ZERO-009 actually executed

[Batch report](AGENCY_ZERO_BATCH_009_REPORT.md): selected cases 1/2 PASS; 0 technical full. Frozen app SHA 7ff30ea140; full security/role/UI/independent review still pending. Exact raw hashes in receipt and report. Next ZERO-010; no prod code changes.

## ZERO-010 actually executed

[Batch report](AGENCY_ZERO_BATCH_010_REPORT.md): selected cases 5/5 PASS; 0 technical full. Frozen app SHA 7ff30ea140; full security/role/UI/independent review still pending. Exact raw hashes in receipt and report. Next ZERO-011; no prod code changes.

## ZERO-006 actual executed batch (2026-11-22)

[Batch ZERO-006 report](AGENCY_ZERO_BATCH_006_REPORT.md): **4/4 selected scoped tests PASS** — two-tenant audit history, review resolution notifications and guarded role links, all-role bell/open/deeplink/read state, durable outbox approval surviving provider outage with idempotent retry. 3 real browser source cases + 1 isolated PGlite platform source case, one PASS each. **0/4 TECH FULL** pending full authorized security review, all workflow variants and independent reviewer. Exact raw logs SHA256 recorded in same original scenario evidence register; production unchanged. Cursor now **ZERO-007**, previously attempted ZERO-001..006 retained for revisits.

## ZERO-005 actual executed batch (2026-11-22)

[Batch ZERO-005 report](AGENCY_ZERO_BATCH_005_REPORT.md): **4/4 scoped original Chromium authorization tests PASS** — Admin Server Action cross-role/anonymous replay blocked; Company A/B secure PDF token/header and HEAD/range isolation; Worker A/B forged IDs/signed URL boundaries; Company owner/full Team membership scope, suspension, revoked sessions and regrant lifecycle. Three discipline review coverage still incomplete; **0/4 TECH FULL**. Exact raw workstation logs hashed in evidence receipts, app source `7ff30ea...` unchanged. Cursor now **ZERO-006**; prior ZERO-001..005 remain available for full expert signoff and later security scope completion. No production writes.

## ZERO-004 actual executed batch (2026-11-22)

[Batch ZERO-004 report](AGENCY_ZERO_BATCH_004_REPORT.md): **3/3 original exact scoped Chromium cases PASS** for six-role login/negative MFA/cross-portal responsive checks, six-role copied-cookie replay after signout, six-role password reauthentication and other-session revocation. Real isolated PGlite, source pinned `7ff30ea...`, no prod/stage edits. **0/3 technical complete**: deep pentest, role coverage, independent reviewer still needed. Cursor now **ZERO-005**, prior ZERO-001..004 remain open and recorded; raw 3 source logs hashed in evidence register.

## ZERO-003 actual executed batch (2026-11-22)

Five actual synthetic browser source cases PASS: Worker signup policy, email and phone OTP, duplicate Worker and recovery, Company pending MFA, and staff invitation cancel/retry/role isolation. [Full report](AGENCY_ZERO_BATCH_003_REPORT.md). Scoped 5/5, technical FULL 0/5. Raw private logs hashed; no provider-live or production mutation. Cursor advanced to ZERO-004; ZERO-001/002/003 remain in revisit queue for deeper security, workflow and independent reviewer evidence.

## ZERO-002 actual executed batch (2026-11-22)

[AGENCY_ZERO_BATCH_002_REPORT.md](AGENCY_ZERO_BATCH_002_REPORT.md): **5/5 original scoped real Chromium cases PASS**: public nav all role destinations, all six role support menus, error retry boundaries, mobile six-role responsive nav, unsaved metadata keyboard/focus/navigation (history fallback=false). **0/5 TECH FULL** until full connected workflow, deeper attack tests, independent reviewer; no assumed pass. Raw 5 logs SHA256 in the report and original case receipts. `docs/qa/AGENCY_ZERO_CURSOR.json` advances to **ZERO-003**, retaining both ZERO-001 and ZERO-002 for missing final technical evidence. Application source pinned unchanged, no production/stage mutations. Historic QA full regression red remains open; never call this release-approved.

## ZERO-001 actual executed batch (2026-11-22)

Evidence/report: [AGENCY_ZERO_BATCH_001_REPORT.md](AGENCY_ZERO_BATCH_001_REPORT.md). **0/4 TECH FULL**. Real disposable PG16 original migration checks **2/2 PASS**; Chromium CSP original assertion **FAIL** then diagnostic retry **PASS** with blocked inline handler, still unstable; pinned exact-commit CI 91/92 green with one failed audit; previously running loopback TLS stage GET200 with security headers but stage metadata not pinned SHA. High/critical whole-app count **UNKNOWN**, not zero. No code/production/staging writes. All four scenarios recorded as partial/unresolved in the original scenario receipt registry with raw local artifact SHA256s. Active attempted-batch cursor is `docs/qa/AGENCY_ZERO_CURSOR.json`: **next ZERO-002**, previous ZERO-001 stays in revisit list. This is a real executed batch, not a full feature certification. Separate independent engineering/security/reviewer attestations not yet awarded.

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
