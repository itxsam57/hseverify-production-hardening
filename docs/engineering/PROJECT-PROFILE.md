# HSE Verify — Project Profile

## Identity and authority

- **Project:** HSE Verify, a multi-role workforce trust platform.
- **Build model:** Phase 1 clean rebuild; Version 10/prototype code is capability reference only.
- **Frozen authority:** HSE Verify Master Product, Feature, Workflow, UX and Engineering Specification — Phase 1 Frozen Scope — 1 August 2026.
- **Repository:** `itxsam57/hseverify`; default branch `main`.
- **Current build position:** `docs/NEXT_BUILD_UNIT.md` + `docs/bookmarks/MILESTONE_PATH.md`.
- **Formal progress:** **7/12 Milestone 1 bricks DONE**.
- **M1.07 Worker Onboarding and Identity Engine:** **DONE — OWNER PASS — 11 August 2026**.
- **M1.08 Company Registration and Verification:** **ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED** to the combined Milestone 1 browser test.
- **M1.09 Sites, Departments and Company Team:** **ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED**; PR #75, exact head `32130f82b661b86d7ad08f5dad7a368346cfe13d`, gate `31569523799`, merge `1fe96b412db3cfa4e370a2d60cd13ce00aa3e3bf`, merged-main gate `31569898065`.
- **M1.10 Worker Invitations and Company Codes:** **ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED**; PR #76, exact head `9c3bcfec9b8a5c2a7642dcf63ddcce99c569f725`, targeted gate `31971156192`, full gate `31971157867`, merge `3b32287fecb30f16d682cb130be0e8f1eb466616`, merged-main gate `31971506738`.
- **M1.11 Employment, Experience, Qualification, Skill and Leaving Records:** **ENGINEERING PASS — OWNER ACCEPTANCE DEFERRED**; PR #77, exact head `87f28bac5cb54b06267f51f100f58668f35dc085`, targeted gate `32011610521`, full gate `32011610553`, merge `ff296f7d59a6505241796f654249c3df6b97763d`, merged-main gate `32012346047`.
- **M1.12 Public Verification Foundation:** **IN PROGRESS**; only active product brick on `build/m1-12-public-verification-foundation` from verified base `ff296f7d59a6505241796f654249c3df6b97763d`.
- **M2+:** blocked.

## Accepted architecture

- Next.js App Router + React + TypeScript.
- Direct SQL repository layer; PGlite local/CI and PostgreSQL production target; no ORM.
- Fixed-role authentication with password/OTP/TOTP, opaque revocable sessions, recovery and invitation-only staff onboarding.
- Company authority always derives from the current server-resolved tenant membership and explicit permission ceiling/overrides.
- Worker identity is portable and is never owned by a Company tenant.
- Private files use server-owned storage, quarantine, scan and signed access from M1.06.
- Material security/business state uses immutable audit and durable transactional patterns established in M1.05.
- Local/sandbox provider adapters are testing infrastructure, not live production providers.

## Current M1.12 architecture boundary

M1.12 extends accepted primitives rather than creating parallel identity, credential or storage systems:
- Public verification is an unauthenticated **read-only projection boundary**, not an authorization bypass.
- M1.07 permanent Worker IDs are reused for Worker lookup. M1.12 does not issue a second Worker/public identity.
- `/verify` is the public entry for one bounded identifier lookup. QR scanning is explicit user activation and manual entry remains available.
- Public lookup is normalized, server-rate-limited and non-enumerating; malformed and unknown identifiers must not leak existence.
- Successful results use opaque server-created public result capabilities rather than raw account, tenant, evidence or storage identifiers.
- Public output is assembled through a strict allow-list projection. Private Worker/evidence objects are never serialized and then redacted.
- **Report a Concern is an M1.12 triage intake**, created only from the opaque public result authority; it is not merely a generic contact message.
- A concern can carry one optional private evidence candidate. The candidate reuses the accepted M1.06 file validation, private storage, quarantine and malware-scan lifecycle and binds only after the secure file becomes `available`.
- Unsafe or scan-failed concern evidence is retained as rejected history and cannot permanently block a later clean retry.
- The browser cannot choose concern/file/storage/owner/tenant authority. Public routes expose no concern-evidence preview or download authority.
- M1.12 retains secure-file references as bounded opaque cross-brick IDs rather than hard foreign keys, preserving independent M1.06 rollback/reapply while live service/trigger checks enforce file existence, intake ownership and lifecycle before binding.
- Private evidence, identity documents, leaving letters, employer history, raw assessment data, monitoring/recordings, private review notes and secure-file metadata remain private.
- M1.05 audit/outbox controls and M1.06 private secure storage remain authoritative.
- Existing `/verify/worker/[workerId]` code is prototype/compatibility context only and is not accepted M1.12 completion evidence.
- M3.01 credential issuance, M3.02 Living Record, M3.03 scoped share links and M3.07 credential lifecycle administration remain later scope.
- Reviewer concern/evidence approve/reject/changes-requested decisions, assessment eligibility/delivery and interview/decision authority remain Milestone 2.

## Release discipline

Root-cause fixes, permanent regressions, exact-head targeted/full gate, expected-head merge lock and merged-main full gate. Per owner instruction, M1.12 advances on engineering release without an intermediate browser stop; M1.08–M1.12 visible acceptance is performed once in the combined Milestone 1 browser test after M1.12 is engineering-green.
