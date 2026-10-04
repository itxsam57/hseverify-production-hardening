# Frozen verification contract EF-WORKER-OTP-BOUNDARIES-20261004
Requirements: M1.03.02 email and phone OTP wrong/expired/resend/verified. Product LOCKED pending reproduced defect.
Exercise real Worker signup, each incorrect code and cooldown, each persisted expired challenge through already-rendered browser form, resend, then successful activation only after both contacts. Stop server before synthetic DB expiry/cooldown fixtures; real browser/server clock unchanged. Assert pending statuses/no sessions at intermediate boundaries, exact challenge invalidation/consumption and actual OTP security events. Live adapters and Company/staff OTP not certified by this Worker scenario; ledger remains partial until those branches.
Allowed: permanent meaningful browser test, named gate wiring and QA/factory state. Any product repair requires actual RED and bounded contract amendment. Exact candidate checks, independent review and actual required CI before merge.

Also exercise already-rendered stale email/phone forms after resend: actual cached browser POST must reject old challenge binding, not consume the new challenge.
