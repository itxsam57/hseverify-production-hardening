# M1.11.04 — focused original employment real Worker/Verifier Chromium (2026-11-19)

**Frozen scenario:** M1.11.04 Employment approval/rejection/changes requested to correction and re-review. Required Worker, Company supervisor, Verifier. Original historical old A28 scoped **NOT final**, zero direct precisely named green source cases. **NO-GO: FULLY0/218, final0/4975.** Signed QA base `2bb2a7c1276b371642b96ecd086dcface4548daa` with 71/71 exact merged-SHA workflows PASS.

## Test objective, source reuse and exact acceptance

No parallel rewrite. Extend the preserved original real Chromium `tests/browser/independent-worker-review-e2e.browser.test.mjs` with opt-in `HSE_M11104_EMPLOYMENT_BROWSER_ONLY=true`, keeping the original unflagged full journey and earlier `HSE_M11103_SKILL_BROWSER_ONLY=true` unchanged.

1. Real Worker signed in, creates/submits actual Employment form and evidence file; independent Verifier claims and initially **APPROVES** original version.
2. Worker actually uses **Start a new revision**, edits Duties, uploads revised file, real Verifier reviews **REJECTED**, another correction **CHANGES_REQUESTED**, then latest correction **APPROVED**. Each outcome's actual Worker status and history is observed after navigation. No old task/version mutated.
3. Exact mobile **320/390px** plus 1440px Worker evidence record and Verifier queue must not overflow page; all four versions show in Worker history and latest approval remains shown.
4. Company portal gets only company-scoped Worker directory; direct copied standalone private Worker evidence route returns non-200, as does foreign Worker accessing Verifier queue and signed-out direct Worker evidence. **Formal linked Company order positive receiving not yet tested by this standalone fixture**—do not claim it.
5. Cold authoritative PGlite after clean Next shutdown must retain **four submitted versions**, original v1+corrected v2/v3/v4, prior three superseded, v4 current; four independent source-version-bound task statuses [APPROVED,REJECTED,CHANGES_REQUESTED,APPROVED], four matching reviewer decisions, each version's attached proof file retained. No production-provider signoff.

Hosted `.github/workflows/m1-11-04-employment-review-chromium.yml`: two parallel GitHub runner isolated actual Chromium jobs, required four employment + three review-outcome markers 1/1 and separate unchanged original prior **M1.11.03** skill focus 1/1 three markers, original raw logs archived 90 days on exact PR and signed QA head. **Hosted actual browser not yet run at this checkpoint**. Source opt-in syntax/ESLint/static gate passed, original source test identity unchanged so **1,434/1,608 historical green** preserved; frozen 4,975=693 partial,97 uncertain,4185 unlinked, final0.

## Remaining definition of done

Original M1.11.04 full verification still requires Company-linked assurance case positive receiving, notifications and deep links, invalid/retry/duplicate/expiry/outage/race, complete API tenant/session/BOLA and unauthorized reviewer tests, protected final-stage exact SHA, independent full pentest, genuine production providers, load/restore, Owner UAT. Mark **NOT_FULLY_VERIFIED** and BLOCKED_EXTERNAL as applicable, never treat scoped Chrome as release certification.

**Next action:** strict 218/216/4975 and Node/Python regression; V4 guarded commit, PR hosted two real browsers on exact SHA, download original raw hashes, fix source if RED, normal signed QA merge + full exact merged SHA CI; continue remaining Company/API security without restarting unrelated worktrees or shared PG.
