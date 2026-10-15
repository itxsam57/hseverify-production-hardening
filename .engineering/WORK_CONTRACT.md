# WORKFLOW-001 — current implementation contract

Finish the frozen HSE Verify Masterplan with actual multi-role workflows. Accepted coverage:36 passed,15 partial,167 unverified of218. Product is not consumer-ready; counts describe verified scenarios, not implementation percentage.

PR29 e139f878a541716a8faf04d5f443d9bf79a3d083 accepted after16 exact local cohorts, all applicable freshCI/fourQA jobs and independent ACCEPT. Actual merged0e53eb31a2f2790d191056ba6b0e02c022ad2186 has identical tested tree. Billing/Company verification recovery and actual bounded identity/expiry/authentication regressions are accepted.

Current slice integrates configured Worker email/phone and Company email through encrypted transactional delivery intents and the existing durable outbox. Fixed system origin remains separate from generic USER enqueue. Fresh post-lock database clocks and persisted purpose/destination/code hashes guard dispatch; network stays outside transactions. Email retries share idempotency; ambiguous SMS cannot auto-resend. Terminal/abandoned intents clear ciphertext; monotonic migration preserves history. Provider acceptance is not delivery. Owned UI feedback is neutral; Admin shows scoped channel configuration.

Prepared26native, actual nonSandbox browser, sandbox5/8, type/lint/security/build/portablepreview evidence and independent source review pass. New integrated exact candidate/freshCI/independent acceptance remain mandatory. No new scenario promotion from prepared tests; never complete whole feature/project for a bounded PR.

Next actual gap: nonSandbox AuthRecoveryService returns a token with no persisted eligible-account flow/challenge. Live inbox/device delivery, real PostgreSQL contention, broader privacy/materialhandoffs/deployment breadth remain unverified. User authorizes finishing workflows before final APIs; continue useful local work without routine credential questions.

Read NEXT_ACTION.json and one current receipt first. Preserve port3000, user-owned work and distinct audits. Use isolated databases/owned processes; avoid rerunning accepted PR29.

## 15 October: verified consolidation and remaining masterplan work

Owner requested both shared histories as context only, canonical source consolidation, and complete independent/connected workflows. Owner confirmed English-only interface. The current isolated branch retains older worktrees and data; no candidate has been published from this session. All claims below remain scoped, with exact release/CI/deployment pending.

Current bounded implementation slice (within WORKFLOW-001):
- Expose Verifier scoring conflict declaration; lock current draft and revision, remove conflicted authority, route the current case to Admin recovery, retain reason and immutable audit, and reassign using actual calibrated eligibility.
- Expose safe scoring amendment: retain original final evidence and linked revision; reopen only an eligible unclosed current case with no active interview/issued decision, require actual fresh rubric marking and explicit finalization/progression. Do not expose arbitrary aggregate-score replacement. Deny stale/foreign/conflicted/revoked actions.
- Implement selected high-risk independent second review, configurable quality sampling and bounded reviewer capacity without silently verifying evidence after only a first required review. Controls must be available to authorized Admin and tested through actual multi-role controls. Preserve case policy/version and immutable review history; disagreeing decisions reach Admin rather than automatic guilt.
- Select existing Controlled/Section Review, MCQ/written-only, offline/tab conflict, and emergency resume/replacement Chromium workflows in release verification.
- Repair proven native loader module-cycle failure without weakening product behavior or tests.

Acceptance requires failing-then-passing focused regression evidence, real controls plus downstream records for each new workflow, independent correctness/security/test review, all required checks on the final exact SHA, fresh hosted CI, and a data-preserving exact-build test deployment. Existing 218 scenario counts are stale and must not be promoted from source presence alone. Live provider activation remains separate from controlled local transport/outage proof.
