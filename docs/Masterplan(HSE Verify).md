# Masterplan(HSE Verify)

**Canonical continuous product, workflow, UX, security and engineering blueprint**  
**Phase 1 status:** FROZEN SCOPE  
**Repository build position:** clean rebuild; prior prototype code is reference evidence, not an architectural dependency  
**Initial domain:** HSE and safety-critical workforce competency assurance  
**Long-term architecture:** industry-expandable Workforce Trust Platform  
**Canonical source date:** 1 August 2026  
**Repository synchronization date:** 3 September 2026

---

## 0. Authority, scope and how this file must be used

This file is the canonical continuous build blueprint for HSE Verify. It consolidates the finalized Phase 1 product intent, engineering rules, workflows, portal contracts, assessment behavior, operational requirements, three-milestone roadmap, the accepted missing-feature corrections, the accepted Version 10 capability vocabulary, and the current clean-rebuild execution state.

### 0.1 Source authority

The source set reconciled into this masterplan is:

1. **HSE Verify — Master Product, Feature, Workflow, UX and Engineering Specification**, dated 1 August 2026. This is the controlling Phase 1 product and engineering specification where older material conflicts.
2. **HSE Verify — Phase 1 Master Product Blueprint**.
3. **HSE Verify — Phase 1 Detailed Web Engineering and Functional Specification**.
4. **HSE Verify — Missing Features and Required Modifications Addendum**.
5. **HSE Verify — Master Product, UX, Security and Engineering Design Map**, only where its accepted requirements were carried into or do not conflict with the 1 August canonical specification.
6. **Build Roadmap and Milestones / Version 10 implementation record**, used as a capability-preservation and terminology cross-check, not as proof that the clean rebuild has already implemented those capabilities.
7. Current repository build-control documents: `docs/NEXT_BUILD_UNIT.md`, `docs/bookmarks/MILESTONE_PATH.md`, and `docs/bookmarks/LATER.md`.

### 0.2 Precedence rule

When material conflicts, use this order:

1. A later explicit owner-finalized instruction that deliberately changes the frozen plan.
2. This `Masterplan(HSE Verify)` after that owner-approved change is incorporated.
3. The 1 August 2026 canonical master engineering specification.
4. The Missing Features Addendum.
5. The Detailed Web Engineering and Functional Specification.
6. The Phase 1 Master Product Blueprint.
7. The Design Map and Version 10 record as historical/reference evidence only.

Current implementation sequencing is **not** inferred from old prototypes or old document timestamps. For execution state:

- `docs/NEXT_BUILD_UNIT.md` controls the exact active build gate.
- `docs/bookmarks/MILESTONE_PATH.md` controls permanent brick order and accepted/engineering-complete status.
- `docs/bookmarks/LATER.md` records unresolved/deferred/provider-dependent obligations; if a status statement there conflicts with the two documents above, the current gate and milestone path control.

### 0.3 Non-negotiable interpretation rules

**DOC-001 — Clean rebuild.** Preserve the product vision and accepted behavior, but treat the current implementation as a clean rebuild from zero. Prior prototype code may prove intent or expose regressions, but it cannot silently dictate architecture.

**DOC-002 — No silent feature removal.** A required feature cannot be dropped because it is difficult, expensive, incomplete, or provider-dependent. Provider-dependent capabilities must exist behind production-ready adapters and remain disabled or truthfully sandboxed until credentials are supplied.

**DOC-003 — Phase 1 is frozen.** Do not add new product features during implementation. Controls required for security, privacy, accessibility, legality, data integrity, availability, recovery and truthful operation are permitted because they make the frozen features safe and usable.

**DOC-004 — No decorative product controls.** Every page, card action, link, menu item, button and state described by the product must have a real permission rule, backend behavior or route, enabled rule, loading behavior, success behavior, failure behavior, and audit consequence where material.

**DOC-005 — Backend authority.** The UI is never a security boundary. Permissions, tenant isolation, state transitions, timers, assessment eligibility, question delivery, scoring, payment state, decision state and sensitive data projection are server-authoritative.

**DOC-006 — Preserve history.** Compliance and trust records are corrected, versioned, superseded, suspended, ended or archived; they are not silently overwritten or destructively deleted when history is required.

**DOC-007 — One active brick.** Build in the frozen milestone order. A later brick cannot be used to bypass an unfinished earlier brick unless the masterplan or a recorded owner decision explicitly changes sequencing.

**DOC-008 — Truthful capability state.** Sandbox, queued, simulated, unavailable and production states must be visibly different. Never represent a mock or queued provider action as a delivered production action.

**DOC-009 — Human accountability.** Automation and AI may extract, summarize, compare, flag and recommend. High-stakes identity, integrity, assessment, credential and employment-affecting outcomes remain governed by published rules and authorized human review; AI-suggested and human-confirmed values remain distinguishable.

**DOC-010 — No security theatre.** A browser assessment cannot be truthfully described as physically unclosable or cheat-proof. Phase 1 makes prohibited exit and suspicious behavior detectable, consequential, auditable and recoverable while always retaining an Emergency Exit path.

---

## 1. Product constitution

### 1.1 Product definition

HSE Verify is an independent workforce competency assurance and verification platform. It begins with HSE and safety-critical trades but is engineered as an occupation-neutral Workforce Trust Platform. It combines permanent worker identity, evidence verification, structured competency assessments, integrity evidence, human review, platform-based interviews, standardized decisions, digital credentials and company workforce intelligence.

The platform must answer these trust questions:

- Is the worker the person they claim to be?
- Are the submitted qualifications, experience records and employment documents genuine or sufficiently verified?
- Can the worker currently demonstrate the expected knowledge and practical judgment?
- Was the assessment completed under credible conditions?
- Did an authorized assessor verify the worker through a structured interview where required?
- What restrictions, expiry dates, reassessment requirements or unresolved concerns currently apply?
- Can the outcome be independently checked through a Worker ID, Credential ID, QR code or scoped share link?

### 1.2 Explicit non-goals

HSE Verify is not:

- an awarding body for NEBOSH, IOSH, OSHA or another third-party qualification;
- an official representative of a qualification provider without authorization;
- a training provider or LMS;
- a social network;
- a generic quiz website;
- a simple certificate-upload site;
- an automatic hiring-decision machine;
- a system that gives an employer ownership of a worker's lifelong identity;
- a system that promises perfect cheat prevention.

HSE Verify independently verifies evidence and assesses current competency. The employer remains accountable for its employment decision.

### 1.3 Frozen Phase 1 outcomes

Phase 1 must deliver all of the following:

1. Permanent worker identity and Worker ID.
2. Identity, qualification, experience, employment, skill and leaving-letter evidence submission and verification.
3. Assurance Orders and worker-specific Assurance Cases.
4. MCQ and written-answer assessments with secure randomization and permanent non-repetition wherever unseen approved alternatives exist.
5. One-question-at-a-time assessment delivery with answer-before-next behavior.
6. Integrity monitoring, human review and structured platform interviews.
7. Decision Engine, digital credentials, QR verification, scoped share links and Living Records.
8. Company workforce operations, Action Centre, reports, billing, credits and notifications.
9. Strictly separated worker, company, reviewer, assessor and admin portals.
10. A scalable, auditable, secure, accessible and provider-independent engineering foundation.

---

## 2. Canonical product terms

