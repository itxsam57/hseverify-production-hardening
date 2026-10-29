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
const records = original.map(row => {
  const local = evidence[row.id];
  return {
    id: row.id, brick: row.brick, roles: row.roles, scenario: row.scenario,
    historical_status_older_sha: row.status,
    current_result: "NOT_CERTIFIED",
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
  without_scoped_recent_local_evidence: records.filter(row => !row.scoped_local_evidence).length,
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
  not_locally_reconciled: result.without_scoped_recent_local_evidence,
  exact_sha_burst: result.exact_sha_50_request_burst, artifact: path, release: result.release_decision
}, null, 2));
