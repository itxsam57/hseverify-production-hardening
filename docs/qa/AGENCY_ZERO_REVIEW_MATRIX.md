# ZERO — 37-domain agency review matrix

This is the **technical test charter**, not a result ledger. Each original workflow/scenario in a batch inherits its brick's domain risk checks and its own Masterplan-specific expected actions. Each of the three reviewers must deliver a real evidence-backed PASS/FAIL/INCOMPLETE. More subcases may be required; **run a maximum of five independently executed cases in any single batch**.

| Brick | Engineer — live feature/workflow evidence | Cybersecurity expert — adversarial evidence | Independent reviewer — acceptance evidence |
|---|---|---|---|
| M1.01 | Startup, environment isolation, safe migrations, recovery and repeatability | Secrets, demo/test escape, deployment CSP/HSTS, migration drift | Exact signed build/config, DB rollback and operational proof |
| M1.02 | Every role's navigation, forms, keyboard, focus, responsive/empty/error states | Cross-portal redirects, unsafe links, exposed UI data | Real desktop and 320/390 mobile visible UX matches spec |
| M1.03 | Six-role signup/login, email/phone OTP handoff, MFA, password/session recovery | Brute/replay/expiry, token/session fixation, role escalation | Owner-visible flows, retries, denial and adapter readiness |
| M1.04 | Two tenants, two workers, scoped reports/files, private role actions | BOLA/IDOR, forged role/tenant selectors, stale grants, data leak | Receiving-role permissions and actual isolation observable |
| M1.05 | Immutable audit, notifications, action-deep links, retries/outbox | Forged event, unauthorized read, replay, audit tampering | Sender/recipient see correct state with evidence/history |
| M1.06 | Real PNG/JPG/PDF attachments, replacement, previews, quarantine and recovery | MIME/polyglot, malicious uploads, storage ACL, wrong-tenant downloads | Uploaded file arrives, scans, can be reviewed/rejected safely |
| M1.07 | Profile/identity submission, review, correction, resubmission, issue IDs | Identity swapping, duplicate account, stale/replayed review, ID guessing | Verified vs unverified status synchronizes across roles |
| M1.08 | Company submission, verification review, reject/approve, resubmit | Forged company approval, two-admin race, credentials leakage | Worker/company receive correct approved/rejected outcomes |
| M1.09 | Departments/teams/roles, membership changes, archive/restore | Privilege ceilings, archived teams, revoked access, cross-company | All impacted workers/staff update immediately |
| M1.10 | Invites, company codes, bulk CSV, multi-employment lifecycle | Invite code guessing/replay, CSV formula injection, tenant mixing | Company and worker receive correct link, removal and state |
| M1.11 | Qualification/experience/skills/employment document review and observation | Evidence substitution, forged verifier, revocation, private file leakage | Each submitted item gets its rightful reviewer outcome |
| M1.12 | Public QR/credential verification, concerns, authority and scanned evidence | Enumeration, opaque tokens, rate limits, tampered links, leakage | Public view safe; Admin sees authorized concerns and proof |
| M2.01 | Create assurance orders and cases, assignment/status through all roles | Foreign-case access, funding authorization, object ID tampering | Ordered case moves to intended actor and persists |
| M2.02 | Worker evidence handoff, accept/reject/resubmit across reviewers | Replacement race, evidence swap, cross-case review, privilege abuse | Correct receiver, comments, notifications and immutable history |
| M2.03 | Framework selection, policy version/calibration and effective dates | Stale framework bypass, unauthorized policy override, rollback | Case and assessor see identical pinned effective rules |
| M2.04 | Question bank creation, review, import, permissions and versioning | Answer leakage, unauthorized edits, unsafe imports and injection | Reviewer approves bank without exposing correct answers |
| M2.05 | Actual randomized tests/forms, timing, state save and rotation | Answer inference, retake/exposure, question selection tampering | Different attempts obey assigned blueprint and rules |
| M2.06 | Eligibility, application, fee/funding and company-worker decisions | Eligibility bypass, price/funding manipulation, cross-company | Funding and application outcomes align in every portal |
| M2.07 | Assessment attempts: start, answer, submit, grade and timeout | Forged attempt, replayed answers, duration/score manipulation | Candidate and assessor see correct final status |
| M2.08 | Offline, tab-out, interruption, emergency/quit, resume/replacement | Resume-token replay, state race, failed lock bypass | Restored attempt is consistent without duplicated answers |
| M2.09 | Camera/mic/screen capture, permissions, integrity evidence and consent | Proctor bypass/tamper, spoofed signals, unauthorized recording | Candidate flow explains consent and records valid integrity evidence |
| M2.10 | Written responses, marking, moderation, conflicts and amendments | Score tampering, reviewer conflicts, answer leakage, policy bypass | Audit shows actual rubric and defensible scoring decision |
| M2.11 | Interview booking, invitations, availability, rescheduling and cancellation | Appointment token replay, wrong actor, double booking | Worker/assessor/company calendars and notices agree |
| M2.12 | Assessor console, interview session, evidence, accommodations and completion | Recording access, forged presence/decision, stale session | Assessor can genuinely conduct session and submit result |
| M2.13 | Final decisions, second review, reassessment, credential handoff | Approval override, two-reviewer race, direct decision forgery | Correct resulting credential/interview/assessment lifecycle |
| M3.01 | Issue, renew, revoke and replace certificates/QR/PDF | Signature forgery, private PDF leak, revocation stale cache | Worker/company/public see correct credential status |
| M3.02 | Skills passport/living record updates, verification and visibility | Cross-worker read/edit, stale trusted claims, over-disclosure | Receiving employer sees only consented current proof |
| M3.03 | Scoped sharing, link grant, expiry, revocation and access log | Signed URL replay, tenant/user bypass, token harvesting | Holder can share and reliably withdraw actual access |
| M3.04 | Company directory, action centre, next-action and notices | BOLA, unauthorized bulk export, stale deep link | Company sees correct workforce case and actionable tasks |
| M3.05 | Billing checkout, payment/funding/refund state and receipts | Webhook signature/replay, amount change, double charge | Billing adapter tests succeed; real settlement explicitly later |
| M3.06 | Report generation, PDF/CSV/print, history and private access | CSV injection, PDF/CSV tenant leakage, forged export | Reports match authoritative DB and actor-specific visibility |
| M3.07 | Appeals, extra evidence, follow-up interview, review and status | Appeal state bypass, forged attachment, revoked reviewer | Original decision immutable, appeal receiving actor can act |
| M3.08 | Admin queues, governance, overrides, staff and monitoring | Owner/admin privilege, stale session, audit deletion | Admin actions traceable, reversible where intended |
| M3.09 | Privacy controls, access/deletion requests, mobile/a11y experience | PII leakage, unauthorized export/delete, retention bypass | Real controls are usable by keyboard and mobile |
| M3.10 | Each intentional open adapter (email/SMS/OTP/video/payment/scan/storage) | Secrets, signature validation, retry/idempotency, outage behaviour | Contract ready with simulated provider; live activation pending |
| M3.11 | Verify certificate and assessment/compliance readiness gates | Forged evidence, unsupported pass/acceptance and bypass | Result matches source data and acceptance requirement |
| M3.12 | Deployment, rollback, restore, monitoring and release handover | Secrets, backup/restore integrity, unsafe permissions, DoS caps | Consistent recoverable build; owner signoff remains later |

**Process:** Engineer demonstrates an actual functional journey; cybersecurity expert tests abuse paths and captures scope/results; independent reviewer traces the same original requirements and raw evidence without trusting a green badge. The batch is *technical confirmed* only when all applicable dimensions close. Otherwise persist scoped results, blocker and next action; unrelated batches continue.