- **Worker ID:** permanent platform identity identifier that follows a worker across employers and attempts.
- **Assurance Order:** a company's formal request to verify, assess or reassess one or more workers under defined scope, funding, deadline and Effective Policy.
- **Assurance Case:** worker-specific execution record connecting identity, evidence, assessments, integrity, reviews, interviews, decisions, credentials and audit history.
- **Qualification Verification:** evidence-based determination that a submitted qualification can or cannot be verified; separate from competency assessment.
- **Competency Assessment:** independent evaluation of current knowledge, reasoning and job-related judgment through MCQ, written responses and interview where required.
- **Credential:** live, verifiable HSE Verify outcome issued only after relevant case requirements are satisfied.
- **Digital Competency Passport:** worker-facing structured collection of identity summary, qualifications, competencies, credentials, employment history and status.
- **Living Record:** continuing record of current competence, restrictions, conditions, expiry, suspension, reassessment, renewal and revocation without erasing earlier history.
- **Scoped Share Link:** worker-controlled, revocable and optionally expiring link exposing only selected approved fields for a stated purpose.
- **Structured Supervisor Observation:** workplace evidence documenting what an authorized supervisor directly observed against an approved competency framework.
- **Calibration:** benchmark process proving reviewers and assessors apply approved standards consistently before live work.
- **Effective Policy:** immutable policy snapshot resolved from platform minimums, jurisdiction requirements, assessment rules, permitted company rules and approved accommodations/exceptions.
- **Action Centre:** prioritized company queue for invitations, funding, approvals, interviews, evidence actions, expiries and other workflow tasks.
- **Exposure Family:** equivalent question variants treated as the same prior exposure for non-repetition.
- **Case Replay:** privileged reconstruction of exact evidence, versions, rules, responses and decisions for appeal/audit.
- **Quarantine:** private file state where evidence is uploaded but unusable until safety checks finish.

---

## 3. Roles, provisioning and portal isolation

### 3.1 Account creation

Public self-registration is allowed only for:

- Workers.
- A company's first authorized administrator during company registration.

Additional company users must be invited by an authorized company administrator.

The following never self-register:

- Reviewer / Verifier.
- Assessor / Interviewer.
- Super Admin.
- Root Platform Admin.

Staff activation uses a single-use link, password creation, mandatory MFA enrollment and staff-policy acceptance. Staff cannot change their own role or permission scope.

### 3.2 Portal boundaries

- `/worker` — Worker only; own profile, evidence, assessments, interviews, credentials, payments and privacy.
- `/company` — authorized company staff; own tenant workforce, orders, cases, assignments, organization, billing, reports and team.
- `/reviewer` — assigned/scoped verification, written-answer and integrity cases.
- `/assessor` — assigned interview queue, preparation, live console, scoring and recommendation.
- `/admin` — Super Admin operations within permission scope.
- `/root-admin` — privileged access management and emergency recovery, not routine case handling.

### 3.3 Strict session isolation

- Each authenticated session is bound to exactly one portal role and one permission set.
- There is no in-session `Switch Role` button.
- Access to another protected portal requires full logout and a fresh login through that portal.
- A person with two operational duties should normally have separate staff accounts; where one identity has multiple roles, fresh role-bound login and MFA are still required.
- Cross-portal URL/API manipulation must return a secure forbidden result, disclose no protected structure, preserve the user's authorized context and create a security audit event.
- **Exit Portal** returns to the public site while preserving the current role-bound session.
- **Sign Out** terminates the session.
- Exit Portal never grants another dashboard.

### 3.4 Scope-aware assignment

Reviewer scopes may include identity, qualification, written-answer and integrity review. Assessor scopes may include trade, qualification, level, language, country, jurisdiction and risk. Queue matching respects scope, current calibration, workload, conflict declarations and availability.

---

## 4. Platform architecture and invariants

### 4.1 Logical layers

- **Presentation:** public site, role portals, public verification, assessment client and interview console. No secrets, answer keys or decisive authorization logic.
- **Application:** identity, evidence, assurance, assessment, review, interview, decision, credential, notifications, billing and reporting use cases.
- **Domain:** entities, state machines, validation, permissions, policy resolution, scoring rules, events and invariants.
- **Data:** relational database, private object storage, search/indexing where justified, immutable audit, retention and backup.
- **Infrastructure:** hosting, CDN, queues, workers, messaging, video, payments, monitoring, secrets and deployment.

### 4.2 Module boundaries

Identity; Evidence and Qualification; Assurance Order and Case; Assessment and Question Bank; Integrity; Review; Interview; Decision; Credential and Living Record; Company; Notification; Subscription and Billing; Audit; Rules and Effective Policy; Reporting and Analytics; Integration Adapter Layer.

### 4.3 Engineering invariants

- Application servers remain stateless and horizontally scalable.
- Large uploads and recordings use private object storage, not the relational database.
- Slow/retryable operations run through durable background jobs.
- Notification, reporting, AI, video-processing or external-provider failure must not corrupt core case data or bring unrelated modules down.
- Published questions, rubrics, rules, assessment blueprints, policies and credentials are versioned instead of edited in place.
- Critical writes are idempotent and transactionally protected against duplicate clicks, retries and concurrent workers.
- Every company-owned query enforces a verified tenant boundary server-side.
- Every significant state transition is validated server-side and auditable.

---

## 5. Global UX and button contract

The interface must look professional, credible, calm and high-value rather than decorative. Public pages remain focused and demo-oriented; authenticated portals show role-specific next actions and real workflow state.

### 5.1 Global authenticated header

Include platform logo, portal/role label, role navigation, authorized search, notification bell with unread count and deep links, help/support, and profile menu with account, security, language, Exit Portal and Sign Out.

### 5.2 Every actionable control

For every button/link/card action/menu item:

- render only when role and record state permit;
- backend re-checks permission, tenant and state;
- disable until requirements are valid;
- prevent duplicate clicks and show action-specific loading text;
- update the UI after success without manual refresh;
- use auto-expiring success/error messages where appropriate;
- preserve input on recoverable failure and offer retry where safe;
- create an audit event for material actions;
- notify the next responsible actor where required;
- make payment, submission, assignment, invitation and issuance idempotent.

### 5.3 Forms, files and navigation

- Client validation is for usability; server validation is mandatory.
- Accessible labels, keyboard navigation, inline errors, required indicators and unsaved-change protection are standard.
- PDF/PNG/JPG/JPEG are supported where evidence policy permits.
- Extension, MIME, size and malware status are independently validated.
- Reviewer PDF/file views always show worker identity context, evidence category, document type and source record.
- Route changes must render new content immediately. A stale route requiring manual browser refresh is release-blocking.

---

## 6. Public website and public verification

### 6.1 Public navigation

Required public surfaces include `/`, `/how-it-works`, `/workers`, `/companies`, `/verify`, `/contact`, and `/auth/select` plus public About/support content where implemented.

Primary public actions: Worker registration, Company registration, Verify, Request Demo, Sign In and Contact.

### 6.2 Public verification contract

A public verifier can use an approved Worker ID, Credential ID when the credential system exists, or a signed QR route. Public verification is rate-limited, abuse-controlled, non-enumerating and based on an explicit safe-field allow-list.

Valid public facts may include only approved identity summary, Worker/Credential ID, credential or competency title, public status, issue date, expiry date, approved public restrictions and verification timestamp.

Never expose through public verification:

- passport/national ID numbers;
- full date of birth;
- home address or private contacts;
- private nationality/residence data where not explicitly public;
- identity evidence or private uploads;
- assessment questions, answers, answer keys or rubrics;
- raw scores not approved for publication;
- integrity methods, thresholds, recordings or private events;
- reviewer notes;
- private employment/company data;
- tenant/member/internal database identifiers;
- secure-file/storage identifiers or metadata.

Unknown, malformed and unauthorized identifiers must not become an existence oracle. Public result vocabulary is bounded and current implementation may deliberately converge unknown/invalid results into `not_found_or_invalid`.

### 6.3 Current M1.12 public-verification boundary

During M1.12, public verification may use the live Worker ID authority from M1.07, but must **not** fake later M3 credential issuance, Living Record or scoped-share capabilities.

Current M1.12 implementation contract additionally requires:

- `/verify` accepts one bounded identifier at a time;
- QR camera scanning is user-activated and always has manual-entry fallback;
- input normalization and rate/concurrency controls occur before expensive identifying work;
- the browser receives an opaque, purpose-separated, expiry-aware public result capability rather than internal entity IDs as authority;
- public result pages use a fixed state vocabulary: `valid`, `expired`, `suspended`, `revoked`, `not_found_or_invalid`, `temporarily_unavailable`;
- unauthenticated public access is read-only;
- any downloadable verification summary uses the same allow-list, timestamping, rate limits and truthful source URL;
- `Report Concern` creates immutable triage from the opaque public result; the reporter cannot choose a hidden worker/tenant/file binding;
- optional concern evidence uses the M1.06 private validation/quarantine/scan path, binds only after it is available, preserves rejected/failed history and supports safe retry;
- no private M1.11 evidence becomes public merely because it contributes to a public fact.

