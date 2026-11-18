import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";

export const ACCEPTANCE_GATE_IDS = Object.freeze([
  "ui", "behavior", "roles_db", "api_abuse", "pentest", "providers_ops_owner"
]);
export const RELEASE_GATE_IDS = Object.freeze([
  "single_final_stage_sha_and_configuration",
  "all_218_complete_cross_role_flows",
  "complete_authenticated_ui_api_pentest",
  "real_provider_delivery_and_outage",
  "realistic_load_and_restoration",
  "incident_alert_and_rollback",
  "accessibility_and_responsive",
  "owner_uat_signoff"
]);
const MANDATORY_STAGE_GATES = RELEASE_GATE_IDS.filter(gate =>
  gate !== "all_218_complete_cross_role_flows" && gate !== "owner_uat_signoff"
);
const HEX64 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;
const PROJECT_RECEIPT_URL = /^https:\/\/github\.com\/itxsam57\/hseverify-production-hardening\/(actions\/runs\/\d+|blob\/[^\s]+|releases\/tag\/[^\s]+)$/;

/**
 * Only a detached Ed25519 signature from the owner's configured trusted
 * release authority can promote a full scenario. No public key is bundled:
 * ordinary branch CI / local JSON files are incapable of self-certification.
 * The authority is responsible for checking that signed receipt digests match
 * real protected-stage raw evidence, live providers and independent review.
 */
export function verifyFinalStageAttestation({
  envelope, trustedPublicKey, candidateSha, validCheckIds, scenarioIds
}) {
  assert(envelope && typeof envelope === "object", "Final stage certificate missing");
  assert(typeof trustedPublicKey === "string" && trustedPublicKey.includes("BEGIN PUBLIC KEY"),
    "A trusted external release public key is required");
  const key = createPublicKey(trustedPublicKey);
  assert.equal(key.asymmetricKeyType, "ed25519", "Only Ed25519 owner release keys are accepted");
  assert(typeof envelope.signature_base64 === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(envelope.signature_base64),
    "Invalid release signature encoding");
  const signature = Buffer.from(envelope.signature_base64, "base64");
  assert.equal(signature.byteLength, 64, "Invalid release signature length");
  assert(verify(null, Buffer.from(JSON.stringify(envelope.payload)), key, signature),
    "Invalid owner release signature");
  const p = envelope.payload;
  assert(p && p.schema_version === 1, "Unsupported signed release schema");
  assert(SHA40.test(p.candidate_sha ?? "") && p.candidate_sha === candidateSha,
    "Signed release candidate SHA mismatch");
  assert(typeof p.stage_name === "string" && p.stage_name.startsWith("HSE-") &&
    p.stage_name.length >= 8, "Protected final staging identity is mandatory");
  assert(HEX64.test(p.stage_config_digest ?? ""), "Missing signed protected-stage configuration digest");
  assert(typeof p.reviewed_by === "string" && p.reviewed_by.length >= 10,
    "Independent security and Owner review identities are mandatory");
  assert(p.pentest === "COMPLETE" && p.high_critical_open === 0,
    "Full pentest must be complete with no open high or critical finding");
  assert(p.gates && typeof p.gates === "object", "Signed release gates required");
  assert.deepEqual(Object.keys(p.gates).sort(), [...RELEASE_GATE_IDS].sort(),
    "Every frozen release gate must be represented");
  for (const value of Object.values(p.gates)) {
    assert(value === "PASS" || value === "NOT_VERIFIED", "Unknown signed release gate status");
  }
  for (const gate of MANDATORY_STAGE_GATES) {
    assert.equal(p.gates[gate], "PASS", "Incomplete protected-stage requirement: " + gate);
  }
  assert(validCheckIds instanceof Set && validCheckIds.size > 0,
    "Canonical 4,975 planned check identifiers are required");
  assert(scenarioIds instanceof Set && scenarioIds.size === 218,
    "Canonical 218 frozen IDs are required");
  assert(Array.isArray(p.certified_check_ids), "Signed planned check evidence required");
  const certified = new Set(p.certified_check_ids);
  assert.equal(certified.size, p.certified_check_ids.length, "Duplicate certified planned check");
  for (const id of certified) {
    assert(validCheckIds.has(id), "Unknown certified planned check: " + id);
  }
  assert(Array.isArray(p.scenarios), "Signed scenario evidence is required");
  const verified = new Map();
  for (const entry of p.scenarios) {
    assert(entry && scenarioIds.has(entry.id) && !verified.has(entry.id),
      "Unknown or duplicate scenario in signed evidence");
    assert.equal(entry.owner_uat_approved, true, "Owner UAT must approve every promoted scenario");
    assert.equal(entry.independent_security_reviewer_approved, true,
      "Independent security review must approve every promoted scenario");
    assert(Array.isArray(entry.evidence) && entry.evidence.length === ACCEPTANCE_GATE_IDS.length,
      "All six acceptance evidence dimensions are mandatory");
    const named = new Set();
    for (const proof of entry.evidence) {
      assert(proof && ACCEPTANCE_GATE_IDS.includes(proof.gate) && !named.has(proof.gate),
        "Duplicate or unknown scenario acceptance gate");
      named.add(proof.gate);
      assert.equal(proof.sha, candidateSha, "Receipt candidate SHA mismatch");
      assert.equal(proof.protected_stage, p.stage_name, "Receipt final-stage identity mismatch");
      assert(HEX64.test(proof.receipt_sha256 ?? ""), "Missing real raw receipt SHA256");
      assert(PROJECT_RECEIPT_URL.test(proof.receipt_url ?? ""), "Unsupported receipt provenance URL");
    }
    // All twelve frozen scenario-dimension checks must be certified as well;
    // candidate security/responsive checks are counted separately by ID.
    for (let index = 1; index <= 12; index++) {
      const checkId = `SCENARIO:${entry.id}:${String(index).padStart(2, "0")}`;
      assert(certified.has(checkId), "Missing exact final-stage scenario planned check: " + checkId);
    }
    verified.set(entry.id, entry.evidence);
  }
  return {
    verified, certified,
    gates: p.gates, pentest: p.pentest,
    openSevere: p.high_critical_open,
    stageName: p.stage_name
  };
}
