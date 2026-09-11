# M1.07 Final Acceptance

Status: **ACCEPTED — ENGINEERING PASS + OWNER/BROWSER PASS — 11 August 2026**

## Brick

M1.07 — Worker Onboarding and Identity Engine.

## Accepted engineering release

The owner/browser acceptance was performed against the exact released `main` boundary:

- final root-fix PR: `#72` — Make S6 identity submission readiness atomic;
- exact final PR head: `6dbac3cddeb8bea1ae85b7f92c065fa2716e0bc3`;
- exact-head complete engineering gate: run `31446794451` — **PASS**;
- expected-head-locked merge: `4858c05fcab9d8e4fa4cc09d4cfc2243dc313177`;
- merged-main complete engineering gate: run `31447079334` — **PASS**;
- final accepted release SHA for owner testing: `4858c05fcab9d8e4fa4cc09d4cfc2243dc313177`.

The earlier S6 implementation PR `#68` established correction versions, the real Worker-only `/worker/identity` surface and cumulative M1.07 automation. Release acceptance then found and permanently corrected three defects before final owner acceptance:

- `REG-077` — merged-main manual handoff must use the immutable pre-push base;
- `REG-078` — Worker identity submission readiness must be actionable and atomic at the real transaction boundary;
- `REG-079` — React Server Action forms must own method/encoding metadata.

These regressions remain permanent engineering guards after M1.07 closes.

## Owner/browser acceptance

The owner reported the targeted M1.07 release retest **PASS** on 11 August 2026. The tested boundary was intentionally limited to the owner-visible paths affected by the final release blockers plus the previously unreachable continuation.

Accepted results:

1. **Server Action evidence upload contract — PASS.** Evidence upload/replacement completed without the React `encType or method` console error. React owns form transport metadata; no manual fetch/upload workaround was introduced.
2. **Actionable incomplete submission — PASS.** With Country of residence blank, Submit identity remained safely blocked and returned the specific readiness requirement instead of the old generic unknown/safety failure.
3. **Completed submission — PASS.** After Country of residence was completed and saved, identity submission advanced successfully without requiring a manual browser refresh.
4. **Automated-check continuation — PASS.** The Worker could continue into the automated identity-check path after submission. Automated/provider output remained assistive only and did not grant Worker self-verification or self-rejection authority.

The previously accepted cumulative browser baseline for registration, login, role isolation, Company tenant scope, notifications, session/recovery and responsive behavior was not artificially rerun because those areas were not changed by the final REG-078/REG-079 repair.

## Accepted M1.07 capability boundary

M1.07 now has accepted proof for all six ordered internal subunits:

1. versioned Worker identity aggregate, persistence, lifecycle and optimistic concurrency;
2. Worker identity draft details with verified email/phone snapshots derived from live authentication authority;
3. private identity document, profile-photo and selfie evidence binding through the accepted M1.06 secure-file lifecycle;
4. deterministic/provider-adapter automated identity checks with no automated final assurance decision;
5. conservative duplicate signals, explicit recovery/disposition authority and verified-only opaque permanent Worker-ID eligibility/issuance;
6. immutable correction versions/history, real Worker-only `/worker/identity` UX and cumulative identity acceptance.

Permanent invariants include:

- submitted identity versions and correction history are immutable;
- corrections create new versions rather than overwrite accepted history;
- raw document/photo/selfie bytes remain private secure-file objects only;
- verified contact authority remains server-derived;
- duplicate detection never silently or automatically merges identities/accounts;
- permanent Worker IDs remain opaque, unique, idempotent and eligibility-gated;
- provider/AI output is assistive evidence only;
- reviewer-facing identity/evidence queues remain M2.02;
- M1.03 role isolation, M1.04 authorization/tenant isolation, M1.05 audit/outbox rules and M1.06 private-file controls remain inherited and mandatory.

## Remaining production-provider limitations

M1.07 acceptance does not claim live production liveness/face/document-provider activation. Preview/production provider-dependent checks remain fail-closed until approved provider credentials/configuration are installed in their canonical production-integration brick. The deterministic development/test adapter proves the contract without being misrepresented as a live identity-verification provider.

## Acceptance decision

**M1.07 implementation and owner-visible behavior are accepted.**

The brick may be marked DONE only by the separate formal closure transition after this acceptance evidence is synchronized into canonical build-state documents, the closure branch passes the complete exact-head engineering gate, the exact verified closure head merges without drift, and the resulting merged `main` passes the complete engineering gate again.

Until that closure finishes, M1.08 remains blocked.