---

## 7. Authentication, sessions and account security

### 7.1 Worker registration

Capture legal name, email, phone, country, password/confirmation, optional company invitation code and terms/privacy acceptance. Email and phone OTP verification are mandatory before full onboarding. OTPs expire, are rate-limited and are never stored in plaintext. Sandbox codes are non-production only.

### 7.2 Company registration

Capture legal/trading name, registration number, country, industry, company size, website, authorized representative, business email/phone, password and terms/privacy. Registration creates a pending tenant and pending first administrator. High-risk workforce functions wait for company verification.

### 7.3 Staff authentication

Reviewer, assessor, admin and root routes accept only the correct staff role and return neutral invalid/unauthorized errors without disclosing account role. Staff MFA is mandatory. Privileged operations require recent MFA-backed reauthentication and a reason.

### 7.4 Security settings

Support password change, MFA administration according to role policy, active-session view/revocation, security activity, recovery codes where used and sign-out of other sessions. Sensitive recovery/security events are audited and notified.

---

## 8. Assurance Order and Assurance Case lifecycle

### 8.1 Assurance Order

A company order captures reference, workers/invitations, scope, site, department, requested checks, framework, interview requirement, credential target, deadline, funding, Effective Policy, company notes and billing/PO references where applicable.

Core actions:

- Save Draft.
- Add Workers through linked workers, Worker ID, invitation or approved bulk import.
- Validate eligibility, availability, funding and policy conflicts.
- Submit to lock the defined scope, reserve funding/credits transactionally, create one Assurance Case per worker, emit audit and notifications.
- Cancel Draft.
- Controlled cancellation of submitted work without erasing cases, financial history or completed evidence.

### 8.2 Assurance Case

The Assurance Case is the authoritative worker-specific record. It synchronizes identity, evidence, assessments, integrity events, review tasks, interview, decision, credential state and timeline. Dashboards and notifications must show the actual next action, not vague “processing” labels.

---

## 9. Worker portal and journey

### 9.1 Worker dashboard

Show Worker ID, identity status, profile completeness, current company/employment, qualifications/evidence, eligible assessments, assignments/funding, assessment progress, interviews, credentials, expiry/reassessment, appeals, notifications and payment actions as applicable.

### 9.2 Worker actions

Support:

- Complete/Edit Profile under version/correction rules.
- Copy Worker ID and View Public Verification.
- Add Qualification, Experience, Skill and Employment.
- Add Leaving Letter to the correct employment relationship.
- Apply for eligible assessments or request company funding where permitted.
- Join an interview only in the authorized window.
- Download credential through a short-lived authorized URL when M3 exists.
- Apply for reassessment/appeal/correction only when policy allows.

Worker records are never owned by one employer. Ending employment ends the relationship; it does not delete the identity or prior history.

---

## 10. Company portal and workforce operations

### 10.1 Dashboard and Action Centre

Company dashboards show workforce assurance totals, active orders/cases, funding actions, assessment/interview progress, expiries, site/department readiness, competency gaps, billing/credits and notifications within the user's scope.

Action Centre items have severity, source record, worker/order context, due date, owner and exact authorized action. Opening an action deep-links to the real source state.

### 10.2 Workforce directory

Support tenant-scoped, server-filtered and paginated search by approved fields such as name, Worker ID, employee reference, department, site, trade, assurance status, assessment state and expiry. Support authorized CSV export, print and individual reports without leaking hidden rows or evidence.

Worker/company relationship actions include:

- view company-scoped worker detail;
- assign/move role/site/department under permission;
- start assurance;
- request an update;
- end employment/relationship with effective date/reason;
- preserve historical records and audit after ending;
- suspend company access without altering the worker's global identity.

### 10.3 Invitations and codes

Support single and bulk worker invitations, staff invitations, company codes, site/department defaults, payment responsibility, assessment pre-assignment, expiry/usage limits, rate-limited resend, unused-token revocation and bulk CSV error reporting.

### 10.4 Sites, departments and team

Sites and Departments use a combined management interface. Archival is safe: after confirmation it unassigns active placements where required and preserves history. Archived units receive no new assignments until restored.

Company team/permissions are separate from the worker directory. A company administrator cannot grant permissions they do not themselves possess.

### 10.5 Company-only audit visibility

Company users see audit events belonging to their tenant and authorized resources. They never see platform security logs, other tenants, private reviewer notes or proprietary detection logic.

---

## 11. Identity Engine

### 11.1 Identity data/evidence

Support legal and previous legal name where relevant, date of birth, nationality/residence, verified email/phone, passport/national ID/residence permit, issue/expiry, profile photograph, selfie/liveness result where configured, identity corrections/versions and duplicate-detection signals.

### 11.2 Upload flow

Select document type → enter metadata → choose file → validate extension/MIME/size → private temporary upload → malware scan → safe preview → verify file/form binding → submit locked identity version.

### 11.3 Duplicate detection

Before issuing or linking a Worker ID, compare lawful identity signals including verified contact points, document identifiers/fingerprint, name/date of birth and lawful face-match output where configured. Possible outcomes: continue, recover existing account, create duplicate-review case, or temporarily block ID generation. **Never auto-merge identities.**

### 11.4 Identity state principles

Identity progresses through controlled states such as DRAFT, SUBMITTED, automated checks, manual review, more information, verified, correction pending, expired-document or suspended states as policy requires. Locked/submitted versions remain replayable. Corrections preserve earlier values.

---

## 12. Evidence, qualification, experience, skill and employment engine

### 12.1 Evidence categories

Identity, qualification certificate, training, licence/permit, experience, employment confirmation, leaving letter, skill evidence, structured supervisor observation and other approved evidence.

### 12.2 Qualifications

Qualification claims store title, issuing body/provider, certificate/reference number, issue/expiry, level, country, file, verification URL/supporting evidence and declaration. Qualification authenticity and competency assessment remain separate statuses.

Verification records method, source/reference, outcome and limitations. A reviewer must not label inability to verify as fraud without evidence.

### 12.3 Experience/employment

Store company, role, duties, country, start/end, current status and evidence. Multiple historical employers are supported. Ending an employment record sets status/end data and unassigns live relationship state; it does not delete history.

### 12.4 Skills

Skills record name/category, proficiency, duration, evidence, trade mapping and status. Self-declared, evidence-verified and competency-assessed are distinct concepts.

### 12.5 Leaving letters

Leaving-letter evidence is bound to the exact employment record and cannot leak into another employer/form.

### 12.6 Structured Supervisor Observation

1. Select worker and applicable framework/competencies.
2. Assign an authorized supervisor.
3. Capture observed event/task, checklist, restrictions and comments.
4. Supervisor signs declaration.
5. Worker acknowledges and may comment without altering supervisor evidence.
6. Reviewer verifies supervisor authority/completeness where required.
7. Observation becomes an evidence input; it does not automatically replace formal assessment unless published policy permits.

---

## 13. Reviewer / Verifier portal

### 13.1 Queues

Assigned to Me; unassigned within scope; identity verification; qualification verification; experience/employment; written answers; Yellow integrity; Red integrity; escalations; changes requested; near deadline; completed history; calibration.

### 13.2 Claiming, conflicts and calibration

- Case claim is atomic so two reviewers cannot own one live task.
- Conflict declaration is required before sensitive evidence when policy says so; conflict removes access/requeues and is audited.
- Task history records claimed, reassigned, completed and overturned cases for quality assurance without exposing unrelated workers.
- Reviewers and assessors must hold current calibration for the assigned framework. Expired/failed calibration removes live queue eligibility.

### 13.3 Review workspace

Display worker identity/name/Worker ID, evidence category/type, secure preview, metadata, case, prior versions, verification sources, task history and role-visible notes.

Review actions:

- **Approve/Verify:** requires verification method, source reference and structured confirmation.
- **Changes Requested:** identifies exact missing fields/evidence and returns the case while retaining history.
- **Reject:** requires reason code, explanation, confirmation and appeal path where permitted.
- **Unable to Verify:** records attempted methods and limitations without false fraud allegation.
- **Escalate:** requires reason and destination.
- **Save Draft Notes:** private to authorized reviewers.
- **Finalize:** locks the decision; later correction is an amendment, never replacement.

