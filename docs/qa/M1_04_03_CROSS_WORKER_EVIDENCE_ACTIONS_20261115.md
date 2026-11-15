# M1.04.03 — real cross-Worker evidence Server Action ID spoofing

**2026-11-15 — actual local scoped security test PASS. Frozen M1.04.03 still NOT_FULLY_VERIFIED. No protected-stage / owner-UAT signoff.**

## Provenance and previous green tests reused

- Exact signed QA parent `775991423e9e945431df4f09135415f900cc4cb7`, genuine two-parent PR #117 merge, **32/32 exact merged-SHA GitHub workflows SUCCESS**, previous M1.04.02 two-company private PDF/conditional no-store security tests.
- M1.04.03 had **3 exact prior source cases GREEN**: Worker two-person secure file ID/token, native Worker signed access session revocation, Company signed active-tenant membership. Reused original existing `tests/browser/worker-secure-files-cross-account.browser.test.mjs` (same test identity, no new source test). Uncovered scope: another authenticated Worker forges `recordId` and matching `expectedRevision` in the actual **save metadata and submit evidence Next Server Actions**, rather than copying a PDF GET.
- An objective source-coverage assertion failed before modification (exit1): `.autopilot/artifacts/M10403_WORKER_EVIDENCE_DIRECT_ACTION_COVERAGE_RED.log` SHA256 `8e9d04c1d248ae8cfc4149e0a95cb528795bbe580d4c9690441a2bbc4c73ff6a`. **This is NOT a product vulnerability reproduction**, only an old-test gap. No tested app defect was found.

## Original real Chromium, exact actions, receiving state and DB

- Extended the same existing two-Worker signed-in 390/320 browser/PGlite fixture. Worker A and independent Worker B each used actual Worker Evidence `Create draft` forms to create their own Skill record. A saved metadata through its real `Save metadata` button and read its current revision.
- Signed-in **Worker B modified two hidden form fields** to reference **Worker A's actual record ID and its matching current revision**, then submitted a real `Save metadata` browser Server Action, then a separate `Submit this version` action. Both displayed **`The evidence record is unavailable. Reload the page and try again.`**, without Worker A's private details or successful mutation. The forged form value was passed to actual client-side form submission, not just a source-unit test.
- Then Worker B's legitimate own save recovered and succeeded. Original own private PDFs (A and B) stayed readable, other Worker copied signed file tokens and role/header spoofing denied, preview/download purpose checks, old real Worker UI logout and token revocation all passed.
- Authoritative PGlite DB after browser: exactly 2 new Worker-owned skill records, original A and B records each **revision 2, status draft**, A skill exactly `Private owner A synthetic competency`, B skill exactly `Worker B own synthetic competency`; **0 forged submit results**, **exactly 4 owner-bound immutable Worker evidence creation/save audit records**, **0 foreign audit writes**. Existing private-file DB: 2 owned files, 6 correctly owner-bound file audit records.
- **Real Chromium full existing named case 1/1 PASS**, 34.6s, exit0, command `node --test tests/browser/worker-secure-files-cross-account.browser.test.mjs`. Log `.autopilot/artifacts/M10403_ACTUAL_WORKER_CROSS_ACCOUNT_RECORD_ACTIONS_20261115.log` SHA256 **`97235909b8bad1fd0fad6c81b4cc0b420b95d3f13ef8faabb7d8772ff1686383`**.
- No application production source fix was needed. User action returns a non-enumerating error; no independent full attack-surface enumeration, receipt of cross-role notifications, provider behavior or protected final-stage pentest is claimed.

## Frozen counters and exact handoff

- Original frozen release **FULLY VERIFIED 0/218, 218 remain, NO-GO**. Historical previously matched **1399/1572**; **173** unmatched. Existing source case identity unchanged—do not add a green case count for this repeat execution. Old scoped **216/218**, NOT full passes; provisional planned **693/4,975 PARTIAL, 55 UNCERTAIN, 4,227 UNLINKED, FINAL0/4,975**; PENTEST incomplete, 2,008 preliminary candidates independently completed UNKNOWN; 10 external blockers, severe UNKNOWN.
- Branch `qa/m10403-worker-evidence-bola-20261115`, base QA `775991423e9e945431df4f09135415f900cc4cb7`, V4 audit session `9213448b-27cc-47d1-b432-0fc7cc4981c6`, cycle `c13e657f0b0943d8bbfc416790568c69`. Isolated synthetic PGlite; no production/providers touched, no other worktree test interrupted.
- **NEXT:** Reindex/verify exact original 218 and 4,975 source/legacy/evidence, guarded commit/push PR, exact PR-head real Worker browser and native owner/security plus ledger/Autopilot checks; merge only all green, verify exact merged QA SHA workflows. Then resume next uncovered M1.04.03 direct action/API role boundaries or M1.04.04 stale permission/revocation. Protected final staging, real providers, independent full pentest, load/restore, Owner UAT all still outstanding.


**Strict original release-index proof:** 218 frozen, 4975, 216 legacy, source-case and scenario action map verification plus original engine tests all exit0; `.autopilot/artifacts/M10403_ORIGINAL_218_4975_ENGINEERING_GATES_20261115.log` SHA256 `8f7fabaf2d64f940438e9d78c2afbf89f67f5b6a549c76f1cc85c6c97082fc23`. These remain scoped engineering checks, not final protected staging certification.
