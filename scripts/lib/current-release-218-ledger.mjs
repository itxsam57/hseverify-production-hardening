import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Pinned to the 218 frozen IDs, bricks, roles and scenario statements.
// Editing a source scenario silently must NOT redefine the release target.
export const FROZEN_MASTERPLAN_DIGEST = "9b2441ae6f8003938eabe86ef678e2be11c3ede0b9d6eec729cae6269e51e5ad";

const ACCEPTANCE = Object.freeze([
  "Exact-SHA real browser UI, forms/buttons, layouts and accessibility",
  "Positive, negative, expiry, cancellation, retry, interruption and race behavior",
  "Cross-role receiving state, notifications, audit and persisted authoritative database",
  "Wrong-user, wrong-role, tenant, token, replay and direct API authorization abuse",
  "Relevant exploit/retest/regression and full exact-SHA staged penetration testing",
  "Applicable genuine external provider acceptance, final staging/operations and Owner UAT"
]);

const RELEASE_GATES = Object.freeze([
  "single_final_stage_sha_and_configuration",
  "all_218_complete_cross_role_flows",
  "complete_authenticated_ui_api_pentest",
  "real_provider_delivery_and_outage",
  "realistic_load_and_restoration",
  "incident_alert_and_rollback",
  "accessibility_and_responsive",
  "owner_uat_signoff"
]);

// Observed blockers from current QA handoff. This is a KNOWN minimum set,
// not a claim that every other scenario is free of external dependencies.
const EXTERNAL_BLOCKERS = new Map([
  ["M1.01.04", "Protected final-stage configuration, live operations and deployment rollback not independently verified"],
  ["M1.03.02", "Real external email/SMS OTP delivery, expiry and provider failure handling not yet signed off"],
  ["M3.10.01", "Production email/SMS providers and real delivery unavailable for release evidence"],
  ["M3.10.02", "Real payment provider acceptance/failure behavior not validated"],
  ["M3.10.03", "Production TURN/video provider and actual outage/reconnect not verified"],
  ["M3.10.04", "Production liveness, malware scanning and private storage providers unverified"],
  ["M3.10.05", "Real provider health and delivery monitoring not verified"],
  ["M3.12.02", "Real on-call receiver, paging acknowledgment and protected-stage alerts not configured/verified"],
  ["M3.12.03", "Production provider activation/real delivery not independently certified"],
  ["M3.12.04", "GitHub rollback workflow not default-branch registered; actual managed-stage rollback/restore RPO/RTO unverified"]
]);

// Exact-stage M3.12.01 is being actively examined but is far from fully verified.
const IN_PROGRESS = new Set(["M3.12.01"]);
const HISTORICAL_STATUSES = new Set(["passed", "partially-verified", "not-yet-verified-in-expanded-run"]);

function fingerprint(rows) {
  return createHash("sha256").update(JSON.stringify(rows.map(({ id, brick, family, roles, scenario }) => ({
    id, brick, family, roles, scenario
  })))).digest("hex");
}

