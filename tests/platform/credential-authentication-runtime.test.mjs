import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";
import { openScriptDatabase } from "../../scripts/lib/database.mjs";
import { applyMigrationsThrough } from "../helpers/migration-ceiling.mjs";

const ENV = {
  appEnvironment: "test",
  databaseDriver: "pglite",
  databaseUrl: null,
  pgliteDataDir: "memory://",
  releaseSha: "credential-authentication-runtime",
  sessionSecret: "credential-authentication-test-session-secret-more-than-32",
  credentialSigningSecret: "credential-authentication-persisted-signing-key-more-than-32",
  authPepper: "credential-authentication-test-auth-pepper-more-than-32",
  authSandboxEnabled: false,
  authSandboxAccessKey: null,
  demoAuthEnabled: false,
  demoDataEnabled: false
};
const NOW = new Date("2026-10-08T12:00:00.000Z");
const FINGERPRINT = "a".repeat(64);
const { credentialAuthentication, credentialQrPayload, issueCredential, verifyCredentialSignature } = loadTs("src/lib/credential/credential-issuance-domain.ts");
const { CredentialIssuanceRepository } = loadTs("src/lib/credential/credential-issuance-repository.ts");
const { CredentialIssuanceService } = loadTs("src/lib/credential/credential-issuance-service.ts");
const { PublicVerificationRepository } = loadTs("src/lib/public-verification/public-verification-repository.ts");
const { PublicVerificationService } = loadTs("src/lib/public-verification/public-verification-service.ts");

test("public verification authenticates the persisted issuer payload and rejects tampered qualification", async () => {
  const database = await openScriptDatabase(ENV);
  try {
    await applyMigrationsThrough(database, ENV.releaseSha, "0067_assessment_review_orchestration");
    const repository = new CredentialIssuanceRepository(Promise.resolve(database));
    const credential = await new CredentialIssuanceService(repository, ENV.credentialSigningSecret).issue({
      workerId: "worker_id_" + "w".repeat(24),
      qualification: "Operational Safety",
      issuedAt: "2026-10-01T00:00:00.000Z",
      expiresAt: "2027-10-01T00:00:00.000Z"
    }, "authentication_runtime");
    const verifier = new PublicVerificationService(new PublicVerificationRepository(database), ENV.sessionSecret, [ENV.credentialSigningSecret]);
    const lookup = () => verifier.lookupPublicVerification({
      rawIdentifier: credential.credentialId, requestFingerprint: FINGERPRINT, now: NOW
    });
    const valid = await lookup();
    assert.equal(valid.kind, "redirect");
    const projection = await verifier.resolvePublicVerificationCapability({
      publicToken: valid.publicToken, requestFingerprint: FINGERPRINT, now: NOW
    });
    assert.equal(projection.kind, "projection");
    assert.equal(projection.projection.competencyTitle, "Operational Safety");
    assert.equal(JSON.stringify(projection).includes(credential.workerId), false);
    assert.equal(JSON.stringify(projection).includes(credential.signature), false);
    assert.equal(credentialAuthentication(await repository.findPublic(credential.credentialId), ENV.credentialSigningSecret), "authenticated");
    await database.query("UPDATE credential_issuances SET qualification=$2 WHERE credential_id=$1", [
      credential.credentialId, "Forged higher qualification"
    ]);
    assert.deepEqual(await lookup(), { kind: "status", status: "not_found_or_invalid" });
    assert.deepEqual(await verifier.resolvePublicVerificationCapability({
      publicToken: valid.publicToken, requestFingerprint: FINGERPRINT, now: NOW
    }), { kind: "status", status: "not_found_or_invalid" });
  } finally {
    await database.close();
  }
});


