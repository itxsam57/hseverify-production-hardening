<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- HSEVERIFY-PERMANENT-218-VERTICAL:BEGIN -->
## HSE Verify owner-approved permanent 218/4975 test-and-counting rule (2026-11-14)

**Mandatory for EVERY new chat, "continue", test, fix, or QA handoff.** The ONE release goal is **all 218 frozen Masterplan scenarios FULLY_VERIFIED on the SAME final signed deployable SHA/config**, independently full-penetration-tested and Owner UAT approved. The release remains **NO-GO until then**. Never reinterpret historical scoped results or passing subsets as full certification.

**Read at start in order:** `AGENTS.md` → `docs/qa/PROJECT_MISSION_218_FULL_VERIFICATION_PENTEST.md` → `docs/qa/CURRENT_RESUME_218.md` → **`docs/qa/218_VERTICAL_EXECUTION_PROTOCOL.md`** → `docs/qa/218_VERTICAL_EXECUTION_CURSOR.json` → canonical 218-row evidence/action queue. Check latest remote signed QA SHA, active worktrees/tests/logs and first failed/unfinished actionable scenario before any new test or code. Continue from cursor; don't restart passed work or ask the owner to re-explain.

**Work vertically, feature-by-feature, one frozen scenario ID at a time.** Prefer tests that completely close its actual UI + responsive/keyboard + positive/negative/retry/expiry/interruption/race + cross-role receiving state/notifications/DB/audit + direct API role/tenant/session abuse + relevant pentest + real provider + protected exact-final-SHA stage/Owner UAT gates. Combine related safe assertions into one real browser workflow with distinct evidence. Fix root cause and retest; remove dead code only with dependency/regression proof. If any final requirement is missing, do NOT decrement the 218 remaining count. Record partial evidence and exact blocker; move to next actionable scenario if external/stage-blocked. Revisit blocked items before final GO.

**Always display ALL counters after each meaningful test and every "continue"** using `npm run qa:progress-218` (never manually invent totals):
- `FULLY VERIFIED n/218 | LEFT 218-n | NOW exact ID/test/result | RELEASE NO-GO/GO`
- `TEST CASES HISTORIC GREEN 1,392/1,566 baseline (174 no matched green) | OLD SCOPED 216/218 (not fully verified)`
- `PLANNED 693/4,975 old scoped PARTIAL | 54 UNCERTAIN | 4,228 UNLINKED | FINAL 0/4,975 certified` (all numbers change only with corroborated evidence)
- `PENTEST INCOMPLETE (2,008 provisional attack-family candidates; independent completed unknown) | EXTERNAL BLOCKED 10 known minimum | HIGH/CRITICAL OPEN unknown | NEXT exact action/command`.
The static source-case identities and compound planned check slots count **different things**, never subtract `1,392` from `4,975`. The 693 are **historical partial dimension links, NOT 693 full passing checks**. Duplicate re-runs do not inflate any numerator; denominators only grow/change with a documented actual new necessary test, surface or applicability decision. Exact source SHA, test input/output/log, receiving role, security abuse, regression and signed-stage proof are required for certification. Do not claim zero HIGH/CRITICAL without review.

**Write durable handoff every unit:** update same canonical `npm run audit:current-218-scenarios` ledger and 218 evidence/action queue, 4,975 view, case identity index, `CURRENT_RESUME_218.md`, cursor next ID/command, V4 audit and exact SHA/CI/failed checks. No parallel release ledgers. Preserve other running worktrees/tests. Reuse existing authorized Hands-Off workstation synthetic setup for safe verification; **do not create localhost server/database unless really needed**. Invasive final full pentest/load/real providers need explicitly approved isolated protected stage and scope; never run on unprotected shared services.

Full protocol and 37 brick order: `docs/qa/218_VERTICAL_EXECUTION_PROTOCOL.md`. Do not change this permanent route unless owner explicitly changes it.
<!-- HSEVERIFY-PERMANENT-218-VERTICAL:END -->

<!-- UNIVERSAL-AUTOPILOT-V3:BEGIN -->
## Universal Project Autopilot V4 — mandatory and observable

This repository is guarded. For every coding, debugging, continuation, CI, UI, deployment, or release task:

1. Load `universal-project-autopilot` before any mutating tool call.
2. Initialize/repair state if needed, then install or refresh the repository guard from the installed skill before requesting a receipt.
3. Start exactly one audit session with `.autopilot/autopilot_audit.py start`, declaring every active skill, material tool, and runtime. Then run `python .autopilot/guard.py session --root .` and show its JSON receipt to the user.
4. Record each newly used skill, specialist, material tool/command, gate result, blocker, and status change with `autopilot_audit.py record`. Close the session only as complete, blocked, owner-required, or exact handover.
5. If receipt or audit validation fails, make no product/code mutation. Reconcile Git, failed CI, broken UI/runtime, inherited dirty work, and audit state first.
6. Known-red CI, startup, browser, security, or purpose behavior is the highest-priority feature until repaired and reverified. Record it with `mark-known-red`.
7. Never use `--no-verify`, disable hooks, forge commit trailers, remove this block, or weaken the compliance workflow.
8. Do not claim completion unless `complete-project` succeeds at the exact clean SHA and the real UI/purpose/security/deployment gates applicable to the project pass.

Routine continuation never requires the owner to type `continue`. A response boundary is not a work boundary.
<!-- UNIVERSAL-AUTOPILOT-V3:END -->