function reconcilePriorTestExecution({ prior, frozenScenarios, commitSha }) {
  if (!prior) return null;
  assert.equal(prior.frozen_scenarios, 218, "Previous test index must match the frozen 218");
  assert.match(prior.inventory_started_from_git_head_sha ?? "", /^[a-f0-9]{40}$/, "Indexed inventory base SHA is mandatory");
  assert.match(prior.last_scoped_CI_reference_sha ?? "", /^[a-f0-9]{40}$/, "Previous CI tested source SHA is mandatory");
  const expected = new Set(frozenScenarios.map(row => row.id));
  const cases = prior.cases;
  const rows = prior.scenarios;
  assert(Array.isArray(cases) && Array.isArray(rows) && rows.length === 218, "Complete prior case and scenario evidence required");
  assert.equal(new Set(rows.map(row => row.id)).size, 218, "Prior scenario links must be unique");
  for (const row of rows) assert(expected.has(row.id), "Unknown scenario in prior test index");
  const uniqueCaseIds = new Set();
  const counts = { EXACT_CI_SHA_PASSED: 0, HISTORICAL_LOG_PASSED: 0, NO_PASS_LOG_EVIDENCE: 0 };
  for (const item of cases) {
    assert(typeof item.case_id === "string" && !uniqueCaseIds.has(item.case_id), "Duplicate or invalid prior test ID");
    uniqueCaseIds.add(item.case_id);
    assert(Object.hasOwn(counts, item.test_execution), "Invalid previously observed test execution");
    counts[item.test_execution] += 1;
    for (const id of item.scenario_ids ?? []) assert(expected.has(id), "Unknown prior test scenario association");
  }
  const c = prior.counts;
  assert.equal(c.static_existing_distinct_test_cases, cases.length, "Prior test denominator mismatch");
  assert.equal(c.current_reference_CI_green_distinct_cases, counts.EXACT_CI_SHA_PASSED, "CI pass count mismatch");
  assert.equal(c.historical_only_green_distinct_cases, counts.HISTORICAL_LOG_PASSED, "Historical pass count mismatch");
  assert.equal(c.source_tests_without_green_execution_proof, counts.NO_PASS_LOG_EVIDENCE, "Unproven-case count mismatch");
  assert.equal(c.previous_green_distinct_source_matched_cases,
    counts.EXACT_CI_SHA_PASSED + counts.HISTORICAL_LOG_PASSED, "Previously executed total mismatch");
  assert.equal(c.frozen_full_release_verified, 0, "A prior test snapshot cannot assert full release verification");

  const byId = new Map(rows.map(row => [row.id, row]));
  for (const scenario of frozenScenarios) {
    const row = byId.get(scenario.id);
    const actual = cases.filter(item => (item.scenario_ids ?? []).includes(scenario.id));
    assert.equal(row.existing_source_cases_linked, actual.length, "Historical per-scenario case count mismatch");
    assert.equal(row.green_exact_reference_CI_cases_linked,
      actual.filter(item => item.test_execution === "EXACT_CI_SHA_PASSED").length, "Historical CI linkage mismatch");
    assert.equal(row.green_history_only_cases_linked,
      actual.filter(item => item.test_execution === "HISTORICAL_LOG_PASSED").length, "Historical old-log linkage mismatch");
    scenario.scoped_test_evidence = {
      existing_source_cases_linked: row.existing_source_cases_linked,
      previously_observed_green_cases: row.green_exact_reference_CI_cases_linked + row.green_history_only_cases_linked,
      ci_green_reference_sha_cases: row.green_exact_reference_CI_cases_linked,
      older_log_green_cases: row.green_history_only_cases_linked,
      // Never equate a current-branch CI pass to complete protected-stage acceptance.
      full_scenario_certification: "NOT_FULLY_VERIFIED",
      linked_case_ids: row.linked_case_ids
    };
  }
  return {
    previous_distinct_green_cases: c.previous_green_distinct_source_matched_cases,
    existing_static_source_cases: c.static_existing_distinct_test_cases,
    not_yet_supported_by_previous_green_execution: c.source_tests_without_green_execution_proof,
    prior_ci_reference_sha_green_cases: c.current_reference_CI_green_distinct_cases,
    prior_ci_reference_sha: prior.last_scoped_CI_reference_sha,
    prior_ci_is_this_exact_sha: prior.last_scoped_CI_reference_sha === commitSha,
    older_historical_green_cases: c.historical_only_green_distinct_cases,
    green_cases_with_explicit_scenario_link: c.previous_green_distinct_source_matched_cases - c.passed_cases_needing_scenario_mapping,
    green_cases_awaiting_exact_scenario_link: c.passed_cases_needing_scenario_mapping,
    known_scenarios_with_at_least_one_linked_green_test: c.frozen_ids_with_at_least_one_sourced_green_case,
    green_security_titled_case_examples_not_full_pentest: c.previous_green_security_titled_cases_NOT_PENTEST_COVERAGE,
    inventory_started_from_git_head_sha: prior.inventory_started_from_git_head_sha,
    reference_is_full_stage: false,
    release_certified_from_these_tests: 0,
    accounting: "One historical or prior-CI passed case counted once by file+title; no full release scenario promotion",
  };
}

