import assert from "node:assert/strict";
import test from "node:test";

import {
  getProviderAdapterState,
  getProviderHealth
} from "../../src/lib/integrations/provider-health-domain.ts";

test("M3.10 provider health exposes explicit adapter boundaries", () => {
  const adapters = getProviderAdapterState();
  assert.equal(adapters.length, 6);
  assert.deepEqual(
    adapters.filter((adapter) => adapter.enabled).map((adapter) => adapter.provider),
    ["email", "malware_scanning"]
  );

  const providers = getProviderHealth();
  assert.equal(providers.length, 6);
  assert.deepEqual(providers.map((provider) => provider.provider), [
    "email",
    "sms",
    "payment",
    "video",
    "liveness",
    "malware_scanning"
  ]);
  assert.deepEqual(
    providers.filter((provider) => provider.status === "ready").map((provider) => provider.provider),
    ["email", "malware_scanning"]
  );
  assert.equal(
    providers.find((provider) => provider.provider === "payment")?.reason,
    "external_configuration_required"
  );
  assert.equal(
    providers.find((provider) => provider.provider === "payment")?.productionActivation,
    "requires_configuration"
  );
  assert.equal(
    providers.find((provider) => provider.provider === "email")?.productionActivation,
    "enabled"
  );
});
