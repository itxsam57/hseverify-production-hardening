<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

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

<!-- HSEVERIFY-218-FULL-PENTEST-MISSION:BEGIN -->
## HSE Verify mandatory project priority: 218/218 FULL verification + penetration testing

For every new chat, agent, worktree and every "continue": read `docs/qa/PROJECT_MISSION_218_FULL_VERIFICATION_PENTEST.md`, inspect the current 218-scenario evidence ledger, current candidate SHA, active tests, security findings and next unfinished scenario. **Execute** the next actionable verification/fix/retest; never merely summarize historical work or stop at partial coverage.

Count only fully verified, end-to-end, security-tested scenarios on the final release candidate: `FULLY VERIFIED n/218`. Partial scoped evidence is NOT a pass. Complete penetration testing is mandatory for all relevant pages, APIs, features and six roles, including cross-role and cross-tenant isolation. Final release is NO-GO until 218/218, complete pentest, realistic staging/load/restore, real configured provider gates and owner UAT all pass.

Default status reply is a compact taskbar: `FULLY VERIFIED n/218 | NOW: <scenario ID + precise test> | PENTEST: <verified coverage/status> | BLOCKERS: <count> | NEXT: <action>`. Never invent counts, exploit findings or provider availability. Persist exact evidence, active test state, next action and verified commit to durable handoff before context changes. Preserve other sessions, do not reset active test runs. Follow all existing Autopilot governance.
<!-- HSEVERIFY-218-FULL-PENTEST-MISSION:END -->
