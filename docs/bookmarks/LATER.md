# Bookmark: Later

## Current hardening mission — 11 September 2026

The owner explicitly superseded the earlier single-brick execution restriction with
`.codex-governor/mission.md`, on branch `codex/hseverify-full-hardening-20260911`
only. Preserve M1.01–M1.07; hard-reverify M1.08 onward against the canonical
masterplan, then complete remaining M2/M3 requirements in order. Do not merge or
push main. Historical owner acceptance is not inferred from automated tests.

Repository evidence at base `b8fd9609284bea8b52a6bcb159f208796ff6480f`:
M2.08 implementation was merged in `648af16` and closure recorded in `858c237`.
Its production modules are in `src/lib/assessment-attempt/`, migration `0043`,
and permanent runtime/browser tests are wired through `test:m2-08` and
`scripts/m2-08-browser-qa.mjs`. Thus “M1.12 only” and “M2.08 not built” below
are historical execution statements, superseded for this mission.

Existence is not full canonical completion: M2.08's historical acceptance excludes
replacement forms, device binding and an INTERRUPTED lifecycle. These remain
repository work under masterplan sections 16, 35 and 36. The mission ledger retains
ACTIONABLE status until current implementation and rendered workflow evidence
close each requirement. Provider absence alone never closes missing local code.


## Purpose

This register records canonical requirements that are not yet fully implemented/accepted plus provider/maintenance items intentionally left open. “Later” never means optional. Resolved requirements remain in resolved history and must not reappear in the open table without an explicit reopen/regression decision.

Canonical product/engineering authority is `docs/Masterplan(HSE Verify).md`. The exact build gate is `docs/NEXT_BUILD_UNIT.md`; permanent brick status is `docs/bookmarks/MILESTONE_PATH.md`. If a status statement in this register conflicts with either build-control document, `NEXT_BUILD_UNIT` and `MILESTONE_PATH` control current sequencing/status and this register must be corrected.

## Status meanings

- **Not started** — canonical work has not begun.
- **Partial** — prerequisite behavior exists but the complete canonical workflow is incomplete.
- **Ready to build** — previous brick is accepted and this requirement belongs to the current permitted brick.
- **In progress** — current permitted work is under implementation/acceptance.
- **Engineering implemented / owner acceptance deferred** — implementation is merged and engineering gates passed, but required owner/browser acceptance has intentionally not yet been performed; this is not DONE.
- **Provider blocked** — production activation needs an approved external provider/service.
- **Compatibility override** — tested override retained until a safe parent upgrade replaces it.
- **Resolved** — implementation plus required automated/owner acceptance passed.

## Open Later register