### 13.4 Review case types and quality control

Review types include identity, qualification, experience/employment, written answer, integrity, appeal, credential concern, duplicate identity and supervisor observation.

Quality controls: calibration, selected second review for high-risk cases, random quality sampling, conflict declarations, overturn tracking, workload limits and no deletion of finalized notes/decisions.

---

## 14. Assessment catalogue, eligibility and assignment

### 14.1 Phase 1 assessment types

Only two primary production question types are required in Phase 1:

1. MCQ.
2. Written answer.

Assessments may be MCQ-only, written-only or combined. Other formats may remain future-ready in the schema but are not activated as Phase 1 product behavior unless owner-approved later.

Blueprint configuration supports question counts, marks, section time, combined/separate timers, section separation, per-type minimums and whether both sections must independently pass.

### 14.2 Eligibility

Assessment availability derives from identity state, verified qualification/trade mapping, experience/risk rules, prior attempts, waiting period, current credential/reassessment state, company assignment, funding, jurisdiction, blueprint version and unseen-question-bank capacity.

Statuses may include available now, available after verification, assigned, waiting, not eligible, temporarily unavailable, reassessment-due or region-restricted according to policy.

### 14.3 Assignment and funding

Company assignment supports single/multiple workers and department/trade groups. Before confirmation, split eligible/ineligible workers with reasons; reserve credits/funding transactionally and record deadline, site, interview requirement and reminder schedule.

Funding modes include company immediate payment, company credits, worker pays, worker requests company approval, and future shared payment only as a disabled extension point until deliberately activated.

---

## 15. Question Bank, randomization and permanent non-repetition

### 15.1 Question record/lifecycle

Each question has stable ID, version ID, candidate text, internal title, type, qualification/trade mapping, topic/subtopic, difficulty, risk, marks, expected time, approved answer or rubric, author/reviewer/approval, publication/retirement and randomization settings.

Lifecycle: Draft → Under Review → Changes Requested → Approved → Published → Paused/Retired → Archived. Only Published versions enter live assessments. Editing a published item creates a new version; historical sessions retain the exact shown version.

### 15.2 Permanent exposure history

A question counts as exposed when securely delivered and displayed, even if unanswered or the session later interrupts. Exposure is keyed to permanent Worker ID and survives employer changes, devices, accounts, retakes, reassessments and renewals.

The selection engine excludes all prior exposed versions and equivalent variants in the same Exposure Family whenever unseen approved alternatives exist.

### 15.3 Form generation

1. Load assessment blueprint and Effective Policy.
2. Load permanent worker exposure history.
3. Filter to published, eligible, unseen questions.
4. Satisfy required topic/difficulty/risk/type/marks/time distributions.
5. Randomly select equivalent questions.
6. Randomize question order.
7. Randomize MCQ option order unless disabled for semantic correctness.
8. Reserve the complete form and persist question/version/option order before start.
9. Record blueprint/rule versions.
10. Fail safely if equivalent unseen capacity cannot be achieved.

The complete form stays server-side. Question-bank exhaustion must never silently repeat questions. Alert Super Admin and either block the attempt, use approved equivalent variants or allow only an explicit audited exception under a published rule.

Correct answers and rubrics never reach the candidate client.

---

## 16. Candidate assessment session

### 16.1 Controlled Web Mode

Phase 1 uses a dedicated minimal/fullscreen assessment route with route guards, before-unload warning, focus/visibility/fullscreen monitoring, device/session binding and controlled interruption policy. Browser technology cannot guarantee an unclosable window; the product must never claim otherwise.

A clearly labelled **Emergency Exit** is mandatory so a candidate cannot be trapped.

### 16.2 Pre-assessment checks

Supported browser/device, camera, microphone, screen-share/recording permission when required, connection, identity reconfirmation, environment declaration, monitoring consent, scheduled window and no simultaneous active session on another device.

### 16.3 One question at a time

- Only the current question is delivered to the browser.
- The complete form remains server-side.
- Candidate cannot see future question text/options, bank IDs, difficulty labels, answer keys or rubrics.
- Next remains disabled until the current response satisfies configured minimums **and the backend confirms storage**.

### 16.4 Progression modes

- **Strict Progression:** answer required; Next locks the response; no return.
- **Controlled Review:** answer required; one prior question at a time may be revisited; every change is versioned.
- **Section Review:** review within current section; section submission permanently locks it.

High-risk assessments default to strict progression unless another approved policy applies.

### 16.5 Candidate controls

- **Next:** validate → save → confirm → fetch next.
- **Previous:** only when blueprint permits; loads one prior item.
- **Flag:** candidate review marker only when review mode permits.
- **Report Technical Issue:** captures category/diagnostics without silently manipulating time.
- **Emergency Exit:** saves/buffers state, safely stops media, records `INTERRUPTED` and routes to controlled recovery/review.
- **Submit Section:** confirm and lock section.
- **Submit Assessment:** warn about unanswered items only where policy permits them, lock responses, stop monitoring, create receipt and begin scoring.

### 16.6 Save, recovery and device binding

MCQ selections and written text auto-save. The client may use an encrypted temporary offline buffer for connection loss, but the backend remains authoritative. Visible save states include Saving, Saved, Offline buffered, Reconnecting and Failed.

Submission is idempotent. Session binding includes worker, attempt, form, authorized browser/device session and security context; simultaneous use on another device is blocked. Controlled recovery may resume the same form or create a replacement form excluding **every question already exposed**.

---

## 17. Written-answer assessment and marking

Candidate view includes question number/total, scenario/prompt, approved supporting material, max marks if policy allows, recommended length, min/max response limits, timer, plain-text editor, word/character count and save state.

Candidate never sees rubric, model guidance, required keywords, critical-point list or AI recommendation.

Editor rules:

- plain text with minimal paragraph/bullet support;
- no arbitrary HTML/scripts/hidden text;
- no uncontrolled attachments;
- paste events logged;
- auto-save on intervals, material change, navigation and submission;
- recovery after temporary connection loss.

Written-question administration supports prompt, internal title, max marks, expected time, response limits, rubric, model guidance, critical safety points, escalation indicators, partial credit, acceptable alternatives, AI-assistance setting, human-review threshold and version lifecycle.

Reviewer marking shows exact question version, candidate answer/version history, time, word count, paste events, rubric, AI suggestion and relevant integrity events. Reviewer awards criterion-level marks and reasons. Finalization locks score; amendment preserves the original.

AI may identify concepts, omissions, contradictions, unsafe statements and suggested marks. It does not independently issue a high-stakes final outcome unless a specifically published low-risk rule allows it.

---

## 18. Integrity monitoring and proctoring

Captured signals may include identity reconfirmation, webcam presence, no/multiple face, microphone interruption/additional voice signal, screen-share/recording state, tab switch, window blur, fullscreen exit, copy/paste, connection interruption, device change, session timing and candidate technical reports.

Integrity classifications:

- **Green:** no material concern.
- **Yellow:** human review required.
- **Red:** serious concern, identity issue, prohibited behavior or insufficient evidence.

Candidate warnings follow Effective Policy and describe prohibited behavior at a safe level without exposing thresholds or proprietary detection logic.

Provider degradation is explicit. Camera/liveness/screen/video detector failure never converts into a clean integrity result merely because detection failed.

Automated observations are review leads, not guilt. Do not infer cheating from protected characteristics, disability-related movement or ambiguous background behavior.

---

## 19. Interview Engine and assessor workflow

### 19.1 Candidate-specific scheduling

Interview requests are created only when the case blueprint/decision rules require one. Automatic assignment matches trade/qualification scope, risk, language, jurisdiction, availability, workload, calibration and conflicts.

Scheduling supports candidate/assessor availability, timezone-safe calendar, reminders, reschedule reason, no-show handling and worker/company notifications.

### 19.2 Assessor dashboard and waiting room

Dashboard: Waiting Now, Today, Upcoming, Priority, Needs Rescheduling, No-Show Review, Completed, Calibration and Task History.

Waiting room: candidate identity summary, schedule, camera preview, mic test, connection, consent, Ready for Interview, technical issue and late/no-show state.

### 19.3 Full interview console

