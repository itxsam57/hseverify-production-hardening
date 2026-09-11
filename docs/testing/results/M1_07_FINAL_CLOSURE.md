# M1.07 Final Brick Closure

Status: **CLOSURE TRANSITION — PENDING EXACT-HEAD / MERGED-MAIN GATES**

## Brick

M1.07 — Worker Onboarding and Identity Engine.

## Accepted implementation and owner evidence

- Subunits 1–5 were independently accepted before the final visible S6 boundary.
- S6 implementation PR `#68` introduced immutable correction versions, the real Worker-only `/worker/identity` workflow and cumulative M1.07 acceptance automation.
- Release-acceptance regressions `REG-077`, `REG-078` and `REG-079` were reproduced, root-fixed and permanently guarded before owner acceptance.
- Final root-fix PR `#72` exact head `6dbac3cddeb8bea1ae85b7f92c065fa2716e0bc3` passed complete engineering gate `31446794451`.
- PR `#72` merged with expected-head SHA lock as `4858c05fcab9d8e4fa4cc09d4cfc2243dc313177`.
- Exact merged-main complete engineering gate `31447079334` — **PASS**.
- Owner/browser targeted M1.07 release retest — **PASS — 11 August 2026**.
- Permanent acceptance record: `docs/testing/results/M1_07_FINAL_ACCEPTANCE.md`.

## Owner/browser boundary accepted

The owner confirmed the final targeted release checks all went through:

- evidence upload/replacement no longer emits the React Server Action `encType or method` warning;
- incomplete submission reports the exact missing Country of residence requirement instead of a generic unknown failure;
- completing/saving Country of residence allows real identity submission without a manual refresh;
- the previously unreachable automated-check continuation runs and remains assistive rather than granting Worker self-verification/rejection authority.

This owner PASS is tied to exact released `main` SHA `4858c05fcab9d8e4fa4cc09d4cfc2243dc313177`, whose merged-main engineering gate is green.

## Accepted M1.07 behavior

M1.07 is accepted with permanent proof for:

- separate versioned Worker identity persistence and lifecycle authority;
- optimistic identity/draft concurrency and live Worker session/account/role revalidation;
- verified email/phone identity contact snapshots derived from authentication authority;
- private identity document/profile-photo/selfie evidence through M1.06 quarantine, validation, malware-scan and same-Worker binding rules;
- complete server-side submission readiness including atomic readiness-to-transition behavior;
- deterministic/provider-adapter automated checks with production provider fail-closed behavior;
- conservative duplicate signals and explicit server-owned disposition/recovery authority with no automatic merge;
- opaque, unique, idempotent permanent Worker-ID eligibility/issuance only after required assurance gates;
- immutable correction requests, decisions, evidence origins and version numbering;
- correction versions that never overwrite accepted parent history;
- real Worker-only `/worker/identity` UX with server-authorized route/actions, stale-write handling, secure evidence replacement, bounded status/check/eligibility projection and owner-tested continuation;
- cumulative route, isolation, migration/restart, correction-history and regression coverage.

Reviewer-facing identity/evidence decision queues remain M2.02 and were not pulled into M1.07.

## Permanent regression boundary

The complete engineering gate must continue to retain the accepted M1.07 runtime/source tests and all permanent regressions, including:

- `REG-073` and `REG-074` — identity foundation boundaries;
- `REG-075` — real secure-file scan/generation state in identity evidence tests;
- `REG-076` — migration checksum portability inherited during identity work;
- `REG-077` — merged-main handoff immutable base;
- `REG-078` — actionable atomic submission readiness;
- `REG-079` — React Server Action form transport ownership.

## Closure transition

This branch changes canonical build position only:

- M1.07: **IN PROGRESS -> DONE — OWNER PASS**.
- Milestone 1: **6/12 -> 7/12 DONE**.
- M1.08 Company Registration and Verification: **BLOCKED -> READY TO BUILD**.
- M1.09 through M1.12: remain **BLOCKED in canonical order**.
- M2/M3: remain **BLOCKED**.

No M1.08 runtime/product code belongs in this closure branch.

## Merge rule

This closure is not complete merely because the owner acceptance passed. The closure branch itself must:

1. synchronize the authoritative build-state documents and permanent engineering checks;
2. pass the complete engineering gate on its exact final head;
3. merge only that exact verified head;
4. pass the complete engineering gate again on the resulting merged `main` commit.

Only after all four are true may this record be treated as CLOSED and M1.08 product implementation begin.