test("signed issuance binds identity, qualification, dates, URLs and metadata; public hashes cannot forge it", () => {
  const original = issueCredential({
    workerId: "worker_id_" + "w".repeat(24), qualification: "Operational Safety",
    issuedAt: "2026-10-01T02:00:00+02:00", expiresAt: "2027-10-01T02:00:00+02:00"
  }, "signed_contract", ENV.credentialSigningSecret);
  assert.equal(credentialAuthentication(original, ENV.credentialSigningSecret), "authenticated");
  assert.equal(verifyCredentialSignature(original, ENV.credentialSigningSecret), true);
  assert.equal(credentialAuthentication(original, "a-different-trusted-server-secret-more-than-32"), "unknown_key");
  assert.equal(verifyCredentialSignature(original, "a-different-trusted-server-secret-more-than-32"), false);
  const metadata = JSON.parse(original.qrPayload).signing;
  assert.equal(metadata.version, 1);
  assert.equal(metadata.algorithm, "HMAC-SHA256");
  assert.match(metadata.keyId, /^[a-f0-9]{32}$/);
  assert.equal(original.qrPayload.includes(ENV.sessionSecret), false);
  for (const change of [
    { credentialId: "credential_id_forged" }, { workerId: "worker_id_" + "f".repeat(24) },
    { qualification: "Forged safety qualification" }, { issuedAt: "2026-09-01T00:00:00.000Z" },
    { expiresAt: null }, { expiresAt: "2036-10-01T00:00:00.000Z" },
    { publicStatusUrl: "/verify/result/credential_id_forged" }, { pdfUrl: "/api/credentials/credential_id_forged/pdf" },
    { qrPayload: "{}" }, { signature: "" }, { signature: "0".repeat(64) },
    { signature: createHash("sha256").update(`${original.credentialId}:${original.qrPayload}`).digest("hex") }
  ]) assert.equal(credentialAuthentication({ ...original, ...change }, ENV.credentialSigningSecret), "invalid", JSON.stringify(change));
  for (const signing of [null, {}, { ...metadata, algorithm: "SHA-256" }, { ...metadata, version: 2 }]) {
    const qrPayload = JSON.stringify({ ...JSON.parse(original.qrPayload), signing });
    assert.equal(credentialAuthentication({ ...original, qrPayload }, ENV.credentialSigningSecret), "invalid");
  }
  assert.throws(() => issueCredential({
    workerId: "worker", qualification: "Safety", issuedAt: "2026-10-01T00:00:00Z", expiresAt: null
  }, "missing_key"), /signing secret/i);
});

test("public verification reads live lifecycle while preserving the authenticated issuance and rotation boundary", async () => {
  const database = await openScriptDatabase(ENV);
  try {
    await applyMigrationsThrough(database, ENV.releaseSha, "0067_assessment_review_orchestration");
    const credentials = new CredentialIssuanceRepository(Promise.resolve(database));
    const issued = await new CredentialIssuanceService(credentials, ENV.credentialSigningSecret).issue({
      workerId: "worker_id_" + "s".repeat(24), qualification: "Signed lifecycle Safety",
      issuedAt: "2026-10-01T00:00:00Z", expiresAt: "2026-10-08T12:00:00Z"
    }, "signed_lifecycle");
    const publicRepository = new PublicVerificationRepository(database);
    const verifier = new PublicVerificationService(publicRepository, ENV.sessionSecret, [ENV.credentialSigningSecret]);
    const lookup = await verifier.lookupPublicVerification({ rawIdentifier: issued.credentialId, requestFingerprint: FINGERPRINT, now: NOW });
    assert.equal(lookup.kind, "redirect");
    const resolve = () => verifier.resolvePublicVerificationCapability({ publicToken: lookup.publicToken, requestFingerprint: FINGERPRINT, now: NOW });
    assert.equal((await resolve()).projection.status, "expired");
    await credentials.updateStatus(issued.credentialId, "suspended", 1, "valid");
    const current = await credentials.findPublic(issued.credentialId);
    assert.equal(current.signature, issued.signature);
    assert.equal(current.qrPayload, issued.qrPayload);
    assert.equal(credentialAuthentication(current, ENV.credentialSigningSecret), "authenticated");
    assert.equal((await resolve()).projection.status, "suspended");
    const rotated = new PublicVerificationService(publicRepository, ENV.sessionSecret, ["rotated-credential-key-for-test-more-than-32"]);
    assert.deepEqual(await rotated.lookupPublicVerification({ rawIdentifier: issued.credentialId, requestFingerprint: FINGERPRINT, now: NOW }),
      { kind: "status", status: "not_found_or_invalid" });
    assert.equal((await resolve()).projection.status, "suspended");
    await database.query("UPDATE credential_issuances SET expires_at=NULL WHERE credential_id=$1", [issued.credentialId]);
    assert.deepEqual(await resolve(), { kind: "status", status: "not_found_or_invalid" });
  } finally { await database.close(); }
});