Keep live media and unsaved notes stable while internal tabs open. Show video/audio and connection state, timer/recording, structured questions, approved follow-ups, notes/scoring, profile/photo, verified qualifications/evidence, employment/supervisor observations, assessment topic breakdown, written answers, incorrect-MCQ topic summary, integrity flags, previous attempts, explicitly assessor-visible reviewer comments and decision context.

Controls:

- atomically Claim Interview;
- Admit only assigned/ready candidate;
- Start after identity/consent/policy checks;
- local mute/camera controls do not alter evidence policy;
- Pause requires reason and follows policy timer/recording behavior;
- Technical Issue captures diagnostics and supports reconnect/reschedule;
- End Interview stops media and requires scorecard completion;
- Save Draft persists notes/scores;
- Submit Recommendation locks recommendation, triggers Decision Engine path and audit.

### 19.4 Playbook and scorecard

Playbook includes mandatory questions, randomized approved questions, weak-area and high-risk questions, approved follow-ups, scoring guidance, automatic-fail safety statements, minimum duration and minimum topic coverage. Candidate-specific question set can derive from assessment errors, written weaknesses, integrity inconsistencies, trade risk, qualification level and attempt history and must be preserved for replay.

Recording policy may be video+audio, audio only, notes only or recording prohibited based on jurisdiction, company, assessment, consent and risk. Required consent must be resolved before start. Recordings use private storage and retention rules.

Score dimensions: technical knowledge, practical reasoning, safety awareness, communication, consistency with written answers, confidence/clarity, trade judgment, overall recommendation and required comments.

Recommendations: Pass; Conditional Pass; Additional Evidence Required; Reassessment Required; Second Interview Required; Fail.

---

## 20. Decision Engine

Inputs may include identity, qualification/evidence state, assessment score/topic minimums, written score, integrity class, reviewer outcome, interview score/recommendation, attempt history, Effective Policy, outstanding evidence and permitted company rules.

Outputs include Approved, Conditionally Approved, Pending Additional Review, Additional Evidence Required, Interview Pending, Reassessment Required, Rejected, Suspended, Revoked and Expired.

Every decision stores machine-readable reason code, human-readable explanation, rule version, input references, timestamp and audit event. User-facing explanation may redact proprietary detection or third-party private detail, but the internal case remains complete.

Manual override is limited to authorized administrators, requires recent MFA, reason, evidence, confirmation and notification, and preserves the original result in privileged history.

---

## 21. Credential Engine, Digital Passport and Living Record

### 21.1 Issuance

When the Decision Engine makes the case eligible:

1. create unique Credential ID;
2. calculate issue/expiry under the correct rule version;
3. generate signed verification payload and QR;
4. generate web credential and PDF;
5. update Digital Passport and Living Record;
6. notify worker/company as authorized;
7. create audit event.

### 21.2 Credential content

HSE Verify branding; worker name/photo where permitted; Worker ID; Credential ID; qualification/trade assessed; qualification verification state; competency level/score where publication is permitted; interview state; issue/expiry; QR/verification URL; live status; independent-assessment disclaimer.

### 21.3 Living Record

Maintain current competency, restrictions, conditions, expiry, renewal, reassessment, suspension and revocation while retaining historical versions. Replacement/renewal never erases prior status events.

### 21.4 Scoped Share Links

Worker selects approved field scope, recipient purpose, expiry and optional employer detail. Links are signed, revocable and access-logged. Never expose passport data, private answers, reviewer notes or unrelated employment.

### 21.5 Credential actions

Download PDF, copy verification link, view public version, generate/revoke scoped share link, report error, and controlled admin suspend/reinstate/revoke/replace.

---

## 22. Appeals, reassessment and continuing assurance

Workers may access reassessment, recheck/appeal, qualification reverification or trade reassessment only under applicable policy. Waiting periods, attempt limits, pass marks and validity are Rules Engine configuration, not hardcoded assumptions.

Appeal flow:

1. worker opens an eligible decision;
2. submits grounds and supporting evidence;
3. original decision is preserved and an appeal case is created;
4. independent reviewer is assigned where required;
5. additional evidence/interview may be requested;
6. appeal outcome records reasons;
7. credential and Living Record are superseded/updated if outcome changes.

---

## 23. Notifications and communication

Channels: in-app and email for required Phase 1 flows, with adapter-ready SMS, WhatsApp, mobile push and enterprise messaging where future activation is intended.

Every actionable notification deep-links to the exact authorized page/record. Delivery states include Queued, Sent, Delivered where provider supports, Failed, Retrying, Suppressed and Read.

Notification failure never rolls back the underlying business operation. Retries and provider health remain visible operationally.

---

## 24. Payments, subscriptions, credits and billing

Supported models: individual checkout, company subscription, assessment credits, bulk purchase, manual enterprise invoice, per-assignment funding, refund/dispute records.

Payment integrity:

- frontend “success” is never authoritative;
- signed provider webhook or verified server confirmation changes payment state;
- provider events are stored/deduplicated;
- credit/funding reservation is transactional so duplicate assignments cannot overspend.

Company billing views include plan, credit balance, usage, funding requests, invoices, payment methods, billing contacts, subscription state, approvals and audit.

---

## 25. Reporting, analytics and Action Centre

Worker reports: identity/verification summary, qualification report, assessment breakdown, interview summary, credential PDF, Living Record history, reassessment/appeal history.

Company reports: workforce status, site/department readiness, competency gaps, expiring credentials, assessment completion, interview outcomes, failed/pending cases, credit/billing usage.

Delivery options: preview, PDF, CSV, print, download, queued email, saved definition and scheduled report. Background generation uses Queued, Processing, Completed, Failed and Retry states.

Administrative analytics include registrations, active workers/companies, assurance/assessment volume, pass/fail, review turnaround, integrity flags, interview load, credential issuance, revenue, provider health and question-bank capacity.

---

## 26. Privacy, consent, accessibility and accommodations

Security and Accessibility are separate navigation/operational areas. Security protects account/session access; Accessibility manages delivery adjustments without reducing competency standards.

Consent records may cover webcam, microphone, screen recording, interview recording, company data sharing, public profile fields, scoped share links and retention notices. Each record stores version, purpose, date, actor, withdrawal rule and case. Withdrawal does not retroactively erase evidence that must lawfully be retained; future processing follows policy.

Accommodation workflow:

1. Worker requests accommodation and optionally supplies evidence.
2. Authorized reviewer evaluates it.
3. Approved adjustment is attached to Effective Policy for the assessment/interview.
4. Delivery adapts without lowering competency requirements.
5. Accommodation detail is visible only to staff who need it.

Privacy requests support access, correction, restriction, consent withdrawal, share-link revocation, retention inquiry and deletion where legally permissible.

No solely automated high-impact employment decision is a product goal. Protected characteristics and unnecessary sensitive data are minimized from employer/reviewer views. Fairness, accessibility and reviewer/interviewer calibration remain part of release quality.

---

## 27. Rules Engine and Effective Policy

Configurable rules include pass mark, topic minimums, question mix, duration, progression mode, waiting period, attempt limits, interview requirement, human-review threshold, integrity response, credential validity, renewal, recording, retention, notifications and high-risk second review.

Policy precedence:

1. platform mandatory safety/security minimum;
2. applicable law/jurisdiction requirement;
3. published assessment/framework rules;
4. permitted company policy that is not weaker than higher precedence;
5. case-specific approved accommodation/exception.

The resolved Effective Policy is snapshotted on Assurance Case and Assessment Session. Later rule changes never silently alter historical cases.

Rule lifecycle: Draft → Test → Approved → Scheduled → Active → Retired.

---

## 28. Integration architecture and provider health

Integration categories: HRIS, payment, video/interview, email/SMS/messaging, identity/liveness, qualification verification, malware scanning, object storage, analytics/monitoring.

Every provider sits behind an internal adapter. Provider IDs and payloads stay in integration records, not core domain fields.

Health views report configured/not configured, sandbox/production, last success, error rate, queue depth, webhook status, credential expiry, manual retry and circuit-breaker state.

Production credentials required before real activation include email/SMS delivery, real video, payment processing, liveness/identity verification and malware scanning. Until then, capability is explicitly disabled or sandboxed and the UI never labels queued/mock work as delivered production work.

