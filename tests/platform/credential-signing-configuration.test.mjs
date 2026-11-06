import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "../../scripts/interview-test-ts-loader.mjs";
import { validateScriptEnvironment } from "../../scripts/lib/environment.mjs";
const { validateRuntimeEnvironment } = loadTs("src/lib/config/environment.ts");
const { credentialSigningKeyId } = loadTs("src/lib/credential/credential-issuance-domain.ts");
const SESSION = "configuration-test-session-secret-at-least-32-characters";
const KEY = "persistent-credential-signing-test-key-at-least-32-characters";
const PREVIOUS = "historical-credential-signing-test-key-at-least-32-characters";
const BASE = { HSE_APP_ENV: "test", HSE_DATABASE_DRIVER: "pglite", HSE_SESSION_SECRET: SESSION };
const PRODUCTION = { ...BASE, HSE_APP_ENV: "production", HSE_DATABASE_DRIVER: "postgres",
  DATABASE_URL: "postgres://configuration-only.invalid/hse", HSE_AUTH_PEPPER: "configuration-production-auth-pepper-at-least-32",
  HSE_RELEASE_SHA: "configuration-validation-only" };

for (const [name, validate] of [["server", validateRuntimeEnvironment], ["script", validateScriptEnvironment]]) {
  test(name + " configuration keeps credential signing independent of session rotation", () => {
    const input = { ...BASE, HSE_CREDENTIAL_SIGNING_SECRET: KEY,
      HSE_CREDENTIAL_SIGNING_PREVIOUS_SECRETS: JSON.stringify([PREVIOUS]) };
    const first = validate(input);
    const rotated = validate({ ...input, HSE_SESSION_SECRET: "rotated-configuration-session-secret-at-least-32" });
    assert.equal(first.credentialSigningSecret, KEY);
    assert.deepEqual(first.credentialSigningPreviousSecrets, [PREVIOUS]);
    assert.equal(rotated.credentialSigningSecret, first.credentialSigningSecret);
    assert.deepEqual(rotated.credentialSigningPreviousSecrets, first.credentialSigningPreviousSecrets);
    assert.equal(validate(BASE).credentialSigningSecret, undefined);
  });
  test(name + " production requires a persistent credential signing key", () => {
    assert.throws(() => validate(PRODUCTION), /HSE_CREDENTIAL_SIGNING_SECRET/i);
    assert.equal(validate({ ...PRODUCTION, HSE_CREDENTIAL_SIGNING_SECRET: KEY }).credentialSigningSecret, KEY);
  });
  test(name + " rejects malformed, short, duplicate and oversized credential keyrings without secret disclosure", () => {
    for (const patch of [
      { HSE_CREDENTIAL_SIGNING_SECRET: "short" },
      { HSE_CREDENTIAL_SIGNING_SECRET: "k".repeat(513) },
      { HSE_CREDENTIAL_SIGNING_PREVIOUS_SECRETS: "not-json" },
      { HSE_CREDENTIAL_SIGNING_PREVIOUS_SECRETS: JSON.stringify({ key: PREVIOUS }) },
      { HSE_CREDENTIAL_SIGNING_PREVIOUS_SECRETS: JSON.stringify(["short"]) },
      { HSE_CREDENTIAL_SIGNING_PREVIOUS_SECRETS: JSON.stringify(["k".repeat(513)]) },
      { HSE_CREDENTIAL_SIGNING_PREVIOUS_SECRETS: JSON.stringify([null]) },
      { HSE_CREDENTIAL_SIGNING_PREVIOUS_SECRETS: JSON.stringify([KEY]) },
      { HSE_CREDENTIAL_SIGNING_PREVIOUS_SECRETS: JSON.stringify([PREVIOUS, PREVIOUS]) },
      { HSE_CREDENTIAL_SIGNING_PREVIOUS_SECRETS: JSON.stringify(Array.from({ length: 9 }, (_, i) => PREVIOUS + i)) },
      { HSE_CREDENTIAL_SIGNING_PREVIOUS_SECRETS: " ".repeat(16385) }
    ]) {
      assert.throws(() => validate({ ...BASE, HSE_CREDENTIAL_SIGNING_SECRET: KEY, ...patch }), error =>
        /HSE_CREDENTIAL_SIGNING/.test(error.message) && !error.message.includes(KEY) && !error.message.includes(PREVIOUS));
    }
    const valid = validate({ ...BASE, HSE_CREDENTIAL_SIGNING_SECRET: KEY,
      HSE_CREDENTIAL_SIGNING_PREVIOUS_SECRETS: JSON.stringify([PREVIOUS]) });
    const ids = [valid.credentialSigningSecret, ...valid.credentialSigningPreviousSecrets].map(credentialSigningKeyId);
    assert.equal(new Set(ids).size, ids.length);
  });
}
