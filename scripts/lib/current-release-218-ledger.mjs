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

export function buildCurrentReleaseLedger({ source, commitSha, generatedAt = new Date().toISOString() }) {
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
  const required_gates = Object.fromEntries(RELEASE_GATES.map(gate => [gate, "NOT_VERIFIED"]));
  return {
    report_type: "CURRENT_FINAL_RELEASE_CANDIDATE_218_EVIDENCE_LEDGER",
    generated_at: generatedAt,
    exact_sha: commitSha,
    frozen_fingerprint_sha256: digest,
    frozen_bricks: 37,
    counts,
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