---

## 29. Audit, evidence retention and case replay

Audit fields include event ID/type, actor/role, tenant, entity/record, before/after state, timestamp, reason, correlation ID, lawful session/device context and structured metadata.

Users, staff and administrators cannot delete their own audit history, alter timestamps or replace finalized decisions. Corrections create amendments linked to originals.

Case Replay can reconstruct exact assessment form/question versions, option order, answers/versions, timing, integrity timeline, reviewer decisions, interview questions/notes/retained recording, rule/policy versions, final decision and credential status history.

Retention is category- and policy-specific for identity evidence, qualification files, assessment/interview recordings, answer records, audit, rejected evidence and financial records. Expiry jobs preserve legal holds and appeal cases.

Sensitive record/file access should itself be auditable.

---

## 30. Data, API, events and background jobs

### 30.1 Core entity groups

- Identity: User, WorkerProfile, identity versions/documents/cases, ConsentRecord.
- Company: Company, CompanyUser, Department, Site, EmploymentRecord, Invitation, CompanyCode.
- Evidence: Qualification/versions, Experience, Skill, LeavingLetter, SupervisorObservation, EvidenceAsset, VerificationCase.
- Assurance: AssuranceOrder, order-worker relation, AssuranceCase, CaseTask, CaseTimelineEvent.
- Assessment: definitions/versions, Topic, Question/Version, Option, Rubric, Application, Assignment, Form, Session, Response, Exposure.
- Integrity/Review: IntegrityEvent, RecordingAsset, ReviewCase, ReviewDecision, CalibrationRecord, ConflictDeclaration.
- Interview: InterviewRequest, Interview, InterviewQuestionSet, Note, Score, Recommendation.
- Decision/Credential: FinalDecision, Credential/Version, StatusEvent, ShareLink, Appeal, LivingRecordEvent.
- Operations: Notification, Delivery, Subscription, Payment, Invoice, CreditLedger, ReportJob, Integration, BackgroundJob, AuditEvent, Rule/Version, PolicySnapshot.

### 30.2 Data rules

Use non-sequential public-safe IDs; tenant ID on tenant-owned records; timestamps; actor attribution; versioning/soft archival instead of destructive compliance deletion; DB constraints for uniqueness/state invariants; indexes for Worker ID, Credential ID, tenant/status, queues and expiry.

### 30.3 API standards

Versioned routes, authentication, permission/tenant enforcement, schema validation, consistent safe errors, pagination/filter/sort, rate limits, correlation IDs, idempotency keys and no unnecessary sensitive fields.

### 30.4 Domain events

WorkerRegistered, IdentitySubmitted, EvidenceSubmitted, QualificationVerified, AssuranceOrderSubmitted, AssessmentAssigned, AssessmentStarted, QuestionExposed, AnswerSaved, AssessmentSubmitted, IntegrityFlagged, ReviewCompleted, InterviewScheduled, InterviewCompleted, DecisionIssued, CredentialIssued, CredentialExpiring, PaymentConfirmed.

### 30.5 Background jobs

Email/SMS delivery, malware scan, PDF preview, credential PDF/QR, report generation, bulk import, recording processing, AI assistance, expiry alerts, retention purge and integration retry.

---

## 31. Security engineering

Non-negotiable controls:

- no secrets in repository or browser;
- server-side authorization and tenant isolation;
- MFA for staff and recent reauthentication for privileged actions;
- secure session handling/rotation;
- encryption in transit and at rest where supported;
- private, short-lived signed file URLs;
- malware scanning/quarantine;
- strict input/schema validation;
- rate limiting and abuse controls;
- CSRF protection where applicable;
- security headers;
- immutable audit;
- backup/recovery;
- least privilege.

Question security:

- one-question delivery;
- no correct answers/rubrics to candidate;
- short-lived session-bound authorization;
- protected pages not cached;
- question text excluded from standard analytics/logging;
- question access logged;
- no claim of guaranteed screenshot prevention.

Security tests include cross-tenant, cross-worker, cross-portal, role elevation, direct endpoint invocation, signed-URL reuse/expiry, webhook forgery, submission replay, duplicate issuance/payment, session fixation, brute force, malicious upload, stored XSS, injection, CSRF and concurrent claim races.

---

## 32. Scalability, performance and graceful degradation

Architecture supports simultaneous registrations, assessments, saves, uploads, reviews, interviews, searches, reports and dashboards without one module becoming a platform-wide failure point.

Controls include horizontal scaling, DB connection pooling/tuning, indexed/paginated queries, CDN for public/static content, private object storage, durable queues, separate job worker pools, safe reference-data cache, video isolation, backpressure/rate limits and graceful degradation.

Engineering targets under approved baseline load:

- authentication/standard API p95 < 500 ms excluding external-provider latency;
- assessment answer save p95 < 350 ms with visible retry if exceeded;
- next-question delivery p95 < 800 ms after confirmed save;
- worker/company list search p95 < 1.5 s with indexed server filtering;
- portal core usable content visible within 2.5 s on a supported connection;
- background queue-age/completion SLO defined per job category.

Exact concurrency certification comes from infrastructure sizing and load testing; never assume one server.

Graceful degradation:

- email outage: dashboard still exposes assignment;
- report outage: job remains queued, portal usable;
- video outage: interview follows reconnect/reschedule policy;
- AI outage: human queue remains available;
- malware scanner outage: file remains quarantined/unusable;
- payment outage: no paid entitlement until verified confirmation.

---

## 33. Monitoring, backup and disaster recovery

Monitor availability, API latency, error rate, DB saturation, queue depth/age, upload failures, assessment save failures, interview connection failures, webhook/provider failures, security anomalies and credential issuance failures.

Backups: automated DB backups, object-storage versioning/retention where supported, encrypted backup storage, restoration testing, documented RPO/RTO and separate production/backup credentials.

Incident flow: detect/classify → protect active assessments/sessions → contain affected integration/service → preserve logs/evidence → recover known-good state → notify where required → post-incident review and corrective action.

---

## 34. Definition of Done, regressions and release blockers

### 34.1 Definition of Done for every feature

A feature is not done until it has:

- documented workflow and permissions;
- data model/API behavior;
- happy path;
- empty state;
- loading state;
- validation state;
- failure/retry state;
- permission-denied state;
- audit event where material;
- notification where another actor must act;
- responsive layout;
- keyboard and screen-reader usability;
- unit tests;
- integration tests;
- end-to-end tests;
- build/lint/type checks;
- manual QA;
- updated documentation.

### 34.2 Critical regression groups

Authentication/portal isolation; worker identity/uploads; company tenant isolation; Assurance Orders/Cases; assessment form generation/non-repetition; answer saving/submission; reviewer decisions; interview queue/console; decision/credential issuance; billing/webhooks; notifications/deep links; reporting/exports.

### 34.3 Release-blocking defects

- any cross-role or cross-tenant access;
- question/answer-key/rubric leakage;
- lost or cross-linked evidence file;
- assessment answer loss;
- duplicate assessment submission, credential issuance or payment;
- route change requiring manual refresh;
- reviewer unable to identify the worker/source file correctly;
- unsafe deletion of employment/evidence history;
- stuck assessment without Emergency Exit/recovery;
- unlogged privileged decision.

---

## 35. Three-milestone implementation roadmap — frozen 37 bricks

### Milestone 1 — Platform Foundation, Identity and Company Trust

| Brick | Capability | Completion requirement |
|---|---|---|
| M1.01 | Repository, environments and CI/CD | Production-like separation, secrets, migrations, checks and rollback. |
| M1.02 | Design system and global UX | Tokens, layouts, forms, tables, messages, dialogs, accessibility and error states. |
| M1.03 | Authentication and portal isolation | Worker/company registration, OTP, staff provisioning, MFA, role-bound sessions and portal guards. |
| M1.04 | Authorization and tenant isolation | Permission model, company scoping, query guards and security tests. |
| M1.05 | Audit and notification foundations | Immutable events, in-app notifications, email queue and role-specific deep links. |
| M1.06 | Secure storage and upload pipeline | PDF/image isolation, MIME/size validation, quarantine, scan adapter and signed preview. |
| M1.07 | Worker onboarding and Identity Engine | Profile, documents, photo, duplicate detection, Worker ID, corrections and status timeline. |
| M1.08 | Company registration and verification | Tenant, initial admin, verification case and settings. |
| M1.09 | Sites, departments and team | Combined interface, archival, company staff invitations and scoped permissions. |
| M1.10 | Worker invitations and company codes | Single/bulk invitation, code limits, site/department/payment defaults and linking. |
| M1.11 | Employment, experience, skill and leaving-letter records | Integrated drafts, evidence and history preservation. |
| M1.12 | Public verification foundation | Worker ID search, safe projection, report concern and QR-route base. |

