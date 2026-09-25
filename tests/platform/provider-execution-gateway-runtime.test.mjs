import assert from "node:assert/strict";
import test from "node:test";

import { executeExternalRequest } from "../../src/lib/integrations/provider-execution-gateway.ts";

test("HSE-X03 provider gateway rejects unknown callers and replays safely", async () => {
  const denied = await executeExternalRequest({
    provider: "email",
    requestId: "req-denied",
    actor: null,
    payload: { message: "x" }
  });
  assert.equal(denied.status, "rejected");
  assert.equal(denied.reason, "unauthorized");

  const first = await executeExternalRequest({
    provider: "email",
    requestId: "req-1",
    actor: { id: "adapter" },
    payload: { message: "hello" }
  });
  const replay = await executeExternalRequest({
    provider: "email",
    requestId: "req-1",
    actor: { id: "adapter" },
    payload: { message: "hello" }
  });
  assert.equal(first.status, "accepted");
  assert.equal(replay.status, "accepted");
  assert.equal(replay.replayed, true);
});

test("HSE-X03 missing external provider configuration fails closed", async () => {
  const result = await executeExternalRequest({
    provider: "payment",
    requestId: "req-payment",
    actor: { id: "adapter" },
    payload: { amount: 1 }
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "external_configuration_required");
});


test("HSE-X03 provider gateway rejects callers without provider execution authority", async () => {
  const result = await executeExternalRequest({
    provider: "email",
    requestId: "req-role-denied",
    actor: { id: "worker", role: "worker" },
    payload: { message: "hello" }
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "forbidden");
});

test("HSE-X03 built-in video adapter is executable without external provider credentials", async () => {
  const result = await executeExternalRequest({
    provider: "video",
    requestId: "req-video-built-in",
    actor: { id: "adapter", role: "provider_adapter" },
    payload: { interviewRequestId: "interview_request_test" }
  });
  assert.equal(result.status, "accepted");
  assert.equal(result.provider, "video");
});

test("HSE-X03 production gateway rejects local fixture providers but keeps built-in video", async () => {
  const previous = process.env.HSE_APP_ENV;
  process.env.HSE_APP_ENV = "production";
  try {
    const email = await executeExternalRequest({
      provider: "email",
      requestId: "req-production-email",
      actor: { id: "adapter", role: "provider_adapter" },
      payload: { message: "hello" }
    });
    assert.equal(email.status, "rejected");
    assert.equal(email.reason, "external_configuration_required");

    const malware = await executeExternalRequest({
      provider: "malware_scanning",
      requestId: "req-production-malware",
      actor: { id: "adapter", role: "provider_adapter" },
      payload: { fileRef: "secure_file_test" }
    });
    assert.equal(malware.status, "rejected");
    assert.equal(malware.reason, "external_configuration_required");

    const video = await executeExternalRequest({
      provider: "video",
      requestId: "req-production-video",
      actor: { id: "adapter", role: "provider_adapter" },
      payload: { interviewRequestId: "interview_request_test" }
    });
    assert.equal(video.status, "accepted");
    assert.equal(video.provider, "video");
  } finally {
    if (previous === undefined) delete process.env.HSE_APP_ENV;
    else process.env.HSE_APP_ENV = previous;
  }
});
