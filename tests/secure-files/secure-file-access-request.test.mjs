import assert from "node:assert/strict";
import test from "node:test";

const requestBoundary = await import(
  "../../.secure-access-test-dist/secure-files/secure-file-access-request.js"
);

const MAX_BYTES = 4_096;

function post(body, headers = {}) {
  return new Request("http://hse.test/api/secure-files/access", {
    method: "POST",
    headers,
    body
  });
}

test("bounded signed-access JSON is parsed without trusting Content-Length", async () => {
  const body = JSON.stringify({ fileRef: "secure_file_A", purpose: "preview" });
  const parsed = await requestBoundary.readBoundedSecureFileAccessJson(
    post(body, { "content-length": "1" }),
    MAX_BYTES
  );

  assert.deepEqual(parsed, { fileRef: "secure_file_A", purpose: "preview" });
});

test("declared oversize body is rejected before body consumption", async () => {
  await assert.rejects(
    requestBoundary.readBoundedSecureFileAccessJson(
      post("{}", { "content-length": String(MAX_BYTES + 1) }),
      MAX_BYTES
    ),
    { name: "SecureFileAccessContractError" }
  );
});

test("actual oversize body is rejected even when Content-Length lies low", async () => {
  await assert.rejects(
    requestBoundary.readBoundedSecureFileAccessJson(
      post(`{"padding":"${"A".repeat(MAX_BYTES)}"}`, {
        "content-length": "2"
      }),
      MAX_BYTES
    ),
    { name: "SecureFileAccessContractError" }
  );
});

test("malformed Content-Length is rejected fail closed", async () => {
  await assert.rejects(
    requestBoundary.readBoundedSecureFileAccessJson(
      post("{}", { "content-length": "4kb" }),
      MAX_BYTES
    ),
    { name: "SecureFileAccessContractError" }
  );
});

test("invalid UTF-8 and invalid JSON are rejected at the trusted boundary", async () => {
  await assert.rejects(
    requestBoundary.readBoundedSecureFileAccessJson(
      post(new Uint8Array([0xc3, 0x28])),
      MAX_BYTES
    ),
    { name: "SecureFileAccessContractError" }
  );
  await assert.rejects(
    requestBoundary.readBoundedSecureFileAccessJson(post("not-json"), MAX_BYTES),
    { name: "SecureFileAccessContractError" }
  );
});

test("invalid configured body limits fail closed", async () => {
  for (const limit of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      requestBoundary.readBoundedSecureFileAccessJson(post("{}"), limit),
      { name: "SecureFileAccessContractError" }
    );
  }
});