**Milestone 1 exit:** a worker can securely register, verify contact information, submit identity/evidence, receive a Worker ID, join a verified company and appear in the company directory. Strict portal isolation, tenant isolation, audit and secure uploads pass security testing.

### Milestone 2 — Assurance, Assessments, Review and Interviews

| Brick | Capability | Completion requirement |
|---|---|---|
| M2.01 | Assurance Order and Case Engine | Draft, validate, submit, one worker case each, timeline and Action Centre ownership. |
| M2.02 | Evidence verification queues | Identity, qualification, experience, employment, skill and supervisor-observation review. |
| M2.03 | Frameworks and Effective Policy | Qualification/trade frameworks, risk, rules, snapshots and versioning. |
| M2.04 | Question Bank | MCQ/written authoring, rubrics, approval, versioning, retirement and capacity metrics. |
| M2.05 | Randomized assessment form generation | Exposure history, unseen selection, equivalent blueprint, option randomization and reservation. |
| M2.06 | Assessment catalogue and eligibility | Verified-qualification availability, attempts, waiting, assignment and funding. |
| M2.07 | Candidate assessment window | System checks, one-question delivery, mandatory answer, progression modes and Emergency Exit. |
| M2.08 | Answer persistence and interruption recovery | Auto-save, offline buffer, idempotent submission, device binding and replacement form. |
| M2.09 | Integrity Engine | Camera/mic/screen/browser events, classifications, degraded mode and evidence timeline. |
| M2.10 | Written scoring and Review Engine | AI-assisted analysis, rubric marking, reviewer queues, conflicts and calibration. |
| M2.11 | Interview scheduling and assignment | Candidate-specific requests, matching, waiting room and reminders. |
| M2.12 | Interview console and playbook | Live media adapter, full case, questions, notes, scoring and recording policy. |
| M2.13 | Decision Engine | Inputs, reasons, states, overrides and audit. |

**Milestone 2 exit:** an eligible worker can complete a uniquely generated monitored assessment, retain written answers through interruption, pass through review, attend a structured platform interview and receive an auditable final decision.

### Milestone 3 — Credentials, Enterprise Operations and Production Readiness

| Brick | Capability | Completion requirement |
|---|---|---|
| M3.01 | Credential and QR issuance | Signed ID, PDF, web credential, QR, versioning and public status. |
| M3.02 | Digital Passport and Living Record | Qualifications, competencies, history, restrictions, expiry and reassessment. |
| M3.03 | Scoped share links | Field selection, expiry, revocation and access logging. |
| M3.04 | Company Action Centre and analytics | Live workflow status, approvals, readiness and competency gaps. |
| M3.05 | Billing and subscriptions | Checkout, company credits, invoices, webhooks, refunds and reconciliation. |
| M3.06 | Reports and delivery | PDF/CSV/print, email queue, scheduling and authorized exports. |
| M3.07 | Appeals, renewal, suspension and revocation | Independent review, evidence, amendments and Living Record updates. |
| M3.08 | Admin operational completeness | Users, companies, cases, rules, calibration, integrations, audit and health. |
| M3.09 | Privacy and accessibility operations | Consent, requests, accommodations and retention jobs. |
| M3.10 | Production integrations | Email/SMS, payment, video, liveness, malware scanning and provider health. |
| M3.11 | Load, security and recovery certification | Concurrency, penetration, tenant, restore and incident drills. |
| M3.12 | Production launch and operational handover | Runbooks, support, alerts, rollback and release acceptance. |

---

## 36. Complete end-to-end workflows

### 36.1 Independent worker to credential

Register worker → verify email+phone → complete identity/evidence → submit identity and receive Worker ID under accepted identity rules → identity/qualification verification → view eligible assessment → apply/pay/request funding → unseen randomized form generated → prechecks → answer one question at a time with confirmed saves → submit/auto-submit → objective/written scoring → integrity classification → human review where required → candidate-specific interview → assessor recommendation → Decision Engine → credential/QR/Passport/Living Record → scoped share/reassessment/appeal later as eligible.

### 36.2 Company Assurance Order

Create order → select workers/invitations/scope/site/department/deadline/funding → validate eligibility/credits → submit → one Assurance Case per worker → workers complete missing evidence → Action Centre tracks funding/approvals/deadlines → assessments/interviews → company receives authorized live state/results → credentials/expiry feed readiness → reports generated/scheduled.

### 36.3 Interrupted assessment

Connection/device/browser/emergency event → current answer saves or buffers → session records interruption and timer behavior per policy → candidate may reconnect same bound session if allowed → otherwise reviewer evaluates → approved replacement form excludes every displayed question → original session/exposure/reason remain preserved.

### 36.4 Appeal

Eligible worker starts appeal → submits grounds/evidence → appeal case preserves original decision → independent reviewer where required → additional evidence/interview if needed → reasoned outcome → credential/Living Record superseded if changed.

---

## 37. State machines and status dictionaries

### 37.1 Assessment Session

- `CREATED` → `READY`, `CANCELLED`, `EXPIRED`
- `READY` → `IN_PROGRESS`
- `IN_PROGRESS` → `INTERRUPTED`, `SUBMITTED`, `AUTO_SUBMITTED`
- `INTERRUPTED` → `RESUMED`, `REVIEW_REQUIRED`, `INVALIDATED`, `REPLACED`
- `SUBMITTED` / `AUTO_SUBMITTED` → `SCORING`
- `SCORING` → `REVIEW_PENDING`
- `REVIEW_PENDING` → `INTERVIEW_PENDING`, `DECISION_PENDING`, `INVALIDATED`
- `COMPLETED` → `APPEAL_PENDING` if eligible

### 37.2 Credential

`PENDING_ISSUANCE`, `ACTIVE`, `CONDITIONAL`, `EXPIRING`, `EXPIRED`, `SUSPENDED`, `REVOKED`, `REPLACED`.

### 37.3 Assurance Order

`DRAFT`, `VALIDATION_FAILED`, `READY`, `SUBMITTED`, `PARTIALLY_FUNDED`, `ACTIVE`, `COMPLETED`, `CANCELLED`, `CLOSED`.

All other major domain records use explicit validated transitions and version/audit history rather than arbitrary status mutation.

---

## 38. Canonical route/screen inventory

Public: `/`, `/how-it-works`, `/workers`, `/companies`, `/verify`, `/contact`, `/auth/select`.

Worker: `/worker/login`, `/worker/dashboard`, `/worker/profile`, `/worker/identity`, `/worker/evidence`, `/worker/assessments`, `/worker/assessment/[session]`, `/worker/interviews`, `/worker/credentials`, `/worker/privacy`, `/worker/accessibility`, `/worker/security`.

Company: `/company/login`, `/company/dashboard`, `/company/workers`, `/company/orders`, `/company/cases`, `/company/invitations`, `/company/organization`, `/company/team`, `/company/assessments`, `/company/interviews`, `/company/reports`, `/company/billing`, `/company/audit`.

Reviewer: `/reviewer/login`, `/reviewer/dashboard`, `/reviewer/cases/[id]`, `/reviewer/history`.

Assessor: `/assessor/login`, `/assessor/dashboard`, `/assessor/interview/[id]`, `/assessor/calibration`.

Admin: `/admin/login`, `/admin/dashboard` plus authorized operational screens for workers, companies, staff/permissions, orders/cases, evidence/review administration, blueprints, question bank, rubrics, calibration, interviews, rules/policies, decisions, credentials, appeals, billing, notifications, integrations, reports, audit and system health.

Root Admin: separate privileged route and security-recovery flow; not a routine operational portal.

