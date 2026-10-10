import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { credentialDecisionFixture } from "../helpers/credential-decision-fixture.mjs";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";

const require = createRequire(import.meta.url);
const NOW = new Date("2026-10-10T00:00:00.000Z");
const FINGERPRINT = "a".repeat(64);

function pdfText(bytes) {
  const parsed = spawnSync("pdftotext", ["-", "-"], { input: Buffer.from(bytes), encoding: "utf8" });
  assert.equal(parsed.status, 0, parsed.stderr);
  return parsed.stdout;
}

function actualPdfRoute(fixture, signingSecrets = [fixture.signingSecret]) {
  const { PublicVerificationRepository } = loadTs("src/lib/public-verification/public-verification-repository.ts");
  const { PublicVerificationService } = loadTs("src/lib/public-verification/public-verification-service.ts");
  const service = new PublicVerificationService(
    new PublicVerificationRepository(fixture.database), fixture.environment.sessionSecret, signingSecrets
  );
  // Only inject the disposable database/clock. Every request uses the real public
  // lookup, capability, current database projection and credential authentication.
  const resolvePublicCredentialRequest = async (credentialId) => {
    const lookup = await service.lookupPublicVerification({
      rawIdentifier: credentialId, requestFingerprint: FINGERPRINT, now: NOW
    });
    return lookup.kind === "redirect"
      ? service.resolvePublicVerificationCapability({
          publicToken: lookup.publicToken, requestFingerprint: FINGERPRINT, now: NOW
        })
      : lookup;
  };
  const source = ts.transpileModule(
    readFileSync("src/app/api/credentials/[credentialId]/pdf/route.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  const record = { exports: {} };
  const routeRequire = (specifier) => specifier === "@/lib/public-verification/public-verification-runtime"
    ? { resolvePublicCredentialRequest }
    : specifier.startsWith("@/") ? loadTs("src/" + specifier.slice(2) + ".ts") : require(specifier);
  new Function("exports", "require", "module", source)(record.exports, routeRequire, record);
  return (credentialId) => record.exports.GET(
    new Request("https://example.test/api/credentials/" + credentialId + "/pdf"),
    { params: Promise.resolve({ credentialId }) }
  );
}

async function issuedCredential(fixture) {
  await fixture.repo.saveDecisionAndProgressCase(fixture.decision, "admin_validity");
  const id = (await fixture.database.query(
    "SELECT credential_reference FROM assurance_cases WHERE case_id=$1", [fixture.caseId]
  )).rows[0].credential_reference;
  const { CredentialIssuanceRepository } = loadTs("src/lib/credential/credential-issuance-repository.ts");
  const credential = await new CredentialIssuanceRepository(Promise.resolve(fixture.database)).findPublic(id);
  const { credentialAuthentication } = loadTs("src/lib/credential/credential-issuance-domain.ts");
  assert.equal(credentialAuthentication(credential, fixture.signingSecret), "authenticated");
  return credential;
}

test("Genuine signed Unicode issuance survives the current public PDF consumer with dates and live status", async () => {
  const fixture = await credentialDecisionFixture({ qualification: "José Müller Иван 安全" });
  try {
    const credential = await issuedCredential(fixture);
    assert.equal(credential.qualification, "José Müller Иван 安全");
    const request = actualPdfRoute(fixture);
    const response = await request(credential.credentialId);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.match(bytes.subarray(0,8).toString(), /^%PDF-/);
    const parsed = pdfText(bytes);
    assert.match(parsed, /Qualification: José Müller Иван/u, "Actual issued qualification is corrupted in parsed public PDF: " + parsed);
    assert.match(parsed, /U\+5B89/);
    assert.match(parsed, /U\+5168/);
    assert.match(parsed, /Unsupported characters/);
    assert(parsed.replace(/\s+/g, " ").includes("The public verification page retains the original text."));
    assert(!parsed.includes("CSV and print exports"));
    assert(!parsed.includes("Requested at:"));
    assert(parsed.includes("Credential: " + credential.credentialId));
    assert(parsed.includes("Issue: " + credential.issuedAt));
    assert(parsed.includes("Expiry: " + credential.expiresAt));
    assert(parsed.includes("Status: valid"));
    assert(parsed.includes("Verification: /verify/result/" + credential.credentialId));

    const { CredentialIssuanceRepository } = loadTs("src/lib/credential/credential-issuance-repository.ts");
    const credentials = new CredentialIssuanceRepository(Promise.resolve(fixture.database));
    const updated = await credentials.updateStatus(credential.credentialId, "suspended", 1, "valid");
    assert.equal(updated?.credentialId, credential.credentialId);
    assert.equal(updated?.status, "suspended");
    assert.equal(updated?.version, 2);
    const suspended = await request(credential.credentialId);
    assert.equal(suspended.status, 200);
    const livePdf = pdfText(await suspended.arrayBuffer());
    assert(livePdf.includes("Status: suspended"));
    const retained = await credentials.findPublic(credential.credentialId);
    for (const field of ["qualification", "issuedAt", "expiresAt", "qrPayload", "signature"]) {
      assert.equal(retained[field], credential[field]);
    }
  } finally {
    await fixture.database.close();
  }
});

test("Public PDF keeps real signature trust, neutral missing responses and temporary database failure", async () => {
  const fixture = await credentialDecisionFixture();
  let closed = false;
  try {
    const credential = await issuedCredential(fixture);
    const untrusted = await actualPdfRoute(fixture, [fixture.signingSecret + "-untrusted"])(credential.credentialId);
    assert.equal(untrusted.status, 404);
    assert.equal(await untrusted.text(), "not_found_or_invalid");
    const request = actualPdfRoute(fixture);
    const absent = await request("credential_" + "f".repeat(24));
    assert.equal(absent.status, 404);
    assert.equal(await absent.text(), "not_found_or_invalid");
    await fixture.database.close();
    closed = true;
    const unavailable = await request(credential.credentialId);
    assert.equal(unavailable.status, 503);
    assert.equal(await unavailable.text(), "temporarily_unavailable");
  } finally {
    if (!closed) await fixture.database.close();
  }
});