test("historical checksums retain live status and history without claiming authenticated issuance", async () => {
  const database = await openScriptDatabase(ENV);
  try {
    await applyMigrationsThrough(database, ENV.releaseSha, "0067_assessment_review_orchestration");
    const credentials = new CredentialIssuanceRepository(Promise.resolve(database));
    const current = issueCredential({
      workerId: "worker_id_" + "l".repeat(24), qualification: "Historical Safety",
      issuedAt: "2026-01-01T00:00:00Z", expiresAt: null
    }, "legacy_history", ENV.credentialSigningSecret);
    const qrPayload = credentialQrPayload(current.credentialId, current.publicStatusUrl);
    const legacy = { ...current, qrPayload, signature: createHash("sha256").update(`${current.credentialId}:${qrPayload}`).digest("hex") };
    await credentials.save(legacy);
    assert.equal(credentialAuthentication(await credentials.findPublic(legacy.credentialId), ENV.credentialSigningSecret), "legacy_unverified");
    assert.equal(verifyCredentialSignature(legacy, ENV.credentialSigningSecret), false);
    const verifier = new PublicVerificationService(new PublicVerificationRepository(database), ENV.sessionSecret, [ENV.credentialSigningSecret]);
    const lookup = await verifier.lookupPublicVerification({ rawIdentifier: legacy.credentialId, requestFingerprint: FINGERPRINT, now: NOW });
    assert.equal(lookup.kind, "redirect");
    await credentials.updateStatus(legacy.credentialId, "revoked", 1, "valid");
    const resolved = await verifier.resolvePublicVerificationCapability({ publicToken: lookup.publicToken, requestFingerprint: FINGERPRINT, now: NOW });
    assert.equal(resolved.kind, "projection");
    assert.equal(resolved.projection.status, "revoked");
    assert.ok(resolved.projection.restrictions.some(value => /unauthenticated checksum/.test(value)));
    assert.equal((await credentials.findPublic(legacy.credentialId)).signature, legacy.signature);
    const history = await database.query("SELECT status,version FROM credential_lifecycle_events WHERE credential_id=$1 ORDER BY version", [legacy.credentialId]);
    assert.deepEqual(history.rows.map(row => [row.status, Number(row.version)]), [["valid", 1], ["revoked", 2]]);
  } finally { await database.close(); }
});


test("issuer to database to public verification preserves nonzero issue and expiry milliseconds", async () => {
  const database = await openScriptDatabase(ENV);
  try {
    await applyMigrationsThrough(database, ENV.releaseSha, "0067_assessment_review_orchestration");
    const repository = new CredentialIssuanceRepository(Promise.resolve(database));
    const issued = await new CredentialIssuanceService(repository, ENV.credentialSigningSecret).issue({
      workerId: "worker_id_" + "m".repeat(24), qualification: "Millisecond Safety",
      issuedAt: "2026-10-01T00:00:00.127Z", expiresAt: "2027-10-01T00:00:00.459Z"
    }, "millisecond_roundtrip");
    const verifier = new PublicVerificationService(new PublicVerificationRepository(database), ENV.sessionSecret, [ENV.credentialSigningSecret]);
    const lookup = await verifier.lookupPublicVerification({ rawIdentifier: issued.credentialId, requestFingerprint: FINGERPRINT, now: NOW });
    assert.equal(lookup.kind, "redirect", "Authentic stored issuance must remain publicly verifiable");
    const resolved = await verifier.resolvePublicVerificationCapability({ publicToken: lookup.publicToken, requestFingerprint: FINGERPRINT, now: NOW });
    assert.equal(resolved.kind, "projection");
    assert.equal(resolved.projection.issuedAt, issued.issuedAt);
    assert.equal(resolved.projection.expiresAt, issued.expiresAt);
    const stored = await repository.findPublic(issued.credentialId);
    assert.equal(stored.issuedAt, issued.issuedAt);
    assert.equal(stored.expiresAt, issued.expiresAt);
    assert.equal(credentialAuthentication(stored, ENV.credentialSigningSecret), "authenticated");
  } finally { await database.close(); }
});