function reconcileLegacy216ScopedEvidence({ legacy, scenarios, prior }) {
  if (!legacy) return null;
  assert.equal(legacy.report_type, "LEGACY_A28_HISTORICAL_SCOPED_EVIDENCE_NOT_RELEASE_CERTIFICATION");
  assert.equal(legacy.historical_a28_source_sha, "eb77b70f6584c76169e7d6b849b88e25ae666696");
  assert.equal(legacy.frozen_scenarios, 218);
  assert.equal(legacy.counts.scenarios_with_any_historical_scoped_observation, 216);
  assert.equal(legacy.counts.total_scoped_observation_references, 316);
  assert.equal(legacy.counts.old_log_references_with_clean_green_run_summary, 307);
  assert.equal(legacy.counts.old_log_references_mixed_or_missing_clean_run_summary, 9);
  assert.equal(legacy.counts.historical_claimed_scenarios_without_any_observation, 2);
  assert(Array.isArray(legacy.scenarios) && legacy.scenarios.length === 218,
    "Every frozen scenario must be present in legacy scoped coverage");
  if (prior) {
    const validCases = new Set(prior.cases.map(item => item.case_id));
    for (const row of legacy.scenarios) {
      for (const cid of row.candidate_case_ids_from_old_logs_NOT_COVERAGE_CERTIFICATION ?? []) {
        assert(validCases.has(cid), "Old scenario candidate refers to missing current test identity");
      }
    }
  }
  const byId = new Map(legacy.scenarios.map(row => [row.id, row]));
  assert.equal(byId.size, 218, "Duplicate legacy scoped scenario");
  let refs = 0;
  let clean = 0;
  let claimed = 0;
  const candidateCases = new Set();
  for (const scenario of scenarios) {
    const row = byId.get(scenario.id);
    assert(row && row.legacy_a28_reconciliation_result === "NOT_CERTIFIED",
      "Legacy scenario missing or wrongly promoted");
    const observations = row.old_scoped_evidence;
    assert(Array.isArray(observations));
    assert.equal(row.previous_216_scoped_observation_present, observations.length > 0);
    refs += observations.length;
    claimed += observations.length > 0 ? 1 : 0;
    for (const item of observations) {
      assert.match(item.legacy_log_sha256 ?? "", /^[a-f0-9]{64}$/,
        "Old scoped log missing actual recorded SHA256");
      assert.match(item.legacy_source_sha ?? "", /^[a-f0-9]{40}$/,
        "Old scoped log missing source SHA");
      assert(item.log_evidence_status === "CLEAN_OLD_TEST_LOG" ||
        item.log_evidence_status === "MIXED_OR_NO_CLEAN_SUMMARY",
        "Unknown old log evidence state");
      if (item.log_evidence_status === "CLEAN_OLD_TEST_LOG") clean++;
    }
    for (const id of row.candidate_case_ids_from_old_logs_NOT_COVERAGE_CERTIFICATION) candidateCases.add(id);
    scenario.historical_scoped_216 = {
      old_claim_present: observations.length > 0,
      old_reference_count: observations.length,
      old_clean_log_reference_count: observations.filter(x => x.log_evidence_status === "CLEAN_OLD_TEST_LOG").length,
      old_mixed_or_unconfirmed_count: observations.filter(x => x.log_evidence_status !== "CLEAN_OLD_TEST_LOG").length,
      uniquely_named_current_source_candidates_NOT_CREDITED: row.candidate_case_ids_from_old_logs_NOT_COVERAGE_CERTIFICATION,
      old_source_sha: legacy.historical_a28_source_sha,
      raw_log_observations: observations,
      final_candidate_status: "SCOPED_OLD_ONLY_NOT_FULLY_VERIFIED"
    };
  }
  assert.equal(refs, 316);
  assert.equal(clean, 307);
  assert.equal(claimed, 216);
  assert.equal(candidateCases.size, 375, "Old A28 unique current-source case candidate count changed");
  return {
    historical_scoped_216_of_218: claimed,
    old_scoped_references: refs,
    old_unambiguously_clean_run_references: clean,
    old_mixed_or_uncertain_references: refs-clean,
    old_missing_scoped_scenario_ids: scenarios.filter(x => !x.historical_scoped_216.old_claim_present).map(x => x.id),
    old_source_test_case_candidate_names_distinct_not_automatic_credit: candidateCases.size,
    old_source_sha: legacy.historical_a28_source_sha,
    previous_216_is_a_historical_scoped_observation_claim_not_216_passes: true,
    full_release_scenarios_certified_by_legacy: 0
  };
}

