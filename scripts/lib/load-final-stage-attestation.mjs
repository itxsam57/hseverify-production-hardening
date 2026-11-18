import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Release certifications arrive as detached owner-signed files AFTER the
 * immutable final candidate SHA exists. They must never be checked into the
 * same source commit or synthesized from historical CI status.
 */
export function loadOptionalFinalStageAttestation() {
  const evidencePath = process.env.HSE_SIGNED_PROTECTED_STAGE_ATTESTATION_PATH;
  const keyPath = process.env.HSE_TRUSTED_OWNER_RELEASE_PUBLIC_KEY_PATH;
  if (!evidencePath && !keyPath) return {};
  assert(evidencePath && keyPath,
    "Both protected-stage certificate and trusted Owner release public key must be provided");
  const register = readFileSync(resolve(
    "docs/qa/evidence/MASTERPLAN_218_4975_DEDUP_PROGRESS_20261114.csv"
  ), "utf8").trimEnd().split(/\r?\n/);
  assert(register[0].startsWith("check_id,category,"), "Original frozen check register header changed");
  const checkIds = register.slice(1).map(line => line.slice(0, line.indexOf(",")));
  const validPlannedCheckIds = new Set(checkIds);
  assert(checkIds.length === 4975 && validPlannedCheckIds.size === 4975,
    "Signed release certificate requires all 4975 original unique check IDs");
  return {
    finalStageAttestation: JSON.parse(readFileSync(resolve(evidencePath), "utf8")),
    finalStagePublicKey: readFileSync(resolve(keyPath), "utf8"),
    validPlannedCheckIds
  };
}
