# Worker duplicate registration and recovery

Scope: M1.03.03 and the Worker recovery portion of M1.03.08. Canonical baseline ce8468ab2eb011861c53f8111fd657d466678b86. Product repair is limited to AuthRecoveryService.resetPassword wrong-code transaction outcome.

## Reproduction

Actual browser submitted three duplicate contact combinations against a registered test Worker, then retrieved the real encrypted sandbox email delivery and submitted a wrong recovery code. The UI reported4 attempts remaining. The subsequent valid recovery revoked the prior browser session, denied the prior password and permitted the replacement password; identity/version/skill/evidence and account/role/Worker reference remained unchanged. Downstream database assertion failed because the challenge retained5 attempts. Artifact .autopilot/artifacts/20261005-worker-recovery-red-ce8468a-exact-label.txt has START/END ce8468a and one actual failure. The first probe run failed on an ambiguous browser label and does not count as product evidence.

Permanent service runtime RED had7 counter failures and3 existing rollback/eligibility tests passing. This is a transaction rollback defect, not unlimited recovery guessing: the separate persistent reset rate limit still applies.

## Repair and working verification

Return a rejected outcome from the transaction after recordOtpFailure and the immutable security-event projection commit, then throw the domain error outside it. Successful challenge/flow consumption, password replacement, session revocation and completion audit remain atomic. Genuine persistence errors still roll back. No schema, expiry, attempt limit, delivery, role, MFA or rate-limit policy changes.

Runtime10 working pass: five-attempt exhaustion and valid-code denial after exhaustion; six-role sequential resets following one wrong code; two pre-existing sessions revoked; replay denied; immutable audit failure on rejected/successful paths rolls back all associated state; wrong-role and unknown requests issue no usable flow. These are real service/repository/PGlite tests and do not certify public response indistinguishability.

Actual browser creates a nonempty identity draft and skill evidence draft, snapshots their records with account/role/Worker reference, denies same email/new phone, new email/same phone and exact-contact duplicates, and preserves them throughout recovery. Intermediate DB proves counter4 and one failure audit while password hash, session and identity stay unchanged. Final DB proves consumed challenge and recovery flow, exact failure/completion audit and old-session revocation. The replacement browser sees the same skill. Restarted development phases open fresh pages within unchanged browser contexts to avoid HMR navigation races; no production validation or clock is mocked.

Working artifacts: .autopilot/artifacts/20261005-recovery-working-green.txt; .autopilot/artifacts/20261005-recovery-strengthened-green-v2.txt. Exact candidate gates and actual CI remain required before merge. Named runtime/browser commands are included in canonical QA; browser command is included in critical-browser.

## Limits and next scope

M1.03.03 scoped working browser proof passes. M1.03.08 remains partial: authenticated password change, six-role browser recovery, privileged recovery policy, expiry/resend browser combinations and live delivery remain unverified. Independent source review identified inverse account/flow lock ordering between recovery request and reset; tracked in .engineering/DEBT.md. PGlite sequential evidence does not certify PostgreSQL concurrency. Whole Masterplan remains ACTIVE with20 passed/11 partial/187 unverified scenarios.

Broader engineering run passed release coverage, concurrent runner isolation, M2.01–M2.08 domain checks, then stopped at application environment validation because the invocation supplied no test session secret/auth pepper. Artifact .autopilot/artifacts/20261005-recovery-strengthened-green-v2.txt. This is a runner configuration failure; resume the remaining application gate with isolated test configuration, without changing production source or repeating unaffected domain checks. Lint passed with seven warnings in retained ignored earlier probes, no errors or warnings in this change.
