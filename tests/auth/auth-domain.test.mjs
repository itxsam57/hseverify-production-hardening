import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_ROLES,
  ROLE_HOME_PATHS,
  ROLE_LOGIN_PATHS,
  createOtpCode,
  createOpaqueToken,
  createTotpCode,
  createTotpSecret,
  createWorkerRegistrationReference,
  decryptSecret,
  encryptSecret,
  hashOpaqueValue,
  hashOtpCode,
  hashPassword,
  isAuthRole,
  maskEmail,
  maskPhone,
  normalizeDisplayName,
  normalizeEmail,
  normalizePhone,
  roleRequiresMfa,
  totpCounter,
  validatePassword,
  verifyOtpCode,
  verifyPassword,
  verifyTotp
} from "../../.auth-test-dist/auth-domain.js";

const PEPPER = "authentication-test-pepper-with-at-least-thirty-two-characters";

test("role registry has isolated login and home routes", () => {
  assert.deepEqual(AUTH_ROLES, [
    "worker",
    "company",
    "assessor",
    "verifier",
    "admin",
    "root"
  ]);
  for (const role of AUTH_ROLES) {
    assert.equal(isAuthRole(role), true);
    assert.match(ROLE_LOGIN_PATHS[role], new RegExp(`^/${role}/login$`));
    assert.match(ROLE_HOME_PATHS[role], new RegExp(`^/${role}/dashboard$`));
  }
  assert.equal(isAuthRole("reviewer"), false);
  assert.equal(roleRequiresMfa("worker"), false);
  for (const role of ["company", "assessor", "verifier", "admin", "root"]) {
    assert.equal(roleRequiresMfa(role), true);
  }
});

test("registration identifiers and input normalization are deterministic", () => {
  assert.equal(normalizeEmail("  Person@Example.COM "), "person@example.com");
  assert.equal(normalizePhone("+92 300-1234567"), "+923001234567");
  assert.equal(normalizeDisplayName("  Example   Worker "), "Example Worker");
  assert.equal(
    createWorkerRegistrationReference("acct_test_identifier"),
    createWorkerRegistrationReference("acct_test_identifier")
  );
  assert.match(
    createWorkerRegistrationReference("acct_test_identifier"),
    /^HSE-REG-[A-F0-9]{12}$/
  );
  assert.throws(() => normalizeEmail("invalid"), /valid email/i);
  assert.throws(() => normalizePhone("03001234567"), /international format/i);
});

test("password hashes are salted, strong and timing-safe to verify", async () => {
  const password = "Correct-Horse-9!Battery";
  validatePassword(password);
  const first = await hashPassword(password, PEPPER);
  const second = await hashPassword(password, PEPPER);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first, PEPPER), true);
  assert.equal(await verifyPassword("Wrong-Horse-9!Battery", first, PEPPER), false);
  assert.equal(await verifyPassword(password, `${first}broken`, PEPPER), false);
  assert.throws(() => validatePassword("weak-password"), /uppercase|number|symbol/i);
});

test("OTP hashes bind code, destination and challenge and reject malformed codes", () => {
  const challengeId = "otp_test_challenge";
  const destinationHash = hashOpaqueValue(
    "person@example.com",
    PEPPER,
    "otp-destination"
  );
  const code = createOtpCode();
  assert.match(code, /^\d{6}$/);
  const expectedHash = hashOtpCode({
    challengeId,
    code,
    destinationHash,
    pepper: PEPPER
  });
  assert.equal(
    verifyOtpCode({
      challengeId,
      code,
      destinationHash,
      pepper: PEPPER,
      expectedHash
    }),
    true
  );
  assert.equal(
    verifyOtpCode({
      challengeId: "different",
      code,
      destinationHash,
      pepper: PEPPER,
      expectedHash
    }),
    false
  );
  assert.equal(
    verifyOtpCode({
      challengeId,
      code: "12345",
      destinationHash,
      pepper: PEPPER,
      expectedHash
    }),
    false
  );
  assert.match(maskEmail("person@example.com"), /^p\*+@example\.com$/);
  assert.match(maskPhone("+923001234567"), /^\+92\*+4567$/);
});

test("opaque tokens have sufficient entropy and context-separated hashes", () => {
  const token = createOpaqueToken();
  assert.ok(token.length >= 43);
  assert.notEqual(
    hashOpaqueValue(token, PEPPER, "session"),
    hashOpaqueValue(token, PEPPER, "invitation")
  );
  assert.throws(() => createOpaqueToken(8), /outside the permitted range/i);
});

test("TOTP accepts a fresh counter once and rejects replay", () => {
  const secret = createTotpSecret();
  assert.match(secret, /^[A-Z2-7]+$/);
  const now = new Date("2026-08-02T12:00:00.000Z");
  const counter = totpCounter(now);
  const code = createTotpCode(secret, counter);
  const accepted = verifyTotp({ secret, code, now, lastAcceptedCounter: null });
  assert.deepEqual(accepted, { valid: true, counter });
  assert.deepEqual(
    verifyTotp({ secret, code, now, lastAcceptedCounter: counter }),
    { valid: false, counter: null }
  );
  assert.deepEqual(verifyTotp({ secret, code: "00000x", now }), {
    valid: false,
    counter: null
  });
});

test("MFA secrets use authenticated encryption and reject tampering", () => {
  const plaintext = "JBSWY3DPEHPK3PXP";
  const encrypted = encryptSecret(plaintext, PEPPER);
  assert.notEqual(encrypted, plaintext);
  assert.equal(decryptSecret(encrypted, PEPPER), plaintext);

  const [version, iv, tag, ciphertextText] = encrypted.split(".");
  const ciphertext = Buffer.from(ciphertextText, "base64url");
  ciphertext[0] ^= 0x01;
  const tampered = [version, iv, tag, ciphertext.toString("base64url")].join(".");
  assert.throws(() => decryptSecret(tampered, PEPPER));
});
