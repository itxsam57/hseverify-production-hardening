<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- HSEVERIFY-PERMANENT-218-VERTICAL:BEGIN -->
## HSE Verify ZERO — owner-approved agency-style owner-readiness testing (2026-11-21)

This block **supersedes the previous strict M1-first / owner-UAT-first pause rule**. The active and only test operation contract is `docs/qa/AGENCY_ZERO_PROTOCOL.md`. Every AI/chat/test must read it first. Preserve all 218 original scenario IDs and the old evidence; do not recreate or reset the Masterplan. The old release-specific procedure remains a separate future launch gate, not the technical definition of FULLY VERIFIED.

- The goal is **218/218 TECH FULLY VERIFIED = OWNER TESTING READY**, meaning real browser/UI, inputs/files, cross-role end-to-end handoff and persistence, negative/retry/race, code quality, API/tenant/session security, relevant deep penetration testing, and reviewer signoff all pass on an exact source SHA/config. Intentionally disconnected adapters pass from rigorously tested working contracts, failure/retry/security; genuine provider delivery and Owner UAT are **separate launch gates**.
- Use the existing frozen 218-row source and the 58 deterministic **ZERO batches**, 1–5 closely related workflow/scenario units per batch and **no more than five independently executed test cases per batch**. For large journeys, more tightly scoped future batches may be necessary, each still <=5. Three evidence-backed disciplines: engineer, cybersecurity, independent reviewer. A self-run AI review is not an outside agency certificate.
- **Never stop unrelated testing for one failure or absent provider.** Triage fail, retry a suspected transient at most once, attempt root-cause correction at most twice before parking a blocker with evidence, then safely continue independent batches. Existing known-red high/critical problems remain highest repair priority and block certification but do not erase other test progress.
- Do not alter existing production/staging/shared worktrees or run invasive tests outside an isolated authorized target. Never silently merge or deploy. Autopilot V4 guard and compliance stay mandatory; no hook bypass. Save raw evidence securely, same SHA/config, precise resume cursor; preserve original passing evidence and selective recheck after relevant source change.
- **Required safe local test preflight:** run `npm run qa:preflight-218` before starting a new local test unit; it verifies free space and may prune only bounded clean idle caches when needed, never source, active worktrees or raw evidence. The technical batch queue is still ZERO, not the old release-only cursor.
- Review the 37 domain charters in `docs/qa/AGENCY_ZERO_REVIEW_MATRIX.md`. The source queue is `docs/qa/evidence/MASTERPLAN_218_ALL_PREVIOUS_EVIDENCE_ACTIONS_20261114.csv`; inspect `docs/qa/AGENCY_ZERO_BATCHES.json`, `docs/qa/AGENCY_ZERO_RESUME.md`, `docs/qa/AGENCY_ZERO_CANDIDATE.json`, `docs/qa/AGENCY_ZERO_EVIDENCE.json`. Report technical progress from `python3 scripts/agency_zero_control.py --status`. Old `npm run qa:progress-218` is the **legacy full release certificate**, not owner-testing readiness.
- **Every user-visible testing response must begin with the literal uppercase word `ZERO`**, including “continue”, “yes”, “blue”. Use no text walls. Show `ZERO | TECH VERIFIED n/218 [bar] | OWNER READY yes/no`; current `BATCH ZERO-xxx | PASS / FAIL / BLOCKED / NEEDS EVIDENCE`; `ENGINEER | CYBERSECURITY | REVIEWER` short outcomes; `NEXT | SHA | EVIDENCE`. No invented counts or passes. See exact format in the active protocol.

Do not restore superseded M1-first gating unless the owner explicitly requests it.
<!-- HSEVERIFY-PERMANENT-218-VERTICAL:END -->

## Safe synthetic QA evidence retention (2026-11-18)

The private evidence vault is `itxsam57/hseverify-qa-evidence-vault`. Automatic cleanup is enabled only for worktree-generated raw files after private Release download SHA256 proof, clean/idle original worktree, and exact source SHA independently retrievable on GitHub. Never delete frozen ledgers, pending/unpushed code, PostgreSQL, V4 audit or active/unsafe evidence. Run `npm run qa:archive-evidence-regressions` after changes and inspect `docs/qa/QA_PRIVATE_EVIDENCE_VAULT_AUTO_CLEANUP_20261118.md` for restore and monitoring. The 218/218 release gate remains NO-GO.

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
