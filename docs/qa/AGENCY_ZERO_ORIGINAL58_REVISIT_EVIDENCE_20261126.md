# ZERO — original 58 batch scope-preserving QA handoff 2026-11-26

## Frozen release readiness

* Original 218 scenarios, 37 bricks, 58 original ZERO-001..058 batches; do not create additional R-series batches.
* FULL 0/218; ZERO-001 0/4, ZERO-002 0/5, ZERO-003 0/5. OWNER TESTING READY NO. Scoped source passes cannot be promoted.
* Approved product pin 7ff30ea140a5145e5d5ba761f7c7aef24c895269 unchanged. QA source with proposed scripts/lib migration helper changes differs; PR257 correctly blocks source drift. Existing shared protected stage does not match pin and TLS trust still unresolved.
* Workstation original evidence: /home/ubuntu/work/.hse-qa-tmp/agency-zero-sequential-closure-001/. GitHub comments on PR256 and PR258 cross-reference raw artifacts. This report omits synthetic credentials and PII.

## Observed real cases by separate bounded execution group

| Original batch | Scenario | What was actually executed | Scoped passed / group size | Raw ECR SHA256 |
|---|---|---|---|---|
| ZERO-002 | M1.02.02 | real six-role bell, 24 read notifications plus 24 immutable audit reads | 1/1 | be72ca8738457eba97cf18fa7d37afde25efa02b770bfc07de1dbce9b2fdf536 |
| ZERO-002 | M1.02.02 | bulk reads: owned role, tenant, expired, revocation, audit rollback/retry | 5/5 | 8644ce01370082ac283bdab06258fa0ba98984498f2e69eb247d166ed864585c |
| ZERO-002 | M1.02.02 | worker/company/assessor/verifier/admin search, pagination, forged scope | 5/5 | 3d6255a78281e3039ae0013317a50666d109276527e905631b10ec3fc86d3a73 |
| ZERO-002 | M1.02.02 | Root header search via keyboard with older-than25 & forged scope | 1/1 | 749e036aaf7139787305c08ae06aad8eb13095e70cf89abc801c77879ea49c41 |
| ZERO-002 | M1.02.05 | Worker/Company registration error labels and visible focus 1365/390/320 | 1/1 | b3d28bbfd31cce28257d3a5d0971499fd47d89de59fa40bab0d0b10ced5bc64c |
| ZERO-003 | M1.03.02+05 | 5 selected browser cases: OTP exhaustion, expired Company OTP, staff revoked/expiry, synthetic queued provider delivery | 5/5 | 8887930928e4d04bf7394fe6ed65e3702d7c443b7ebf3532aed6a533c9653647 |
| ZERO-003 | M1.03.05 | 5 selected staff invitation used-token/issuer/audit rollback permission cases | 5/5 | a109b44a30354becf5b1a5dd8365e12c93fb2085a40b03079604eca55bce4814 |

The entries above are SEPARATE execution groups with at most five selected case identities each; never combine a 5+1 cross-role run into a six-case original batch. The original scenario inventory is unchanged.

## Complete receipt index and original test source

* bell: ZERO002-M10202-SIXROLE-NOTIFICATION-BELL-THREE-REVIEW-20261126.json SHA256 be72ca8738457eba97cf18fa7d37afde25efa02b770bfc07de1dbce9b2fdf536.
* security5: ZERO002-M10202-NOTIFICATION-OWNERSHIP-BULK-SECURITY-FIVE-THREE-REVIEW-20261126.json SHA256 8644ce01370082ac283bdab06258fa0ba98984498f2e69eb247d166ed864585c.
* search5: ZERO002-M10202-SEARCH-FIVE-CHROMIUM-THREE-REVIEW-20261126.json SHA256 3d6255a78281e3039ae0013317a50666d109276527e905631b10ec3fc86d3a73.
* root1: ZERO002-M10202-SEARCH-ROOT-THREE-REVIEW-20261126.json SHA256 749e036aaf7139787305c08ae06aad8eb13095e70cf89abc801c77879ea49c41.
* focus1: ZERO002-M10205-REGISTRATION-A11Y-THREE-REVIEW-20261126.json SHA256 b3d28bbfd31cce28257d3a5d0971499fd47d89de59fa40bab0d0b10ced5bc64c.
* auth5_original: ZERO003-AUTH-MISSING-OTP-STAFF-PROVIDER-FIVE-THREE-REVIEW-20261126.json SHA256 08125611cf4c447bf12b64b3c2121c8ecc18b106e3d50c235dc6821b6399b561.
* auth5_corrected: ZERO003-AUTH-FIVE-PASS-WRAPPER-CORRECTION-THREE-REVIEW-ECR-20261126.json SHA256 8887930928e4d04bf7394fe6ed65e3702d7c443b7ebf3532aed6a533c9653647.
* staff5: ZERO003-M10305-STAFF-INVITE-AUTHORITIES-FIVE-THREE-REVIEW-20261126.json SHA256 a109b44a30354becf5b1a5dd8365e12c93fb2085a40b03079604eca55bce4814.
* precheck_ac77: ZERO001-AC77-HOSTED-PRECROSSCHECK-THREE-REVIEW-ECR-20261126.json SHA256 f109633f644bae295481486b59ef29ae61d799fd4c07899391a54f284bc81a04.
* old_hosted_fail7d7: ZERO001-FULL-AUDIT-7D7-CREDENTIAL-REPEAT-FAIL-ECR-20261126.json SHA256 85d218dd8960116565401906a7cc33158a0a1346fdb4b5a86f65e6b4d64e5d56.

