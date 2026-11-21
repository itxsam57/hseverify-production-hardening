import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCurrentReleaseLedger } from "../lib/current-release-218-ledger.mjs";

const source = JSON.parse(readFileSync("docs/qa/2026-10-02-evidence.json", "utf8"));
const sha = "b54421302fe7000c0284864b92cbff258c2903a0";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const ownerKey = publicKey.export({ type: "spki", format: "pem" });
const receipt = (gate) => ({
  gate,
  sha,
  protected_stage: "HSE-QA-PROTECTED",
  receipt_sha256: "f".repeat(64),
  receipt_url: "https://github.com/itxsam57/hseverify-production-hardening/actions/runs/12345"
});
const firstTwelve = Array.from({length: 12}, (_, index) =>
  `SCENARIO:M1.01.01:${String(index + 1).padStart(2, "0")}`);
const stage = {
  schema_version: 1,
  candidate_sha: sha,
  stage_name: "HSE-QA-PROTECTED",
  stage_config_digest: "a".repeat(64),
  reviewed_by: "Independent QA + Owner UAT",
  gates: {
    single_final_stage_sha_and_configuration: "PASS",
    all_218_complete_cross_role_flows: "NOT_VERIFIED",
    complete_authenticated_ui_api_pentest: "PASS",
    real_provider_delivery_and_outage: "PASS",
    realistic_load_and_restoration: "PASS",
    incident_alert_and_rollback: "PASS",
    accessibility_and_responsive: "PASS",
    owner_uat_signoff: "NOT_VERIFIED"
  },
  pentest: "COMPLETE",
  high_critical_open: 0,
  certified_check_ids: firstTwelve,
  scenarios: [{
    id: "M1.01.01",
    owner_uat_approved: true,
    independent_security_reviewer_approved: true,
    evidence: ["ui", "behavior", "roles_db", "api_abuse", "pentest", "providers_ops_owner"].map(receipt)
  }]
};
function envelope(payload) {
  return { payload, signature_base64: sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString("base64") };
}
function build(input, key = ownerKey, checks = new Set(firstTwelve)) {
  return buildCurrentReleaseLedger({
    source, commitSha: sha,
    finalStageAttestation: input,
    finalStagePublicKey: key,
    validPlannedCheckIds: checks
  });
}
test("independently signed protected-stage proof promotes only its complete exact-SHA scenario, never release GO", () => {
  const report = build(envelope(stage));
  assert.equal(report.counts.full_verified, 1);
  assert.equal(report.scenarios.find(s => s.id === "M1.01.01").status, "FULLY_VERIFIED");
  assert.equal(report.scenarios.find(s => s.id === "M1.01.02").status, "NOT_STARTED");
  assert.equal(report.release.decision, "NO_GO");
  assert.equal(report.release.pentest, "COMPLETE");
});

test("missing external trusted key, tampered signature, wrong SHA and forged planned check IDs fail closed", () => {
  const signed = envelope(stage);
  assert.throws(() => build(signed, null), /public key|trusted/i);
  assert.throws(() => build({ ...signed, signature_base64: "fake" }), /signature/i);
  assert.throws(() => build(envelope({ ...stage, candidate_sha: "0".repeat(40) })), /SHA|candidate/i);
  assert.throws(() => build(envelope({ ...stage, certified_check_ids: ["MADE_UP_CHECK"] })), /planned|check/i);
});
test("missing signed owner UAT, independent security, or any of six proof dimensions cannot be credited", () => {
  const missingOwner = structuredClone(stage);
  missingOwner.scenarios[0].owner_uat_approved = false;
  assert.throws(() => build(envelope(missingOwner)), /Owner|UAT/i);
  const missingSecurity = structuredClone(stage);
  missingSecurity.scenarios[0].independent_security_reviewer_approved = false;
  assert.throws(() => build(envelope(missingSecurity)), /security/i);
  const missingProof = structuredClone(stage);
  missingProof.scenarios[0].evidence.pop();
  assert.throws(() => build(envelope(missingProof)), /six|evidence|criterion|gate/i);
});