| ID | Brick | Requirement | Status | Why still open | Completion target |
|---|---|---|---|---|---|
| LATER-029 | M1.08 | Company verification case | Engineering implemented / owner acceptance deferred | Implementation is merged and Engineering PASS; owner/browser acceptance is intentionally deferred with the rest of the visible M1.08–M1.12 boundary. | Combined Milestone 1 owner/browser acceptance after M1.12 is engineering-green. |
| LATER-030 | M1.09 | Sites, departments and Company team scoped permissions | Engineering implemented / owner acceptance deferred | Implementation is merged and Engineering PASS; visible owner/browser acceptance remains intentionally deferred. | Combined Milestone 1 owner/browser acceptance after M1.12 is engineering-green. |
| LATER-031 | M1.10 | Worker invitations and Company codes | Engineering implemented / owner acceptance deferred | Implementation is merged and Engineering PASS; visible owner/browser acceptance remains intentionally deferred. | Combined Milestone 1 owner/browser acceptance after M1.12 is engineering-green. |
| LATER-032 | M1.11 | Qualification, experience, employment, skill and leaving-letter records | Engineering implemented / owner acceptance deferred | Implementation is merged and Engineering PASS; visible owner/browser acceptance remains intentionally deferred. | Combined Milestone 1 owner/browser acceptance after M1.12 is engineering-green. |
| LATER-033 | M1.12 | Real public Worker/Credential verification foundation and Report a Concern | In progress | M1.12 is the only active product brick; clean-rebuild lookup/projection/rate-limit/concern/QR foundation is under implementation and not yet accepted. | Complete M1.12 exact-head and merged-main Engineering gates, then the combined Milestone 1 owner/browser acceptance. |
| LATER-035 | M1.05/M3.10 | Live email provider credentials | Provider blocked | Durable queued/local-test delivery is accepted; production provider activation is later. | Activate in M3.10 without changing queue semantics. |
| LATER-036 | M1.03/M3.10 | Live SMS/phone OTP credentials | Provider blocked | Phone OTP state machine is accepted with sandbox delivery. | Activate approved sender/provider in M3.10. |
| LATER-037 | M2.11–M2.12/M3.10 | Live video/interview provider | Provider blocked | Interview workflow/provider adapter is not built. | Build in M2; activate in M3.10. |
| LATER-038 | M1.07/M3.10 | Live liveness/face/document identity provider | Provider blocked | M1.07 accepted the provider-neutral deterministic/fail-closed identity-check boundary; no approved live production provider is connected. | Activate approved live provider in M3.10 without changing M1.07 assurance semantics. |
| LATER-039 | M1.06/M3.10 | Live malware-scanning service | Provider blocked | Durable local/test scanner foundation is accepted; no approved production scanner is connected. | Activate real provider in M3.10 without bypassing accepted lifecycle. |
| LATER-040 | M3.05/M3.10 | Live payment provider and signed webhooks | Not started / provider blocked | Billing belongs to M3 and requires approved credentials. | Complete M3.05 then activate in M3.10. |
| LATER-043 | M1.01/M3.10 | Hosted preview URL and production traffic switching | Provider blocked | Provider-neutral artifact exists; hosted traffic integration is not connected. | Activate in M3.10. |
| LATER-044 | M1.01/M3.10 | Remove explicit PostCSS and Sharp compatibility overrides | Compatibility override | Next.js `16.2.12` still uses tested secure-floor overrides. | Remove only after a safe Next.js upgrade passes the complete gate. |

## Active progress record

### M1.12 — Public Verification Foundation

- **Status:** IN PROGRESS; M1.12 is the only permitted product brick.
- **Open M1.12 Later ID:** `LATER-033`.
- **M1.08–M1.11:** implementation merged and Engineering PASS; owner/browser acceptance intentionally deferred, not DONE.
- **M2.01 through M3.12:** BLOCKED by current sequencing unless the owner explicitly changes the frozen path.
- **Exact gate:** `docs/NEXT_BUILD_UNIT.md`.
- **Permanent status/order:** `docs/bookmarks/MILESTONE_PATH.md`.
- **Canonical product/engineering authority:** `docs/Masterplan(HSE Verify).md`.

No later M2/M3 runtime/product implementation may be imported to make M1.12 appear complete. M1.12 must prove its own privacy-safe public verification, opaque-result authority, non-enumeration, rate limits, QR/manual fallback, immutable Report-a-Concern triage, optional M1.06-scanned private evidence lifecycle, migration/restart safety and lower-brick compatibility before progression.

## Resolved history

### M1.07 — Worker Onboarding and Identity Engine

- **Status:** DONE — OWNER PASS — 11 August 2026, subject only to this formal closure branch completing its exact-head/merge/merged-main gates.
- Final accepted owner-tested release: `4858c05fcab9d8e4fa4cc09d4cfc2243dc313177`.
- Final exact PR head `6dbac3cddeb8bea1ae85b7f92c065fa2716e0bc3` passed gate `31446794451`.
- Merge `4858c05fcab9d8e4fa4cc09d4cfc2243dc313177` passed merged-main gate `31447079334`.
- Targeted `/worker/identity` owner/browser retest — PASS — 11 August 2026.
- Final record: `docs/testing/results/M1_07_FINAL_ACCEPTANCE.md`.
- `LATER-023` — identity metadata and identity-document/supporting evidence workflow — RESOLVED through the versioned identity draft plus M1.06/S3 private evidence binding.
- `LATER-024` — profile photograph/selfie evidence — RESOLVED through the accepted private evidence workflow.
- `LATER-025` — provider-neutral liveness/identity-check workflow and safe unavailable/degraded handling — RESOLVED for M1.07; live production activation remains `LATER-038`.
- `LATER-026` — duplicate-worker signals and controlled duplicate disposition — RESOLVED without silent/automatic merge.
- `LATER-027` — permanent Worker ID issuance — RESOLVED with verified-only, eligibility-gated, opaque, unique and idempotent issuance.
- `LATER-028` — Worker identity verification states and retained versions — RESOLVED for the M1.07 Worker/state/version boundary; reviewer-facing queues/assignments remain the separate M2.02 brick.
- Permanent release regressions REG-077 through REG-079 remain guarded; earlier M1.07 regression protections remain inherited.
- Live identity-provider activation `LATER-038` remains open and does not reopen M1.07.

