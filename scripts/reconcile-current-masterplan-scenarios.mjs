import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const source = JSON.parse(readFileSync(resolve("docs/qa/2026-10-02-evidence.json"), "utf8"));
const original = source.expanded_scenario_verification.scenarios;
assert.equal(original.length, 218, "The frozen expanded scenario matrix must contain 218 entries");
assert.equal(new Set(original.map(row => row.id)).size, 218, "Scenario identities must be unique");
assert.equal(new Set(original.map(row => row.brick)).size, 37, "All 37 frozen Masterplan bricks must be represented");
const currentSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

// These retained A26 logs were produced on the exact code candidate tested
// before this audit/runner change. Do not silently rebind them to later heads.
const legacyScopedRunSha = "1a36484a6a61dff74cea3cb9274a0b8a9881d9e7";
const scopedEvidenceOnCurrentHead = currentSha === legacyScopedRunSha;

// Local artifacts are evidence of individual *clauses*, not whole scenario completion.
// Never promote historical PASS/partial labels from an older commit.
const evidence = {
  "M1.03.01": ["20261029-A26-registration-provider-browser.log", "Positive Worker registration exercised; malformed fields and all rejection paths still need exact candidate browser coverage"],
  "M1.03.02": ["20261029-A26-registration-provider-browser.log", "Worker email/phone OTP browser and test HTTP adapter pass; resend, expiry and live provider delivery remain uncertified"],
  "M1.03.04": ["20261029-A26-registration-provider-browser.log", "Company email/MFA activation exercised with a simulated provider; full production registration and tenant acceptance remain unverified"],
  "M1.06.01": ["20261029-A26-storage-regression-suites.log", "Actual native PDF persistence and scan state pass; all PDF/PNG/JPEG across real production scanner, browser and records remain uncertified"],
  "M1.06.02": ["20261029-A26-storage-regression-suites.log", "Unsafe EICAR fixture and tampered/missing private objects denied; MIME, size and browser negative matrix not all current-SHA proven"],
  "M1.06.03": ["20261029-A26-storage-regression-suites.log", "Scanner retry exhaustion and stale-lease protection pass in native test; real external scanner failover and production queue remain unverified"],
  "M1.06.05": ["20261029-A26-storage-regression-suites.log", "Signed access, foreign/revoked principals, real byte read pass in native tests; preview context and actual production expiry remain open"],
  "M1.08.01": ["20261029-A26-storage-regression-suites.log", "Company verification native registration/evidence lifecycle passes; combined production browser scanned intake remains unverified"],
  "M1.08.02": ["20261029-A26-storage-regression-suites.log", "Company manager and pending-scope controls covered natively; exhaustive browser high-risk action denial remains open"],
  "M1.08.05": ["20261029-A26-storage-regression-suites.log", "Company approval activation and duplicate review denial covered natively; live provider and current-SHA end-to-end staging remain open"],
  "M3.10.01": ["20261029-A26-registration-provider-browser.log", "Mocked HTTP provider accepted email and SMS, queued status stayed distinct; live send/outage/retry not certified"],
  "M3.10.04": ["20261029-A26-storage-regression-suites.log", "Private storage fail closed and scan pending/retry natively tested; identity/liveness and actual external production scanner unverified"],
  "M3.10.05": ["20261029-A26-provider-baseline-native.log", "Provider health configured vs delivered distinction checked natively; real heartbeat/circuit breaker/webhook operational state unverified"],
  "M3.11.02": ["20261029-A26-storage-regression-suites.log", "Worker/Company secure file owner and session scope denied natively; cross-role all-endpoint adversarial staging pen not complete"],
  "M3.11.03": ["20261029-A26-storage-regression-suites.log", "Unsafe file, tampering, and signed token refusals verified natively; XSS/CSRF and all input attack paths not certified"],
  "M3.11.05": ["20261029-A24-repeatable-50-request-browser.log", "50 authenticated real-server GET responses covered five roles on local PGlite; active answers under load, SLA and staging resource saturation unverified"]
};
for (const [id, [file]] of Object.entries(evidence)) {
  assert(original.some(row => row.id === id), "Unexpected frozen scenario " + id);
  assert(existsSync(resolve(".autopilot/artifacts", file)), "Missing actual test evidence: " + file);
}
const burstPath = resolve(".autopilot/artifacts/mixed-role-http-burst.json");
let burstSameSha = false;
if (existsSync(burstPath)) {
  const burst = JSON.parse(readFileSync(burstPath, "utf8"));
  burstSameSha = burst.status === "PASS" && burst.requests === 50 && burst.releaseSha === currentSha &&
    Object.values(burst.perRole || {}).every(v => v === 10);
}
// Each observed acceptance test below was actually executed on this pinned
// Git head, before this audit-only commit. These are scoped local clauses;
// none is a full multi-environment Masterplan release certification.
const browserEvidenceHeadSha = "99f40a1c18a74b50cf7ebca6c54b512c921e8b2c";
const browserRuns = {
  company: {
    file: "20261029-A28-99f40a1-company-verification-evidence-browser.log",
    passed: "ℹ pass 1", failed: "ℹ fail 0"
  },
  worker: {
    file: "20261029-A28-99f40a1-worker-identity-evidence-sharing-browser.log",
    passed: "ℹ pass 1", failed: "ℹ fail 0"
  },
  adversarial: {
    file: "20261029-A28-adversarial-cross-role-browser.log",
    passed: "ℹ pass 4", failed: "ℹ fail 0"
  },
  notifications: {
    file: "20261029-A28-99f40a1-notifications-real-browser.log",
    passed: "ℹ pass 2", failed: "ℹ fail 0"
  },
  negativeWorkerCompany: {
    file: "20261029-A28-1a8b0fd-negative-worker-company-browser.log",
    observedCodeSha: "1a8b0fd792d657527ff831b39140701c987345bd",
    passed: "ℹ pass 5", failed: "ℹ fail 0"
  },
  supervisorPrivacyAppeal: {
    file: "20261029-A28-1a8b0fd-supervisor-privacy-appeal-browser.log",
    observedCodeSha: "1a8b0fd792d657527ff831b39140701c987345bd",
    passed: "ℹ pass 4", failed: "ℹ fail 0"
  },
  companyWorkerSecurity: {
    file: "20261029-A28-554bfbf-company-worker-security-browser.log",
    observedCodeSha: "554bfbf0d8fbae77042578919e9d18af8df86fea",
    passed: "ℹ pass 4", failed: "ℹ fail 0"
  },
  workerReviewWorkforce: {
    file: "20261029-A28-554bfbf-worker-review-workforce-browser.log",
    observedCodeSha: "554bfbf0d8fbae77042578919e9d18af8df86fea",
    passed: "ℹ pass 2", failed: "ℹ fail 0"
  },
  mfaAccommodationPrivacy: {
    file: "20261029-A28-93aab3d-mfa-accommodation-privacy-browser.log",
    observedCodeSha: "93aab3d661b82362a776a9c1178f8ab6877eac82",
    passed: "ℹ pass 7", failed: "ℹ fail 0"
  },
  recommendationStaffScoring: {
    file: "20261029-A28-464abda-review-recommendation-invitations-browser.log",
    observedCodeSha: "464abda9a22eb6a12d594f0d9a60bf693b560856",
    passed: "ℹ pass 11", failed: "ℹ fail 0"
  },
  certification: {
    file: "20261029-A28-fe9bc28-m3-11-certification-real-browser.log",
    observedCodeSha: "fe9bc28b2afa428321afdc141f89021a053f2278",
    passed: "ℹ pass 1", failed: "ℹ fail 0"
  },
  interviewEligibility: {
    file: "20261029-A28-f3d90fd-interview-eligibility-browser.log",
    observedCodeSha: "f3d90fdc193a1a8807c2baccaaf3372b73cd6f9b",
    passed: "ℹ pass 6", failed: "ℹ fail 0"
  },
  reportCredential: {
    file: "20261029-A28-f3d90fd-report-and-credential-browser.log",
    observedCodeSha: "f3d90fdc193a1a8807c2baccaaf3372b73cd6f9b",
    passed: "ℹ pass 3", failed: "ℹ fail 0"
  },
  reportFailure: {
    file: "20261029-A28-f3d90fd-report-retry-failure-browser.log",
    observedCodeSha: "f3d90fdc193a1a8807c2baccaaf3372b73cd6f9b",
    passed: "ℹ pass 4", failed: "ℹ fail 0"
  },
  appealIntegrityFixed: {
    file: "20261029-A28-394034e-exact-sha-appeal-integrity-browser.log",
    observedCodeSha: "394034eb88b1e310309bd19512ae34f8e6ecd06c",
    passed: "ℹ pass 3", failed: "ℹ fail 0"
  },
  assessmentFailure: {
    file: "20261029-A12-394034e-full-emergency-autosave-browser.log",
    observedCodeSha: "394034eb88b1e310309bd19512ae34f8e6ecd06c",
    passed: "ℹ pass 1", failed: "ℹ fail 0"
  },
  emergencyResume: {
    file: "20261029-A13-394034e-emergency-verifier-resume-browser.log",
    observedCodeSha: "394034eb88b1e310309bd19512ae34f8e6ecd06c",
    passed: "ℹ pass 1", failed: "ℹ fail 0"
  },
  emergencyReplacement: {
    file: "20261029-A13-acaba9c-exact-sha-replacement-browser.log",
    observedCodeSha: "acaba9cf8ba1ab227dc9cfb1701c355c427af025",
    passed: "ℹ pass 1", failed: "ℹ fail 0"
  },
  companyAction: {
    file: "20261029-A28-eeca501-company-action-centre-full-browser.log",
    observedCodeSha: "eeca5011f1b4e4e3d38302a38b5ab2e502eb9ce4",
    passed: "ℹ pass 1", failed: "ℹ fail 0"
  },
  secondDevice: {
    file: "20261029-A28-eeca501-second-browser-device-denial.log",
    observedCodeSha: "eeca5011f1b4e4e3d38302a38b5ab2e502eb9ce4",
    passed: "ℹ pass 1", failed: "ℹ fail 0"
  },
  dualEmployer: {
    file: "20261029-A28-0afd4df-dual-company-browser-final.log",
    observedCodeSha: "0afd4df37bea0e5d8187969090d4781142ef7594",
    passed: "ℹ pass 1", failed: "ℹ fail 0"
  },
  controlledReview: {
    file: "20261029-A28-0afd4df-controlled-review-full-browser.log",
    observedCodeSha: "0afd4df37bea0e5d8187969090d4781142ef7594",
    passed: "ℹ pass 1", failed: "ℹ fail 0"
  },
  sectionReview: {
    file: "20261029-A28-0afd4df-section-review-stable-config-browser.log",
    observedCodeSha: "0afd4df37bea0e5d8187969090d4781142ef7594",
    passed: "ℹ pass 1", failed: "ℹ fail 0"
  }
};
// Curated, exact assertions observed from the individual test source and output.
// Do not infer coverage for a whole brick from a file's name alone.
const browserClauseMap = {
  "M1.03.06": [["companyWorkerSecurity", "Actual six role session UI denies forged cross-account revocation and disallows protected page after sign-out, but exhaustive wrong-role and wrong-password/MFA matrix still open"]],
  "M1.03.07": [["companyWorkerSecurity", "All six roles sign out their active session and lose protected access; separate Exit Portal session-preservation behavior not exercised"]],
  "M1.09.02": [["companyWorkerSecurity", "Actual site/department archive removes matching Worker placement and Team assigned unit yet retains immutable prior-scope events, and restoring unit does not resurrect placement"]],
  "M1.09.03": [["companyWorkerSecurity", "Archived site and department cannot receive a forged new placement, and current Worker placement display excludes archived units"]],
  "M1.09.04": [["companyWorkerSecurity", "Company Team viewer invitation, real MFA enrollment, role+permission/site update, manager permission scope and live session validated; exhaustive permission matrix open"]],
  "M1.09.05": [["companyWorkerSecurity", "Suspended then revoked Team member's already authenticated Company dashboard access denied; events and access mirrors persisted"]],
  "M1.09.06": [["companyWorkerSecurity", "Actual Company Team UI and submitted form forbid staff member granting absent permissions or owner role; legitimate viewer invite still works"]],
  "M1.10.02": [["companyWorkerSecurity", "Actual Company mixed Worker CSV accepts valid row and flags malformed email, one invitation created; duplicate/larger CSV matrix open"]],
  "M1.10.03": [["companyWorkerSecurity", "Actual one-use Company registration code records expiry and selected site/department defaults, Worker redeems and tenant links correctly; exhausted/expired-code denial not exercised"]],
  "M1.07.05": [["workerReviewWorkforce", "Actual verified Worker identity correction independently rejected, changes requested and unable to verify while original verified parent retains status; all accepted-correction and duplicate collision cases still open"]],
  "M1.11.01": [["workerReviewWorkforce", "Actual Worker qualification revision submitted and Verifier REJECTED, CHANGES_REQUESTED and APPROVED reflected in Worker UI after independent review; broader invalid-file paths open"]],
  "M1.11.02": [["workerReviewWorkforce", "Actual Worker experience correction resubmitted and Verifier REJECTED, CHANGES_REQUESTED and APPROVED persisted and reflected in Worker UI; workplace source check unverified"]],
  "M1.11.03": [["workerReviewWorkforce", "Actual Worker skill correction resubmitted and Verifier REJECTED, CHANGES_REQUESTED and APPROVED persisted and reflected to Worker; skill lifecycle scope matrix open"]],
  "M1.11.04": [["workerReviewWorkforce", "Actual Worker employment revision independently reviewed REJECTED, CHANGES_REQUESTED and APPROVED with Worker-side status; multiple-employment unlink histories open"]],
  "M3.04.01": [["companyWorkerSecurity", "Actual Company filtered workforce pagination across 26 active matches, Previous/Next/refresh and mobile/desktop header search; revoked/foreign Workers excluded, forged scope denied, permission removal disables search"]],
  "M3.04.02": [["companyWorkerSecurity", "Company-created registration code creates specific Worker link, archived unit removes active placement while keeping immutable history and Worker state synced; moving between two employers unverified"]],
  "M3.04.03": [["companyAction", "Company submits actual Assurance Order, sees Worker identity follow-up in Action Centre, opens exact source case link and observes Order cancellation; full evidence/assessment/interview/decision next-action matrix is not tested here"]],
  "M3.04.04": [["companyAction", "Company browser assigns internal owner then verifies persistence on reload, rejects invalid past-dated snooze while preserving entered values, accepts future snooze, acknowledges action and follows exact case deep link; external reminders and other action kinds remain unverified"]],
  "M2.08.04": [["secondDevice", "Fresh separately authenticated browser of same Worker is denied active bound exam question and answer-control read with HTTP404; original session preserves exam and persisted IN_PROGRESS state; independent forged-write/session-switch mutation tests remain open"]],
  "M3.05.01": [["companyWorkerSecurity", "Actual sandbox Company checkout captured once, exact 10-credit balance despite capture replay, new provider-pending checkout grants no unpaid credit; live merchant not tested"]],
  "M3.05.04": [["companyWorkerSecurity", "Real Company sandbox billing applied partial then remaining full refund, balance zero and ledger has original capture plus two retained refund records; live processor settlement open"]],
  "M3.05.06": [["companyWorkerSecurity", "Actual invalid signed checkout callback and altered signed replay refused, exact same replay idempotent with no double credit or refund; provider live webhook unverified"]],
  "M3.10.02": [["companyWorkerSecurity", "Actual forged payment callback rejected, changed signed payload denied, provider-pending new purchase grants no credits even though old sandbox purchase and refunds completed; live gateway unverified"]],
  "M1.02.02": [["notifications", "Each of six role dashboards has actual working notification bell; rest of global header actions not covered"]],
  "M1.05.02": [
    ["notifications", "Worker application→Company funding request→Company approval→Worker assessment deep-link propagated by real outbox CLI; other transitions open"],
    ["recommendationStaffScoring", "Five Assessor case recommendation events projected through real outbox worker and Worker/Company/(where needed Admin) notification deep-links without private scorecard text"]
  ],
  "M1.05.03": [["notifications", "All six roles read/mark/mark-all/synchronize unread badge and 24 persisted read/audit records verified"]],
  "M1.03.01": [
    ["worker", "Actual valid Worker registration completes"],
    ["companyWorkerSecurity", "Actual Worker form denies missing policy acceptance, country, password mismatch, and cancels signup preserving recorded policy acceptance time; full field fuzzing not complete"]
  ],
  "M1.03.03": [["negativeWorkerCompany", "Browser detects three duplicate Worker contact combinations and requires recovery without identity merge"]],
  "M1.03.08": [
    ["negativeWorkerCompany", "Wrong recovery OTP rejected and audited; valid recovery invalidates old sessions and password without erasing identity; all six-role recovery remains open"],
    ["mfaAccommodationPrivacy", "Company/Assessor/Verifier/Admin/Root rotate ten unique recovery hashes and replace authenticators, audits persist, fresh old factors and code replay/cross-account/wrong password rejected, new factor succeeds with role security notification"]
  ],
  "M1.03.05": [["recommendationStaffScoring", "Five Company/Assessor/Verifier/Admin/Root actual staff invitations activate role-locked MFA sign-in; expired fresh/cached, unknown and issuer-revoked fresh/open token denial with no account/session; replay full matrix still open"]],
  "M1.03.02": [
    ["worker", "Worker email and phone OTP activation works with sandbox; real provider delivery open"],
    ["negativeWorkerCompany", "Actual email and phone wrong, expired/stale five-attempt lockout, cooldown, resend and fresh activation verified in real browser; live provider send still unverified"]
  ],
  "M1.03.04": [["company", "Company email/MFA activation leads to pending tenant; other edge states still open"]],
  "M1.06.01": [["company", "PDF upload is scanned and bound to Company verification version; other types and production scanner still open"]],
  "M1.06.05": [
    ["company", "Actual PDF Admin preview has inline PDF bytes; all authorization scopes/expiry not covered"],
    ["appealIntegrityFixed", "Authorized Admin clicked retained PNG evidence and opened real 200-byte image preview in new tab while retaining reasoned appeal form; other scopes and token expiry remain open"]
  ],
  "M1.07.02": [["mfaAccommodationPrivacy", "Worker qualification draft editable with dirty-state guard on links/Back, rejected malformed URL retains input, successful saved snapshot across navigation, delayed save cannot erase later edits; both native navigation/history fallback browser tests"]],
  "M1.07.03": [["negativeWorkerCompany", "Real initial identity rejection retains submitted version, reason and human review, and issues no permanent ID; approve and changes routes not this test"]],
  "M1.07.06": [
    ["adversarial", "Admin cleared duplicate Worker gets only one permanent ID; historical correction matrix open"],
    ["negativeWorkerCompany", "Rejected initial identity keeps immutable submitted version and no permanent ID"],
    ["workerReviewWorkforce", "Actual verified identity correction declined REJECTED/CHANGES_REQUESTED/UNABLE_TO_VERIFY without invalidating original verified identity; accepted-correction and historic permanent-ID projection open"]
  ],
  "M1.07.07": [["adversarial", "Actual duplicate document comparison and four independent dispositions; other duplicate-contact cases open"]],
  "M1.08.01": [["company", "Company registration, pending workspace, scanned PDF and submission in real browser"]],
  "M1.08.03": [["company", "Admin requests changes, Company corrects version 2 and Admin verifies"]],
  "M1.08.05": [["company", "Admin approval makes tenant active; stale Company edit denied, independent double decision matrix open"]],
  "M1.09.01": [
    ["company", "Verified active Company creates and revisits site unit"],
    ["companyWorkerSecurity", "Actual Company site/department create, edit, archive and restore verified across page reloads"]
  ],
  "M1.10.01": [
    ["company", "Company invitation created, resend cooldown and revoke"],
    ["companyWorkerSecurity", "Actual Worker invitation single/create, resend cooldown/revoke plus Company code Worker redeem; link accept through code only, expired/replayed email-link matrix open"]
  ],
  "M1.10.05": [["negativeWorkerCompany", "Real Company form ends exact active relationship with reason; Worker loses active Company access while keeping account and historical link"]],
  "M1.10.06": [["dualEmployer", "Two independently authenticated Company owners and one Worker saw two active tenant links, each Company foreign link returned HTTP404, reasoned Company B end retained A active and B historical, exact DB tenant-bound audit verified; both link fixtures preseeded so invitation enrollment/consent itself was not proven by this browser run"]],
  "M2.07.03": [["controlledReview", "Actual Worker Controlled Review revises and flags MCQ and written answer before submission, completes separate Verifier scoring, interview, signed credential, share and appeal; additional stale answer tab/device and real proctor hardware unverified"]],
  "M2.07.04": [["sectionReview", "Real Section Review revises and flags MCQ in section 1, locks it, denies Worker direct review of locked section, revises and flags written section 2 and reaches credential, share and appeal; real proctoring and multi-device race still open"]],
  "M1.12.01": [["worker", "Worker passport/scoped sharing flow exercised; public verification safe-opaque capability full matrix open"]],
  "M1.11.07": [["supervisorPrivacyAppeal", "Actual Company signed observation→Worker acknowledgement→Verifier APPROVED/REJECTED/CHANGES_REQUESTED and Worker/Company persisted feedback, including mixed status routing"]],
  "M3.01.01": [["reportCredential", "Decision-pinned credential issue/expiry reflected consistently in actual browser, public API and real PDF; signing/issuance policy beyond this test not reverified"]],
  "M3.01.03": [["reportCredential", "Actual browser, public status and signed credential PDF preserve pinned expiry and lifecycle display; exhaustive suspended/revoked/conditional states still open"]],
  "M3.02.02": [["reportCredential", "Credential version/current lifecycle with policy-pinned expiry inspected across browser/API/PDF; all restrictions and prior versions open"]],
  "M3.03.04": [["supervisorPrivacyAppeal", "Actual earlier share link retained then independently revoked; old recipient denied while new active share recipient still accesses"]],
  "M3.06.01": [["reportCredential", "Worker report UI captures owned qualification and versioned settings, real private CSV/PDF/print produced; all worker report variants open"]],
  "M3.06.02": [["reportCredential", "Actual Company generated scoped CSV/PDF/print via authenticated UI; all workforce/readiness/billing report categories unverified"]],
  "M3.06.03": [["reportCredential", "Actual Worker and Company report generation and owned private CSV/PDF/print download; Worker unrelated/anonymous/revoked principals denied; full filter matrix open"]],
  "M3.06.04": [
    ["reportCredential", "Real Worker and Company queued work generated actual private downloadable CSV/PDF bytes"],
    ["reportFailure", "Company/Worker browser refused pre-artifact export, distinguished retry/terminal failure, bounded real owner recovery, exhausted request starts new job; staging worker and long-term file retention open"]
  ],
  "M3.06.06": [["reportCredential", "Worker report forged-owner, cross-Worker, Company, anonymous and revoked downloads and stale settings updates denied; CSV formula/path manipulation not exhausted"]],

  "M3.07.01": [["appealIntegrityFixed", "Worker attached scanned submitted evidence version to an independently requested appeal follow-up; wrong eligibility/duplicate appeal matrix not completed"]],
  "M3.07.03": [
    ["supervisorPrivacyAppeal", "Admin reasoned rejected appeal preserves original credential and stale form cannot overwrite newer decision; other appeal outcomes open"],
    ["appealIntegrityFixed", "Real Admin requested scanned evidence response and reviewed original PNG bytes in separate private tab; Worker received reasoned rejection, and independent appeal interview path Admin→Worker readiness→Assessor→final appeal executed"]
  ],
  "M3.09.01": [
    ["supervisorPrivacyAppeal", "Worker optional sharing restriction request reached Admin for reasoned completion; other privacy-request kinds open"],
    ["mfaAccommodationPrivacy", "Actual Worker privacy retention inquiry reaches Admin response and returns persisted response/history to original Worker, no deletion/hold or legal-policy certification"]
  ],
  "M3.09.02": [["supervisorPrivacyAppeal", "Admin fulfilled sharing restriction: old recipient denied, Worker form disabled and new server-side link issuance HTTP403; wider consent/withdrawal still open"]],
  "M3.09.04": [["mfaAccommodationPrivacy", "Approved human caption and Spanish interpretation typed by assigned Assessor escaped and delivered to Worker across reload; missing exact active language capability truthfully unavailable; ended interview unmounts support; broader approved adjustment activation/real-human staffing unverified"]],
  "M3.09.06": [["mfaAccommodationPrivacy", "Worker human-support component verified with actual escaped user text on 390px viewport; other keyboard/screen-reader/accessibility paths unverified"]],
  "M2.06.01": [["interviewEligibility", "Worker and Company forged assessment application denied while required qualification unverified; actual Verifier approves source evidence and Worker becomes eligible, other unavailable reasons open"]],
  "M2.06.02": [["interviewEligibility", "After Verifier qualification approval, real Worker self-pay application and confirmation create pinned case and reach precheck; duplicate capture and live merchant not covered"]],
  "M2.06.03": [["notifications", "Actual Worker request reaches Company, approval creates funded case and start-precheck; rejection/retry/self-funded branches open"]],
  "M2.06.06": [["interviewEligibility", "Browser and forged Worker/Company apply blocked before assessment waiting threshold, then eligible after real clock advances; attempt-limit/credential/reassessment paths open"]],
  "M2.11.02": [["interviewEligibility", "Worker UTC availability persists on refresh, visible to Assessor; outside window blocked, inside scheduled, UTC independent of NY process timezone, 390px no overflow"]],
  "M2.11.03": [["interviewEligibility", "Assessor reasoned reschedule updates actual Worker/Company/Assessor appointment and real compiled outbox CLI: old events suppressed and new scoped notices/email accepted, private reason excluded"]],
  "M2.11.05": [["interviewEligibility", "Worker technical report only available in scheduled join window; persisted TECHNICAL_HOLD visible after refresh, no-show and late status branches open"]],
  "M2.11.06": [["interviewEligibility", "Worker technical-report control hidden before scheduling; actual join readied/unassigned access-denial not independently tested"]],
  "M2.12.06": [["recommendationStaffScoring", "Real Assessor finalized CONDITIONAL_PASS, ADDITIONAL_EVIDENCE_REQUIRED, REASSESSMENT_REQUIRED, SECOND_INTERVIEW_REQUIRED and FAIL, each Worker/Company status and projected authorized bell deep-link; PASS recommendation not included here"]],
  "M2.12.07": [["recommendationStaffScoring", "Each of five real browser Assessor final submissions locks subsequent input and transitions owned case and notification; real media shutdown/device behavior not covered"]],
  "M2.12.04": [["interviewEligibility", "Worker in-window technical issue persists interview runtime TECHNICAL_HOLD and request details, including refresh; other pause/reconnect/reschedule paths open"]],

  "M3.05.02": [["notifications", "Company funding approval persists exactly one reserved credit and one case; rejection and parallel overspend unverified"]],
  "M1.05.01": [["adversarial", "Duplicate resolution history and evidence review resolution persisted; full material-transition coverage open"]],
  "M2.02.01": [["adversarial", "Actual Worker submitted evidence reaches Verifier queue with a review task; all evidence kinds open"]],
  "M2.02.02": [["adversarial", "Claim, escalation and Admin return to Verifier preserve revision/history; all conflict paths open"]],
  "M2.02.03": [
    ["adversarial", "Unable to verify/escalate/admin return/approval reflected on Worker"],
    ["workerReviewWorkforce", "Actual independent Verifier REVISION REJECTED/CHANGES_REQUESTED/APPROVED for qualification, experience, skill, employment reflected Worker view; full staff permissions/stale races still open"]
  ],
  "M2.02.05": [["adversarial", "Admin binds review framework and Verifier cannot stale-finalize; calibration/limit edges open"]],
  "M2.07.01": [
    ["adversarial", "Real Chromium denies question until monitoring policy and required permission precheck; external device proof open"],
    ["notifications", "Company-funded Worker Start assessment reaches exact case/version precheck; broad device/media matrix open"]
  ],
  "M2.07.02": [["assessmentFailure", "Actual Worker browser empty MCQ and written answers refused; valid MCQ→Next, written autosave/submit durable; other modes and no-backtracking matrix open"]],
  "M2.07.06": [
    ["emergencyResume", "Real Emergency Exit→Worker recovery request→Verifier claim/allow-resume→return to bound exam without trapping Worker"],
    ["emergencyReplacement", "Real Emergency Exit→Verifier authorizes replacement→Worker starts different assessment form, answers and submits"],
  ],
  "M2.07.07": [["appealIntegrityFixed", "Real submitted Worker answers with integrity signals reached independent Verifier reasoned disposition and case routing; complete written-scoring rubric matrix open"]],
  "M2.08.01": [["assessmentFailure", "Actual Save and exit waits for saved written answer, Worker selects Resume and retained response reappears; emergency requires separate Verifier approval"]],
  "M2.08.03": [["assessmentFailure", "Browser reload after failed autosave preserved written draft and retried server commit; authoritative timer and crash across devices not completely exercised"]],
  "M2.08.05": [["emergencyResume", "Real Worker emergency exit, blocked immediate resume, Verifier claim plus reasoned ALLOW_RESUME, same attempt restored and final submitted"]],
  "M2.08.06": [["emergencyReplacement", "Original attempt retained as REPLACED and new form SUBMITTED after authorized Verifier APPROVE_REPLACEMENT; full case final decision not part of this A12 short test"]],
  "M2.08.07": [["emergencyReplacement", "Browser and physical PGlite check original exposed question IDs and written draft preserved, distinct replacement form has no repeated exposed questions"]],
  "M2.08.08": [["assessmentFailure", "Real delayed final submit request left submit disabled until server commit once with exactly two persisted answers; exact lost-response replay and retry idempotency still open"]],
  "M2.09.01": [["appealIntegrityFixed", "Real Worker paste signal and four distinct Verifier dispositions CLEAR, CONCERN_CONFIRMED, UNABLE, ESCALATE persisted with case/owner routing; real media provider not covered"]],
  "M2.09.02": [["appealIntegrityFixed", "Actual Worker paste event retained COPY_PASTE_DETECTED in Verifier integrity evidence and versioned reason; fullscreen/tab/network/device event matrix open"]],
  "M2.09.04": [["appealIntegrityFixed", "Real Verifier reasoned review with stale revision denial, Admin escalation return then re-review and case owner/status update; final decision all outcomes not covered"]],
  "M2.12.01": [["appealIntegrityFixed", "Admin appeal-requested interview→Worker readiness→Assessor console→retained interview response→independent final appeal; general intake consent/admit cases open"]],

  "M2.09.03": [["adversarial", "Camera/mic/screen denial, partial media acquisition cleanup, policy outage and degraded state handled"]],
  "M2.10.02": [["recommendationStaffScoring", "Verifier actual browser saves written rubric scores and final PASS, then starts reasoned amendment and rescores new FINAL FAIL retaining SUPERSEDED 80-point original and source answer"]],
  "M2.10.04": [["recommendationStaffScoring", "Verifier declares independent conflict, loses private scoring authority immediately and case returns to Admin recovery when no calibrated alternative; claim race and stale source remain untested"]],
  "M3.08.06": [["recommendationStaffScoring", "Root/role-bound Company, Assessor, Verifier and Admin staff invitations enroll MFA with correct role portal; expired/revoked cached and unknown denied, operational root permissions and recovery beyond invitation open"]],
  "M3.11.03": [["mfaAccommodationPrivacy", "Actual Assessor support API rejects HTML XSS execution, foreign Worker/tenant, missing/forged Origin/Host and forwarded headers, oversized 413 and schema extra fields; other upload/CSRF/XSS endpoints open"]],
  "M3.11.01": [["certification", "Local M3.11 certification executes native registration/review concurrency suite and 50 authenticated real-server GETs; full parallel business mutation matrix and staging load not covered"]],
  "M3.11.02": [
    ["adversarial", "Actual Worker forbidden Admin route; duplicate review and preview scope cross-role denied; exhaustive IDOR open"],
    ["notifications", "Unrelated Worker does not receive Company-funded assessment notification, exact actor and tenant delivery asserted"],
    ["certification", "Executed tenant isolation regression in disposable M3.11 certification; exhaustive staging endpoint attack matrix open"]
  ],
  "M3.11.04": [["certification", "M3.11 physical isolated database dump/restore and incident regression were executed with four persisted Admin drill results; deployed database/object provider restore and incident rehearsal remain open"]],
  "M3.11.05": [["certification", "Actual 50 parallel authenticated local five-role HTTP200 GETs (10 per role) in M3.11 certification; active answer preservation under concurrent mutation and production saturation open"]]
};
for (const [name, run] of Object.entries(browserRuns)) {
  if (name === "certification") {
    const fixtureProof = resolve(".autopilot/artifacts/20261029-A28-fe9bc28-M3-11-isolated-certification.json");
    assert(existsSync(fixtureProof), "Missing isolated M3.11 full-drill receipt");
    const receipt = JSON.parse(readFileSync(fixtureProof, "utf8"));
    assert(receipt.status === "certified" && receipt.drills?.length === 4 &&
      receipt.drills.every(drill => drill.status === "passed"),
      "M3.11 isolated certification did not persist all four passing drills");
  }
  const pathname = resolve(".autopilot/artifacts", run.file);
  assert(existsSync(pathname), "Missing exact-candidate Chromium evidence: " + pathname);
  const log = readFileSync(pathname, "utf8");
  assert(log.includes(run.passed) && log.includes(run.failed),
    "Chromium run " + name + " did not complete with expected passing count");
}
for (const [id, clauses] of Object.entries(browserClauseMap)) {
  assert(original.some(row => row.id === id), "Browser clause has unknown Masterplan ID " + id);
  for (const [name, note] of clauses) {
    assert(Object.hasOwn(browserRuns, name) && note.length > 30,
      "Incomplete observed browser clause " + id + " " + name);
  }
}

