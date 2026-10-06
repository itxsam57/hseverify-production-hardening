# WORKFLOW-001 — current implementation contract

Finish the frozen HSE Verify Masterplan with real multi-role workflow evidence. Accepted coverage:35 passed,14 partial,169 unverified. Working notification/OTP ledger:36 passed,15 partial,167 unverified; exact candidate and fresh CI acceptance pending. Product is not consumer-ready.

PR27 accepted exact8af233aadfee1f7f8066ce685b6739911c67a457 after18 local cohorts, seven fresh workflows and independent review, merged e8d024c75a002060f709e488d58fef58a25d2351. Contact/demo intake reaches the scoped private Admin/Root queue; manual staff follow-up remains separate.

Current slice: current-role Mark all read, atomic required per-record audits, existing pending Company actor binding, Worker/Company OTP resend, exhaustion and audit rollback verification. Preserve active account/session/current role/exact company membership guards and repeat read timestamps. No new dependencies or schema for notification work.

Exact4060b94 audit exposed newly published sharp GHSA-wq5f-xc86-pv6w. Upgrade the existing override to0.35.5, regenerate only affected lock entries, retain failure evidence and rerun exact candidate security/browser/build gates before push.

Mandatory live email/SMS OTP delivery is still unimplemented: sandbox delivery cannot serve production. Provider transport and transactional dispatch need real implementation; local doubles do not prove live delivery. Broader privacy operations, production proxy/deployment and PostgreSQL contention remain open.

Use CURRENT_TASK and ACTIVE_RESUME to continue; do not repeat accepted PR27. Preserve port3000 and run isolated databases/free ports with owned processes.
