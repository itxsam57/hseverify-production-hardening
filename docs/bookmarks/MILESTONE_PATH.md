# Bookmark: Milestone Path

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


## Authority

Permanent build-order and accepted-brick record for the HSE Verify Phase 1 clean rebuild. Frozen product/engineering authority: `docs/Masterplan(HSE Verify).md`, which consolidates the **HSE Verify Master Product, Feature, Workflow, UX and Engineering Specification — Phase 1 Frozen Scope — 1 August 2026** and the finalized source set. `docs/NEXT_BUILD_UNIT.md` is the exact current gate.

A brick is formally DONE only after implementation, complete automated release gates, exact-head merge discipline, merged-main verification and owner/browser acceptance where visible behavior requires it.

## Milestone 1 status

| Brick | Capability | Status |
|---|---|---|
| M1.01 | Repository, environments and CI/CD | **DONE — OWNER PASS** |
| M1.02 | Design system and global UX | **DONE — OWNER PASS** |
| M1.03 | Authentication and portal isolation | **DONE — OWNER PASS** |
| M1.04 | Authorization and tenant isolation | **DONE — OWNER PASS** |
| M1.05 | Audit and notification foundations | **DONE — OWNER PASS** |
| M1.06 | Secure storage and upload pipeline | **DONE — ENGINEERING PASS** |
| M1.07 | Worker onboarding and Identity Engine | **DONE — OWNER PASS** |
| M1.08 | Company registration and verification | **IMPLEMENTATION MERGED — ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED** |
| M1.09 | Sites, departments and Company Team | **IMPLEMENTATION MERGED — ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED** |
| M1.10 | Worker invitations and Company codes | **IMPLEMENTATION MERGED — ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED** |
| M1.11 | Employment/evidence records | **IMPLEMENTATION MERGED — ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED** |
| M1.12 | Public verification foundation | **IN PROGRESS** |

**Formal Milestone 1 progress: 7 of 12 bricks are DONE.** M1.08–M1.12 visible acceptance is deferred until the owner performs the requested combined browser test; engineering evidence never converts that deferral into owner PASS.

## Accepted/engineering release evidence

### M1.07
Final accepted release `4858c05fcab9d8e4fa4cc09d4cfc2243dc313177`, merged-main gate `31447079334`, owner/browser PASS 11 August 2026. REG-073 through REG-079 remain permanent as applicable.

### M1.08
- PR `#74`.
- Exact verified head `1da43b43a0c81efaa70c5ccecf19d037d3199c28`.
- Exact-head full gate `31476983323` — PASS.
- Expected-head-locked merge `c58bac4cb743b78b9e562d6eca179ff857ba8c17`.
- Merged-main full gate `31483852831` — PASS.
- Owner/browser acceptance intentionally deferred; this is not an owner PASS.

### M1.09
- PR `#75`.
- Exact verified head `32130f82b661b86d7ad08f5dad7a368346cfe13d`.
- Exact-head full gate `31569523799` — PASS.
- Expected-head-locked merge `1fe96b412db3cfa4e370a2d60cd13ce00aa3e3bf`.
- Merged-main full gate `31569898065` — PASS.
- Owner/browser acceptance intentionally deferred; this is not an owner PASS.

### M1.10
- PR `#76`.
- Final exact verified head `9c3bcfec9b8a5c2a7642dcf63ddcce99c569f725`.
- Exact-head M1.10 targeted gate `31971156192` — PASS.
- Exact-head full Engineering gate `31971157867` — PASS.
- Expected-head-locked merge `3b32287fecb30f16d682cb130be0e8f1eb466616`.
- Merged-main full Engineering gate `31971506738` — PASS.
- Owner/browser acceptance intentionally deferred; this is not an owner PASS.