ZERO-002 bell source browser test file: tests/browser/all-role-notification-workflow.browser.test.mjs; actual Node process exit0, 1/1 PASS no skip and all six Worker, Company, Assessor, Verifier, Admin, Root session contexts. 24 unique persisted read/audit records.
ZERO-002 notification permission source: tests/platform/notification-bulk-read-runtime.test.mjs 5/5 PASS exit0 skip0. Company scope, revoked, locked, expired and wrong-role reads denied; failed audit rolls back whole write, retry works.
ZERO-002 search groups: original browser source Worker/Company/Assessor/Verifier/Admin five different tests 5/5 PASS, separate Root browser test 1/1 PASS. All six sources byte-identical to approved original source pin; no customer/production mutation.
ZERO-002 public form keyboard test: tests/browser/consumer-validation.browser.test.mjs 1/1 PASS; visible focus and descriptive error attributes at 1365/390/320. Not an independent screen reader or all-role accessibility signoff.
ZERO-003 browser group: five different selected original source test cases executed 1/1 each: Worker OTP exhaustion, Company expired OTP and cross-Origin resend denial, staff issuer revocation, expired staff enrollment and mocked queued provider adapter. The provider test overrides global fetch for fixture Resend/Twilio endpoints with synthetic recipients. NO real live email/SMS was sent or verified.
ZERO-003 staff runtime test source: tests/platform/staff-invitation-revocation-runtime.test.mjs. 5 selected cases 5/5 PASS: audit rollback, used-token replay denied, foreign issuer denied, expired session/disabled/removed role denied, Admin can revoke own allowed invitation. No production writes.

## Test harness mistake and independent correction

Initial ZERO-003 outer report expected filtered Node tests to count unselected tests as skips. Actual Node selected each single case and returned exit0/pass1/fail0/skip0; two selected cases incorrectly labeled FAIL_OR_INCOMPLETE by outer wrapper. Preserve original receipt with SHA256 08125611cf4c447bf12b64b3c2121c8ecc18b106e3d50c235dc6821b6399b561. Independent correction without rerunning cases is SHA256 8887930928e4d04bf7394fe6ed65e3702d7c443b7ebf3532aed6a533c9653647. No product defect can be inferred from the wrapper mistake.

## Original ZERO-001 release gate / pending exact hosted CI

Prior SHA333 hosted full audit run 45813265507 and SHA7d7 hosted full run 45816580980 both TERMINAL FAILED the original Company workers Assurance header browser wait15s inside existing_full_regression_crosscheck. Independently isolated source-identical browser source test PASS1/1 does not override hosted RED.
QA-only PR258 source ac77d1e307d7c7fa3af63fe969c0e66849e4d36b stops its own synthetic Next dev server before complete regression and preserves original browser assertion. Hosted run45855649136 precheck artifact 17/17 independent real browser PASS, 8/8 corrections PASS, env/type/lint/dependency/build PASS, 0 critical/high initial findings, source pin unchanged. At evidence creation FULL CROSSCHECK TERMINAL RESULT IS UNKNOWN and precheck commands.tsv lacks a full-regression row. Never call this a full hosted pass before terminal artifact.

## Three-discipline review

ENGINEER: SCOPED PASS on exact named browser cases, storage/notification audit persistence, OTP and invite transitions. Full connected role workflows, all adapter contracts, complete code quality and final exact app source/stage crosscheck remain open.
CYBERSECURITY: SCOPED PASS on explicitly tested wrong-role, revoked, forged tenant, used token, expired code, audit rollback and replay denial. No verified full authenticated pentest, production SSL trust, real provider delivery or zero exploitable issues across all endpoints.
REVIEWER: AI inspected original frozen source identities, raw actual TAP exits/counts, source pin byte parity, E/C/R raw SHA256 and original harness false-red correction. Independent human UX/accessibility reviewer and final release adjudication are NOT signed. Original tech full remains 0/218.

## Resume exact unfinished work

1. Inspect hosted run45855649136 terminal FINAL-AUDIT.json AND commands.tsv existing_full_regression_crosscheck (must be actual exit0) and full credential-validity browser result; do not infer from precheck.
2. Preserve intentionally RED source pin drift in draft PR257 until proposed PostgreSQL concurrency migrator source is independently approved and affected same-SHA regression run; never bypass source guard.
3. Verify correct source on protected trusted HTTPS staging and independent E/C/R cross-role security, UI, adapter, persistence, rollback. Do not needlessly re-run completed original source cases listed above.
4. Continue original 58 batches and 218 technical FULL gates. Owner UAT is separate after tech readiness. No production/shared stage was modified.

Related draft GitHub PR256 original 58 restoration, PR257 pin guard, PR258 CI isolation; this is evidence-only addendum, unmerged.
Recorded UTC: 2026-11-26T16:31:01.783004+00:00
