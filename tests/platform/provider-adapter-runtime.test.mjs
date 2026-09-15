import assert from "node:assert/strict";
import test from "node:test";

import { executeProviderCheck } from "../../src/lib/integrations/provider-adapter-service.ts";

test("M3.10 provider adapters execute locally and fail closed when configuration is missing", async () => {
  assert.deepEqual(await executeProviderCheck("email"), {
    provider: "email",
    accepted: true,
    adapter: "local_fixture",
    reason: "local_fixture_executed"
  });

  assert.deepEqual(await executeProviderCheck("payment"), {
    provider: "payment",
    accepted: false,
    adapter: "external",
    reason: "external_configuration_required"
  });
});
