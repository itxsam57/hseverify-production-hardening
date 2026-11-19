# M1.11.04 — Company-linked employment real browser continuation (2026-11-19)

**Signed QA source `ae18a3f87766f9305c37e74b990702d0703dadb8` has 73/73 exact-merged SHA CI PASS.** Original M11104 Worker+Verifier corrected employment 1/1 original merged Chrome SHA256 `7d0f1d5df98b76c255065722c0c33e35adf480c548429f91815322c784f85a08`, original adjacent skill1/1 SHA256 `f9b909987290f189485ce22df0d0fd6da6285b71d89f98fccfa34d2ab7ba7f78`. Not FULLY_VERIFIED.

## Remaining positive Company-linked receiver gap

Old scoped evidence does not constitute directly named complete scenario proof. Prior standalone Worker employment test proved Company cannot read private raw Worker records, **not** what happens after an actual Company-worker relationship and employment Assurance Order.

Test new focused opt-in `HSE_M11104_COMPANY_EMPLOYMENT_ONLY=true` in original `tests/browser/company-workforce-assurance-e2e.browser.test.mjs`, rather than creating duplicate app/test. The existing default qualification and `HSE_M11103_COMPANY_SKILL_ONLY` behavior are preserved.

1. Real Worker fills employment metadata, uploads actual file, submits version 1. Company creates site/dept, invites Worker, Worker accepts, Company makes explicit `employment` assurance Order for that linked Worker.
2. Company requests independent review and Verifier claims it with Admin-governed framework binding. Verifier chooses CHANGES_REQUESTED and Company Order plus Worker dashboard get `Evidence pending`.
3. Worker uses real Start a new revision, edits Duties, uploads corrected employment evidence, submits v2. Company requeues, independently governed Verifier APPROVES. Worker and Company see `Assessment pending` and Worker employment card shows approved and v1/v2 immutable history after reload.
4. Worker evidence and Company Order at widths 320/390/1440 have no horizontal document overflow; authorized roles see their state. Company account still cannot GET raw `/worker/evidence`, Worker cannot GET `/verifier/reviews`, signed-out cannot GET Worker evidence (each denied).
5. After Next shutdown original PGlite shows one active Company link and one Company tenant Assurance Order/case, two source-bound CHANGES_REQUESTED and APPROVED independent decisions, employment versions v1 superseded/v2 submitted and both versions' retained evidence files.

Workflow `.github/workflows/m1-11-04-company-employment-chromium.yml`: independent real Chromium 1/1 employment five named fail-closed markers, separate original Company skill 1/1 four named fail-closed markers, exact PR/merged SHA, original 90-day CI logs. **New browser is NOT YET HOSTED/EXECUTED at this checkpoint**, static Node syntax/ESLint/contract checks only. Do not claim it as PASS.

## Other outstanding M1.11.04 full gates

Explicit direct Worker/Company/Verifier session+tenant BOLA/IDOR/API abuse, stale submission/race, expiry, duplicate/retry/interruption, notifications/deep links where emitted, full independent pen test, real provider, staging at same exact final deployable SHA, operational load/restore and Owner UAT. Frozen **FULLY0/218**, original `4,975` planned **0 final**, legacy `216` is scoped not full, pentest provisional 2,008 incomplete, external blockers≥10 and release **NO-GO**. No shared PG16 or other worktree changes.

**NEXT:** original 218/216/4975 reindex & strict regressions, guarded commit and push isolated branch, host real two-browser jobs, download exact raw hashes, fix any RED, merge only after PR green, verify merged exact-SHA all workflow jobs; then continue remaining API/security work.