test("session rotation preserves issuance verification under a stable credential signing key", async () => {
  const database = await openScriptDatabase(ENV);
  try {
    await applyMigrationsThrough(database, ENV.releaseSha, "0067_assessment_review_orchestration");
    const key = "dedicated-credential-test-signing-key-persisted-at-least-32";
    const credentials = new CredentialIssuanceRepository(Promise.resolve(database));
    const issued = await new CredentialIssuanceService(credentials, key).issue({
      workerId: "worker_id_" + "k".repeat(24), qualification: "Stable signed Safety",
      issuedAt: "2026-10-01T00:00:00.127Z", expiresAt: "2027-10-01T00:00:00.459Z"
    }, "session_rotation");
    for (const session of [ENV.sessionSecret, "rotated-session-test-secret-with-more-than-32-characters"]) {
      const verifier = new PublicVerificationService(new PublicVerificationRepository(database), session, [key]);
      const lookup = await verifier.lookupPublicVerification({ rawIdentifier: issued.credentialId, requestFingerprint: FINGERPRINT, now: NOW });
      assert.equal(lookup.kind, "redirect");
      const resolved = await verifier.resolvePublicVerificationCapability({ publicToken: lookup.publicToken, requestFingerprint: FINGERPRINT, now: NOW });
      assert.equal(resolved.kind, "projection");
      assert.equal(resolved.projection.competencyTitle, issued.qualification);
      assert.equal(resolved.projection.issuedAt, issued.issuedAt);
    }
  } finally { await database.close(); }
});

test("credential key rotation verifies retained historical keys and fails closed after key removal", async () => {
  const database = await openScriptDatabase(ENV);
  try {
    await applyMigrationsThrough(database, ENV.releaseSha, "0067_assessment_review_orchestration");
    const oldKey = "historical-credential-key-retained-for-verification-at-least-32";
    const newKey = "current-credential-key-for-new-issuance-at-least-32";
    const credentials = new CredentialIssuanceRepository(Promise.resolve(database));
    const request = { workerId: "worker_id_" + "h".repeat(24), qualification: "Rotated Safety",
      issuedAt: "2026-10-01T00:00:00.127Z", expiresAt: "2027-10-01T00:00:00.459Z" };
    const historical = await new CredentialIssuanceService(credentials, oldKey).issue(request, "old_key_rotation");
    const current = await new CredentialIssuanceService(credentials, newKey).issue(request, "new_key_rotation");
    const publicRepository = new PublicVerificationRepository(database);
    const lookup = (verifier, credentialId) => verifier.lookupPublicVerification({ rawIdentifier: credentialId, requestFingerprint: FINGERPRINT, now: NOW });
    const retained = new PublicVerificationService(publicRepository, ENV.sessionSecret, [newKey, oldKey]);
    assert.equal((await lookup(retained, historical.credentialId)).kind, "redirect");
    assert.equal((await lookup(retained, current.credentialId)).kind, "redirect");
    const removed = new PublicVerificationService(publicRepository, ENV.sessionSecret, [newKey]);
    assert.deepEqual(await lookup(removed, historical.credentialId), { kind: "status", status: "not_found_or_invalid" });
    assert.equal((await lookup(removed, current.credentialId)).kind, "redirect");
    assert.equal((await credentials.findPublic(historical.credentialId)).signature, historical.signature);
    assert.equal(credentialAuthentication(await credentials.findPublic(historical.credentialId), [newKey, oldKey]), "authenticated");
    assert.equal(credentialAuthentication(await credentials.findPublic(historical.credentialId), [newKey]), "unknown_key");
  } finally { await database.close(); }
});
