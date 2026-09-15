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
