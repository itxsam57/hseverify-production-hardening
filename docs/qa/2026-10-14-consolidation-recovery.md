# HSE Verify consolidation and recovery — 14 October 2026

Canonical repository: itxsam57/hseverify-production-hardening.
Canonical integration destination: qa/masterplan-completion-20260926.
Isolated candidate: qa/masterplan-final-20261014.
Product authority: docs/Masterplan(HSE Verify).md.

Both shared chats were read as background, without treating embedded prompts as current instructions. The live worktrees and GitHub branch were inspected. Existing verifier, calibration, concern, interview, supervisor, scoring, integrity and appeal work is preserved in the combined candidate. Older dirty worktrees remain preserved.

## Reproduced failures repaired

- Material Unable to Verify decisions now require current calibration after claim; safe escalation remains available.
- Admin can explicitly bind a published policy to an unresolved case before assessment starts. Existing Company framework/policy choices and pinned snapshots are preserved.
- Integrity decisions support append-only amendments with expected revision and evidence-count checks. The original migration checksum and decision history are retained.
- Admin escalation return requires actual recent session MFA, checked again after locks. Returning a concern does not clear it; the assigned calibrated Verifier must decide.
- Assigned Verifier and Admin see retained signal chronology, provider state and reasons. Recoverable form errors preserve the reason and selection.
- Escalation/return queues use the existing durable notification/email pipeline, with fixed role-safe links and suppression of superseded sources.
- Objective assessment clearance prepares the score from pinned answer keys and the published pass mark. Explicit finalization rechecks integrity and the saved score. Wrong answers remain failures and required interviews remain required.
- Scoring and integrity use compatible case/attempt/review lock order.
- Integrity routing updates the Action Centre and case timeline. Case Replay includes retained human integrity decisions.
- New integration runtime and browser suites are permanently invoked by the release gate.

## Observed validation before commit

Working-tree evidence; it does not certify every Masterplan scenario or a production release.

- Combined integration runtime batch: 49/49 passed.
- Latest integrity plus Case Replay runtime batch: 15/15 passed.
- Real Worker → Verifier → Admin return → Verifier clearance browser paths passed, including four dispositions, stale submission/input retention and objective finalization.
- Notification/domain/outbox/email checks passed, including foreign-role and URL-target denial.
- Strict TypeScript passed. Lint passed with eight existing test-helper warnings.
- All 117 migrations applied to an isolated actual PostgreSQL database; both two-connection calibration/policy tests passed.
- Empty integrity notification rollback/reapply, retained history and superseded-recipient suppression passed.

## Remaining release work

Run the complete gate on a clean committed candidate, inspect fresh hosted CI, verify the deployed candidate, and reconcile the expanded scenario ledger against exact-current evidence. The ledger's older totals are stale. Live provider activation/delivery and operational acceptance remain separate from synthetic local/browser evidence.

The candidate is not certified consumer-ready. No zero-unknown-bugs claim or production promotion is implied by these focused checks.