Route names may evolve during implementation only if capability, permission and workflow semantics remain exact and bookmarks/tests are updated. No route may collapse portal isolation.

---

## 39. Current clean-rebuild position — repository truth as of 3 September 2026

## Current hardening mission — 11 September 2026

The owner explicitly superseded the earlier single-brick execution restriction with
`.codex-governor/mission.md`, on branch `codex/hseverify-full-hardening-20260911`
only. Preserve M1.01–M1.07; hard-reverify M1.08 onward against the canonical
masterplan, then complete remaining M2/M3 requirements in order. Do not merge or
push main. Historical owner acceptance is not inferred from automated tests.

Repository evidence at base `b8fd9609284bea8b52a6bcb159f208796ff6480f`:
M2.08 implementation was merged in `648af16` and closure recorded in `858c237`.
Its production modules are in `src/lib/assessment-attempt/`, migration `0043`,
and permanent runtime/browser tests are wired through `test:m2-08` and
`scripts/m2-08-browser-qa.mjs`. Thus “M1.12 only” and “M2.08 not built” below
are historical execution statements, superseded for this mission.

Existence is not full canonical completion: M2.08's historical acceptance excludes
replacement forms, device binding and an INTERRUPTED lifecycle. These remain
repository work under masterplan sections 16, 35 and 36. The mission ledger retains
ACTIONABLE status until current implementation and rendered workflow evidence
close each requirement. Provider absence alone never closes missing local code.



This section records implementation state; it does **not** change frozen product scope.

- M1.01 — DONE / owner accepted.
- M1.02 — DONE / owner accepted.
- M1.03 — DONE / owner accepted.
- M1.04 — DONE / owner accepted.
- M1.05 — DONE / owner accepted.
- M1.06 — engineering complete; current milestone records treat its engineering gate as done while later combined owner acceptance remains governed by project bookmarks.
- M1.07 — DONE / owner accepted.
- M1.08 — implementation merged / engineering passed; owner acceptance deferred to the combined Milestone 1 browser acceptance.
- M1.09 — implementation merged / engineering passed; owner acceptance deferred.
- M1.10 — implementation merged / engineering passed; owner acceptance deferred.
- M1.11 — implementation merged / engineering passed; owner acceptance deferred.
- **M1.12 — IN PROGRESS and the only permitted current product brick.**
- M2 and M3 product implementation must not be pulled forward to bypass M1.12.

Formal Milestone 1 owner-DONE count remains whatever `docs/bookmarks/MILESTONE_PATH.md` records; engineering completion and owner acceptance are deliberately not conflated.

The older Version 10 implementation proved many product concepts and passed its own validation, but its code/state is historical reference. Its “implemented” list must never be presented as current clean-rebuild completion unless the corresponding current milestone brick independently passes its own gates.

---

## 40. Version 10 capability-preservation cross-check

The clean rebuild must not accidentally lose the accepted capability meanings demonstrated in the earlier Version 10 record. Every item below is represented in the frozen roadmap/workflows above:

- mandatory email + phone OTP;
- Worker Profile/Identity navigation;
- identity, qualification, experience, employment, skill and leaving-letter evidence;
- history-preserving end/archive behavior instead of deletion;
- assessment availability tied to verified qualification/eligibility;
- candidate-specific interview request and scoped automatic assessor assignment;
- separate Security and Accessibility;
- role-specific notification deep links;
- company workforce search/filter/CSV/print/individual reporting;
- bulk worker/staff invitations with site/department/payment defaults;
- searchable Assurance Orders, approvals, billing and audit;
- safe site/department archival;
- report PDF/download/print/email queue;
- reviewer candidate context, task history, conflicts and calibration;
- full assessor interview console with case evidence/questions/notes/scoring;
- admin worker/company search, assessment blueprint/question/review operations;
- combined Sites and Departments;
- auto-expiring success/error messaging;
- company-only audit visibility;
- explicit Exit Portal versus Sign Out;
- Assurance Order, Assurance Case, Credential, Scoped Share Link, Living Record, Structured Supervisor Observation, Action Centre, Approve/Reject/Changes Requested, Calibration, Team and Permissions, Privacy, Accessibility/Accommodations, Effective Policy and Integration Health terminology.

This cross-check preserves product intent only; it is not a claim that all items above are already complete in the clean rebuild.

---

## 41. Provider-dependent production activation

Provider-independent code paths, interfaces, domain state and truthful sandbox behavior are part of Phase 1 even when production credentials are not available.

Open production dependencies include:

- live email delivery credentials/configuration;
- SMS/phone OTP provider;
- real interview/video provider;
- liveness/identity verification provider;
- malware-scanning service;
- payment merchant/provider credentials and webhook secrets;
- production hosting/traffic configuration and any compatibility override deliberately recorded by the build-control documents.

A missing credential never justifies removing the feature. The adapter and disabled/sandbox state remain implemented and testable.

---

## 42. Owner acceptance contract — what the finished product must be

The finished Phase 1 is acceptable only if all of the following are true simultaneously:

1. The product answers the core trust questions with evidence-linked, replayable records.
2. A worker's permanent identity and history survive company changes, corrections, reassessments and renewals.
3. A company can request, fund, monitor and report assurance without gaining ownership of or unauthorized access to the worker's global identity.
4. Worker, company, reviewer, assessor, admin and root boundaries cannot be bypassed through URL manipulation, browser changes or direct API calls.
5. Every visible workflow is real; there are no decorative/dummy queues, buttons or success states masquerading as functionality.
6. Assessments deliver one question at a time, never leak future questions/keys/rubrics, permanently track exposure by Worker ID, and never silently repeat when unseen approved alternatives exist.
7. MCQ and written answers survive normal refresh/network interruption according to policy; duplicate submits cannot create duplicate outcomes.
8. A candidate always has a safe Emergency Exit and a controlled recovery/review path; the product never traps a user or claims browser guarantees it cannot provide.
9. Reviewers and assessors see the correct worker/evidence context, are scope/calibration/conflict controlled, and cannot silently overwrite finalized work.
10. Interviews happen inside the defined platform workflow with case context, structured questions, notes, scoring, recording/consent policy and recovery.
11. The Decision Engine is explainable, versioned and auditable; overrides preserve original decisions.
12. Credentials, public verification, scoped sharing and Living Record always show live status and never expose prohibited private information.
13. Employment, evidence, audit, decisions and credential history are versioned/ended/superseded rather than silently destroyed.
14. Payments, notifications, exports, uploads and provider callbacks are idempotent, permission-scoped and safely retryable.
15. Sandbox/provider-unavailable states are truthful and cannot be mistaken for production delivery.
16. Accessibility and approved accommodations change delivery, not competency standards, and remain need-to-know.
17. All 37 milestone bricks satisfy their completion requirements and all three milestone exit criteria pass.
18. The critical regression groups pass, no release blocker remains open, production-provider activation is either genuinely verified or explicitly disabled, and backup/recovery procedures are tested.

**Final Phase 1 acceptance statement:** Phase 1 is complete only when every frozen workflow in this masterplan is implemented as a real, secure, auditable and tested operation; all three milestones pass their exit criteria; provider-backed capabilities are correctly activated or truthfully disabled/sandboxed; and no role, tenant, assessment, evidence, decision or credential boundary is bypassable through frontend manipulation or direct API use.

---

## 43. Masterplan change control and anti-drift rules

This file is a living **authority**, not a scratchpad.

- Do not add brainstorming, competitor wish-lists, unapproved “nice to have” features or implementation speculation.
- Do not delete a finalized feature because current code lacks it.
- Do not mark a requirement “done” merely because an old prototype had it.
- Do not change frozen milestone order casually.
- When the owner deliberately finalizes a change, record the decision, update the relevant requirement/milestone here, update build-control bookmarks/tests, and preserve history in Git.
- When code and this masterplan disagree, stop and reconcile rather than silently allowing code to redefine the product.
- When two repo status documents disagree, use `NEXT_BUILD_UNIT` for the active gate and `MILESTONE_PATH` for permanent milestone status; fix stale documentation rather than letting ambiguity persist.
- Every future handoff, coding agent and engineer must read this file before changing product behavior, then read the current build-control documents before deciding what to implement next.