export function buildCurrentReleaseLedger({ source, commitSha, priorTestEvidence = null, legacy216Evidence = null, generatedAt = new Date().toISOString() }) {
  assert.match(commitSha ?? "", /^[a-f0-9]{40}$/, "A full exact Git SHA is mandatory");
  const rows = source?.expanded_scenario_verification?.scenarios;
  assert(Array.isArray(rows) && rows.length === 218, "Frozen Masterplan must contain exactly 218 scenarios");
  assert.equal(new Set(rows.map(row => row.id)).size, 218, "Frozen scenario IDs must be unique");
  assert.equal(new Set(rows.map(row => row.brick)).size, 37, "Frozen Masterplan must contain exactly 37 bricks");
  for (const row of rows) {
    assert(Array.isArray(row.roles) && row.roles.length > 0, "Frozen scenario role list is invalid");
    assert(HISTORICAL_STATUSES.has(row.status), "Unknown historical scenario status");
  }
  const digest = fingerprint(rows);
  assert.equal(digest, FROZEN_MASTERPLAN_DIGEST, "Frozen Masterplan fingerprint mismatch");
  const originalSourceSha = source.base_sha ?? source.expanded_scenario_verification.base_sha ?? null;

  const scenarios = rows.map(row => {
    const blocker = EXTERNAL_BLOCKERS.get(row.id);
    const status = blocker ? "BLOCKED_EXTERNAL" : IN_PROGRESS.has(row.id) ? "IN_PROGRESS" : "NOT_STARTED";
    return {
      id: row.id,
      brick: row.brick,
      family: row.family,
      roles: row.roles,
      scenario: row.scenario,
      exact_sha: commitSha,
      status,
      blockers: blocker ? [blocker] : [],
      current_task: status === "IN_PROGRESS" ? "Protected exact-stage build/start/migration/health verification" : null,
      missing_acceptance: [...ACCEPTANCE],
      evidence: { current_sha: [] },
      historical: {
        status: row.status,
        original_source_sha: originalSourceSha,
        is_current_candidate_evidence: false,
        disposition: "HISTORICAL_SCOPED_ONLY_NOT_RELEASE_CERTIFICATION"
      }
    };
  });
  const counts = {
    total: scenarios.length,
    full_verified: scenarios.filter(row => row.status === "FULLY_VERIFIED").length,
    in_progress: scenarios.filter(row => row.status === "IN_PROGRESS").length,
    blocked_external_known: scenarios.filter(row => row.status === "BLOCKED_EXTERNAL").length,
    failed: scenarios.filter(row => row.status === "FAILED").length,
    not_started: scenarios.filter(row => row.status === "NOT_STARTED").length
  };
  assert.equal(counts.full_verified + counts.in_progress + counts.blocked_external_known + counts.failed + counts.not_started, 218);
  const scoped_test_progress = reconcilePriorTestExecution({ prior: priorTestEvidence, frozenScenarios: scenarios, commitSha });
  const legacy_216_scope = reconcileLegacy216ScopedEvidence({
    legacy: legacy216Evidence, scenarios, prior: priorTestEvidence
  });
  const required_gates = Object.fromEntries(RELEASE_GATES.map(gate => [gate, "NOT_VERIFIED"]));
  return {
    report_type: "CURRENT_FINAL_RELEASE_CANDIDATE_218_EVIDENCE_LEDGER",
    generated_at: generatedAt,
    exact_sha: commitSha,
    frozen_fingerprint_sha256: digest,
    frozen_bricks: 37,
    counts,
    ...(scoped_test_progress ? { scoped_test_progress } : {}),
    ...(legacy_216_scope ? { legacy_216_scope } : {}),
    release: {
      decision: "NO_GO",
      required_gates,
      pentest: "INCOMPLETE",
      known_blockers_are_exhaustive: false
    },
    disclaimer: "No current-SHA FULLY_VERIFIED assertions exist. Historical statuses and isolated local tests do not count as release certification.",
    scenarios
  };
}