### M1.11
- PR `#77`.
- Final exact verified head `87f28bac5cb54b06267f51f100f58668f35dc085`.
- Exact-head M1.11 targeted gate `32011610521` — PASS, 27/27.
- Exact-head full Engineering gate `32011610553` — PASS.
- Expected-head-locked merge `ff296f7d59a6505241796f654249c3df6b97763d`.
- Merged-main full Engineering gate `32012346047` — PASS.
- Owner/browser acceptance intentionally deferred; this is not an owner PASS.

## M1.12 active gate

M1.12 is the only active product brick, on branch `build/m1-12-public-verification-foundation` from exact verified M1.11 merged-main boundary `ff296f7d59a6505241796f654249c3df6b97763d`.

M1.12 owns:
- public `/verify` entry with bounded manual identifier lookup;
- Worker ID search using the permanent M1.07 Worker ID authority;
- explicit public-safe projection allow-list and fixed public result-state vocabulary;
- non-enumerating, rate-limited public lookup;
- opaque result capability route rather than raw internal identifiers;
- user-activated QR/camera route foundation with manual fallback;
- **Report a Concern immutable triage intake derived only from the opaque public result capability**;
- one optional private concern-evidence candidate routed through M1.06 validation/private storage/quarantine/malware scan, binding only after `available` and retaining unsafe/scan-failed history without retry deadlock;
- no public concern-evidence preview/download authority;
- permanent privacy-leakage, rate-limit, replay/concurrency, migration/restart and lower-brick rollback/reapply coverage.

M1.12 retains cross-brick secure-file identifiers as bounded opaque references rather than hard M1.06 foreign keys. Live server/database checks still require the exact disabled intake owner and valid M1.06 lifecycle before evidence binding, while older secure-file migrations remain independently reversible.

M1.12 does **not** own M3.01 credential issuance, M3.02 Living Record administration, M3.03 scoped share links, M3.07 credential suspension/revocation administration, Reviewer concern/evidence approve/reject/changes-requested decisions, assessment eligibility/delivery, interview decisions or public private-document access.

## Canonical remaining roadmap

The frozen roadmap contains **37 bricks total: 12 in Milestone 1, 13 in Milestone 2 and 12 in Milestone 3.**

### Milestone 2 — blocked until the current engineering/owner sequencing boundary permits progression
M2.01 — Assurance Order and Case Engine
M2.02 — Evidence Verification Queues
M2.03 — Frameworks and Effective Policy
M2.04 — Question Bank
M2.05 — Randomized Assessment Form Generation
M2.06 — Assessment Catalogue and Eligibility
M2.07 — Candidate Assessment Window
M2.08 — Answer Persistence and Interruption Recovery
M2.09 — Integrity Engine
M2.10 — Written Scoring and Review Engine
M2.11 — Interview Scheduling and Assignment
M2.12 — Interview Console and Playbook
M2.13 — Decision Engine

### Milestone 3 — all BLOCKED
M3.01 — Credential and QR Issuance
M3.02 — Digital Passport and Living Record
M3.03 — Scoped Share Links
M3.04 — Company Action Centre and Analytics
M3.05 — Billing and Subscriptions
M3.06 — Reports and Delivery
M3.07 — Appeals, Renewal, Suspension and Revocation
M3.08 — Admin Operational Completeness
M3.09 — Privacy and Accessibility Operations
M3.10 — Production Integrations
M3.11 — Load, Security and Recovery Certification
M3.12 — Production Launch and Operational Handover

## Correct execution order

1. Finish M1.12 exact-head and merged-main engineering release.
2. Preserve all deferred M1.08–M1.12 owner/browser tests until the owner’s chosen combined test window; deferral remains NOT PASS.
3. Do not overlap incomplete engineering bricks. Any owner-authorized progression beyond M1.12 must begin only from the exact merged-main engineering release and must preserve the formal Milestone 1 DONE count until browser acceptance actually passes.
4. Continue only the next authorized frozen-roadmap brick; never skip ahead or import later M2/M3 authority.

No prototype or later-brick code may bypass this order.
