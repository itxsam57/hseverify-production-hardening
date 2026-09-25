export const PROVIDER_KEYS = [
  "email",
  "sms",
  "payment",
  "video",
  "liveness",
  "malware_scanning"
] as const;

export type ProviderKey = (typeof PROVIDER_KEYS)[number];

export type ProviderHealth = Readonly<{
  provider: ProviderKey;
  configured: boolean;
  mode: "local" | "sandbox" | "external_unavailable";
  status: "ready" | "disabled";
  reason:
    | "local_fixture_available"
    | "built_in_available"
    | "external_configuration_required";
  adapter: "local_fixture" | "built_in" | "sandbox" | "external";
  productionActivation: "enabled" | "requires_configuration";
}>;

export type ProviderAdapterState = Readonly<{
  provider: ProviderKey;
  adapter: "local_fixture" | "built_in" | "sandbox" | "external";
  enabled: boolean;
}>;

const LOCAL_FIXTURE_ADAPTERS = new Set<ProviderKey>(["email", "malware_scanning"]);
const BUILT_IN_ADAPTERS = new Set<ProviderKey>(["video"]);

function localFixtureEnvironment(): boolean {
  const explicit = process.env.HSE_APP_ENV?.trim();
  if (explicit) return explicit === "development" || explicit === "test";
  return process.env.NODE_ENV !== "production";
}

export function getProviderAdapterState(): readonly ProviderAdapterState[] {
  const localFixturesEnabled = localFixtureEnvironment();
  return PROVIDER_KEYS.map((provider) => {
    const builtIn = BUILT_IN_ADAPTERS.has(provider);
    const localFixture = LOCAL_FIXTURE_ADAPTERS.has(provider);
    return Object.freeze({
      provider,
      adapter: builtIn
        ? ("built_in" as const)
        : localFixture
          ? ("local_fixture" as const)
          : ("external" as const),
      enabled: builtIn || (localFixture && localFixturesEnabled)
    });
  });
}

export function getProviderHealth(): readonly ProviderHealth[] {
  return getProviderAdapterState().map((state) => {
    const productionReady = state.adapter === "built_in";
    const sandboxReady = state.adapter === "local_fixture";
    return Object.freeze({
      provider: state.provider,
      configured: productionReady,
      mode: productionReady
        ? ("local" as const)
        : sandboxReady
          ? ("sandbox" as const)
          : ("external_unavailable" as const),
      status: state.enabled ? ("ready" as const) : ("disabled" as const),
      adapter: state.adapter,
      productionActivation: productionReady
        ? ("enabled" as const)
        : ("requires_configuration" as const),
      reason: productionReady
        ? ("built_in_available" as const)
        : sandboxReady
          ? ("local_fixture_available" as const)
          : ("external_configuration_required" as const)
    });
  });
}

export function getProviderHealthByKey(
  provider: ProviderKey
): ProviderHealth {
  const health = getProviderHealth().find((item) => item.provider === provider);
  if (!health) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return health;
}