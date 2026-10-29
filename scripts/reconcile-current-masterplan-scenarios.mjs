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
  }
};
// Curated, exact assertions observed from the individual test source and output.
// Do not infer coverage for a whole brick from a file's name alone.
const browserClauseMap = {
  "M1.02.02": [["notifications", "Each of six role dashboards has actual working notification bell; rest of global header actions not covered"]],
  "M1.05.02": [["notifications", "Worker application→Company funding request→Company approval→Worker assessment deep-link propagated by real outbox CLI; other transitions open"]],
  "M1.05.03": [["notifications", "All six roles read/mark/mark-all/synchronize unread badge and 24 persisted read/audit records verified"]],
  "M1.03.01": [["worker", "Valid Worker registration succeeds, but negative-field matrix not covered by this run"]],
  "M1.03.03": [["negativeWorkerCompany", "Browser detects three duplicate Worker contact combinations and requires recovery without identity merge"]],
  "M1.03.08": [["negativeWorkerCompany", "Wrong recovery OTP rejected and audited; valid recovery invalidates old sessions and password without erasing identity; all six-role recovery remains open"]],
  "M1.03.02": [
    ["worker", "Worker email and phone OTP activation works with sandbox; real provider delivery open"],
    ["negativeWorkerCompany", "Actual email and phone wrong, expired/stale five-attempt lockout, cooldown, resend and fresh activation verified in real browser; live provider send still unverified"]
  ],
  "M1.03.04": [["company", "Company email/MFA activation leads to pending tenant; other edge states still open"]],
  "M1.06.01": [["company", "PDF upload is scanned and bound to Company verification version; other types and production scanner still open"]],
  "M1.06.05": [["company", "Actual PDF Admin preview has inline PDF bytes; all authorization scopes/expiry not covered"]],
  "M1.07.03": [["negativeWorkerCompany", "Real initial identity rejection retains submitted version, reason and human review, and issues no permanent ID; approve and changes routes not this test"]],
  "M1.07.06": [
    ["adversarial", "Admin cleared duplicate Worker gets only one permanent ID; historical correction matrix open"],
    ["negativeWorkerCompany", "Rejected initial identity keeps immutable submitted version and no permanent ID; correction-history branches open"]
  ],
  "M1.07.07": [["adversarial", "Actual duplicate document comparison and four independent dispositions; other duplicate-contact cases open"]],
  "M1.08.01": [["company", "Company registration, pending workspace, scanned PDF and submission in real browser"]],
  "M1.08.03": [["company", "Admin requests changes, Company corrects version 2 and Admin verifies"]],
  "M1.08.05": [["company", "Admin approval makes tenant active; stale Company edit denied, independent double decision matrix open"]],
  "M1.09.01": [["company", "Verified active Company creates and revisits site unit; edit/archive/restore missing"]],
  "M1.10.01": [["company", "Company invitation created, resend cooldown and revoke; accept/expiry/replay missing"]],
  "M1.10.05": [["negativeWorkerCompany", "Real Company form ends exact active relationship with reason; Worker loses active Company access while keeping account and historical link"]],
  "M1.12.01": [["worker", "Worker passport/scoped sharing flow exercised; public verification safe-opaque capability full matrix open"]],
  "M1.11.07": [["supervisorPrivacyAppeal", "Actual Company signed observation→Worker acknowledgement→Verifier APPROVED/REJECTED/CHANGES_REQUESTED and Worker/Company persisted feedback, including mixed status routing"]],
  "M3.03.04": [["supervisorPrivacyAppeal", "Actual earlier share link retained then independently revoked; old recipient denied while new active share recipient still accesses"]],
  "M3.07.03": [["supervisorPrivacyAppeal", "Admin reasoned rejected appeal preserves original credential and stale form cannot overwrite newer decision; other appeal outcomes open"]],
  "M3.09.01": [["supervisorPrivacyAppeal", "Worker optional sharing restriction request reached Admin for reasoned completion; other privacy-request kinds open"]],
  "M3.09.02": [["supervisorPrivacyAppeal", "Admin fulfilled sharing restriction: old recipient denied, Worker form disabled and new server-side link issuance HTTP403; wider consent/withdrawal still open"]],
  "M2.06.03": [["notifications", "Actual Worker request reaches Company, approval creates funded case and start-precheck; rejection/retry/self-funded branches open"]],
  "M3.05.02": [["notifications", "Company funding approval persists exactly one reserved credit and one case; rejection and parallel overspend unverified"]],
  "M1.05.01": [["adversarial", "Duplicate resolution history and evidence review resolution persisted; full material-transition coverage open"]],
  "M2.02.01": [["adversarial", "Actual Worker submitted evidence reaches Verifier queue with a review task; all evidence kinds open"]],
  "M2.02.02": [["adversarial", "Claim, escalation and Admin return to Verifier preserve revision/history; all conflict paths open"]],
  "M2.02.03": [["adversarial", "Unable to verify/escalate/admin return/approval reflected on Worker, other decisions open"]],
  "M2.02.05": [["adversarial", "Admin binds review framework and Verifier cannot stale-finalize; calibration/limit edges open"]],
  "M2.07.01": [
    ["adversarial", "Real Chromium denies question until monitoring policy and required permission precheck; external device proof open"],
    ["notifications", "Company-funded Worker Start assessment reaches exact case/version precheck; broad device/media matrix open"]
  ],
  "M2.09.03": [["adversarial", "Camera/mic/screen denial, partial media acquisition cleanup, policy outage and degraded state handled"]],
  "M3.11.02": [
    ["adversarial", "Actual Worker forbidden Admin route; duplicate review and preview scope cross-role denied; exhaustive IDOR open"],
    ["notifications", "Unrelated Worker does not receive Company-funded assessment notification, exact actor and tenant delivery asserted"]
  ]
};
for (const [name, run] of Object.entries(browserRuns)) {
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
