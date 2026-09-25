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
    ["email", "video", "malware_scanning"]
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
    ["email", "video", "malware_scanning"]
  );
  assert.equal(
    providers.find((provider) => provider.provider === "video")?.reason,
    "built_in_available"
  );
  assert.equal(
    providers.find((provider) => provider.provider === "video")?.adapter,
    "built_in"
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
    "requires_configuration"
  );
  assert.equal(
    providers.find((provider) => provider.provider === "email")?.mode,
    "sandbox"
  );
  assert.equal(
    providers.find((provider) => provider.provider === "video")?.productionActivation,
    "enabled"
  );
});

test("production does not promote local fixtures to live provider readiness", () => {
  const previous = process.env.HSE_APP_ENV;
  process.env.HSE_APP_ENV = "production";
  try {
    const providers = getProviderHealth();
    assert.equal(providers.find((provider) => provider.provider === "video")?.status, "ready");
    assert.equal(providers.find((provider) => provider.provider === "video")?.productionActivation, "enabled");
    for (const key of ["email", "malware_scanning", "sms", "payment", "liveness"]) {
      const provider = providers.find((entry) => entry.provider === key);
      assert.equal(provider?.productionActivation, "requires_configuration");
      assert.equal(provider?.status, "disabled");
    }
  } finally {
    if (previous === undefined) delete process.env.HSE_APP_ENV;
    else process.env.HSE_APP_ENV = previous;
  }
});