### M1.06 — Secure Storage and Upload Pipeline

- **Status:** DONE — ENGINEERING PASS — 10 August 2026.
- **Subunit 1:** secure-file domain/private local-test storage — DONE.
- **Subunit 2:** isolated upload validation/quarantine — DONE.
- **Subunit 3:** durable malware scan/local-test scanner — DONE.
- **Subunit 4:** authorized signed preview/download — DONE.
- **Subunit 5:** cumulative M1.06 isolation/migration/recovery/acceptance — DONE.
- Exact Subunit 5 head `86d135f87a2a2b53f12b8d5b1a2438944cd426fc` passed gate `31362444454`.
- Merge `4ee689e244c938d04a7db3d58306cff8e20b6213` passed merged-main gate `31362848897`.
- Acceptance evidence commit `03ac4ac48ee8477833999829c56f829365b92a9e` passed full main gate `31363206957`.
- Final record: `docs/testing/results/M1_06_FINAL_ACCEPTANCE.md`.
- `LATER-018` — private object-storage adapter — RESOLVED by Subunit 1.
- `LATER-019` — independent/cross-file upload isolation — RESOLVED by Subunit 2.
- `LATER-020` — PDF/PNG/JPEG extension/MIME/signature/size validation — RESOLVED by Subunit 2.
- `LATER-021` — quarantine and malware-scan state — RESOLVED by Subunits 2–3; later live scanner activation remains `LATER-039`.
- `LATER-022` — signed short-lived preview/download — RESOLVED by Subunit 4 and retained in the complete M1.06 cumulative gate.
- `LATER-039` remains open only for later live production malware-scanner activation and does not reopen M1.06.

### M1.05 — Audit and Notification Foundations

- **Status:** DONE — OWNER PASS — 9 August 2026.
- `LATER-014` immutable audit — RESOLVED.
- `LATER-015` transactional outbox/background jobs — RESOLVED.
- `LATER-016` persisted in-app notifications/deep links — RESOLVED.
- `LATER-017` provider-neutral durable email queue/delivery state — RESOLVED.
- Live email provider activation remains `LATER-035`.

### M1.04 — Authorization and Tenant Isolation

- **Status:** DONE — OWNER PASS — 6 August 2026.
- Resolved: `LATER-011`, `LATER-012`, `LATER-013`, `LATER-OWNER-012`, `LATER-OWNER-016`.
- Final record: `docs/testing/results/M1_04_FINAL_OWNER_ACCEPTANCE.md`.

### M1.03 — Authentication and Portal Isolation

- **Status:** DONE — OWNER PASS — 4 August 2026.
- Resolved authentication requirements include `LATER-005` through `LATER-010` as applicable and role-denial portion of `LATER-013`.
- Resolved owner defects include `LATER-OWNER-010` and `LATER-OWNER-011`.
- Final record: `docs/testing/results/M1_03_FINAL_OWNER_ACCEPTANCE.md`.

### M1.02 — Design System and Global UX

- **Status:** DONE — OWNER PASS — 2 August 2026.
- Final record: `docs/testing/results/M1_02_FINAL_OWNER_ACCEPTANCE.md`.

### M1.01 — Repository, Environments and CI/CD

- **Status:** DONE — OWNER PASS — 2 August 2026.
- Production hosting and compatibility maintenance remain `LATER-043` / `LATER-044`.

### Worker Dashboard and Worker Profile vertical slice

- **Status:** OWNER PASS — 2 August 2026.
- **Boundary:** accepted prerequisite slice; complete identity behavior is now accepted in M1.07.

## Owner defect format

```text
ID: LATER-OWNER-###
Area:
Exact route or command:
Steps to reproduce:
Expected:
Observed:
Device/browser/OS:
Severity: release-blocking | high | medium | low
Target brick/fix:
Retest result:
```

Release-blocking examples include cross-role/cross-tenant access, stale routes requiring refresh, lost/cross-linked data, wrong-record file attachment, dead controls, unsafe deletion, duplicate business actions, failed migration recovery, dirty tracked source, page-wide overflow and unrecoverable stuck workflows.