const records = original.map(row => {
  const local = evidence[row.id];
  const browserClauses = browserClauseMap[row.id] ?? [];
  return {
    id: row.id, brick: row.brick, roles: row.roles, scenario: row.scenario,
    historical_status_older_sha: row.status,
    current_result: "NOT_CERTIFIED",
    scoped_exact_browser_observations: browserClauses.map(([name, provenClause]) => ({
      provenance: "ACTUAL_CHROMIUM_LOCAL_TEST",
      observed_code_sha: browserRuns[name].observedCodeSha ?? browserEvidenceHeadSha,
      code_head_matches_observation: currentSha === (browserRuns[name].observedCodeSha ?? browserEvidenceHeadSha),
      log: ".autopilot/artifacts/" + browserRuns[name].file,
      proven_clause_only: provenClause
    })),
    scoped_local_evidence: local ? {
      disposition: "CLAUSE_ONLY_NOT_WHOLE_SCENARIO",
      observed_code_sha: legacyScopedRunSha,
      code_head_matches_observation: scopedEvidenceOnCurrentHead,
      log: ".autopilot/artifacts/" + local[0],
      remaining: local[1],
      ...(row.id === "M3.11.05" ? { exact_sha_50_get_burst: burstSameSha ? "PASS" : "NOT_VERIFIED_ON_HEAD" } : {})
    } : null
  };
});
const result = {
  report_type: "A28_CONSERVATIVE_NON_RELEASE_SCENARIO_RECONCILIATION",
  generated_at: new Date().toISOString(),
  current_head_sha: currentSha,
  historical_source_sha: source.expanded_scenario_verification.base_sha,
  frozen_scenarios: 218,
  frozen_bricks: 37,
  fully_certified_current_head: 0,
  with_scoped_recent_local_evidence: records.filter(row => row.scoped_local_evidence).length,
  scoped_local_evidence_from_prior_head: scopedEvidenceOnCurrentHead ? 0 : Object.keys(evidence).length,
  scoped_local_evidence_from_exact_head: scopedEvidenceOnCurrentHead ? Object.keys(evidence).length : 0,
  unique_scenarios_with_candidate_browser_clause: Object.keys(browserClauseMap).length,
  candidate_browser_code_shas: [...new Set(Object.values(browserRuns).map(run => run.observedCodeSha ?? browserEvidenceHeadSha))],
  browser_clause_observations_on_current_head: records.flatMap(row => row.scoped_exact_browser_observations)
    .filter(entry => entry.code_head_matches_observation).length,
  browser_clause_observations_on_prior_head: records.flatMap(row => row.scoped_exact_browser_observations)
    .filter(entry => !entry.code_head_matches_observation).length,
  unique_scenarios_with_any_scoped_evidence: records.filter(row =>
    row.scoped_local_evidence || row.scoped_exact_browser_observations.length > 0).length,
  without_scoped_recent_local_evidence: records.filter(row =>
    !row.scoped_local_evidence && row.scoped_exact_browser_observations.length === 0).length,
  exact_sha_50_request_burst: burstSameSha ? "PASS" : "NOT_VERIFIED_ON_HEAD",
  release_decision: "NO_GO",
  policy: "Historical statuses are informational; no per-ID current-head PASS without full role/browser/downstream/staging/provider assertions. Local subclause evidence never promotes scenario certification.",
  scenarios: records
};
const path = resolve(".autopilot/artifacts/a28-current-218-scenario-map.json");
mkdirSync(resolve(".autopilot/artifacts"), { recursive: true });
writeFileSync(path, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({
  current_head_sha: currentSha, original_scenarios: records.length, fully_certified: 0,
  scoped_local_evidence: result.with_scoped_recent_local_evidence,
  scope_evidence_from_exact_head: result.scoped_local_evidence_from_exact_head,
  scope_evidence_from_prior_head: result.scoped_local_evidence_from_prior_head,
  candidate_browser_clause_scenarios: result.unique_scenarios_with_candidate_browser_clause,
  browser_clause_observations_on_current_head: result.browser_clause_observations_on_current_head,
  browser_clause_observations_on_prior_head: result.browser_clause_observations_on_prior_head,
  unique_scenarios_with_any_scoped_evidence: result.unique_scenarios_with_any_scoped_evidence,
  not_locally_reconciled: result.without_scoped_recent_local_evidence,
  exact_sha_burst: result.exact_sha_50_request_burst, artifact: path, release: result.release_decision
}, null, 2));
