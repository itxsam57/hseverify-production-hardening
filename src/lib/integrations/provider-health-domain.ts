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
  reason: "local_fixture_available" | "external_configuration_required";
  adapter: "local_fixture" | "sandbox" | "external";
  productionActivation: "enabled" | "requires_configuration";
}>;

export type ProviderAdapterState = Readonly<{
  provider: ProviderKey;
  adapter: "local_fixture" | "sandbox" | "external";
  enabled: boolean;
}>;

const LOCAL_ADAPTERS = new Set<ProviderKey>(["email", "malware_scanning"]);

export function getProviderAdapterState(): readonly ProviderAdapterState[] {
  return PROVIDER_KEYS.map((provider) =>
    Object.freeze({
      provider,
      adapter: LOCAL_ADAPTERS.has(provider)
        ? ("local_fixture" as const)
        : ("external" as const),
      enabled: LOCAL_ADAPTERS.has(provider)
    })
  );
}

export function getProviderHealth(): readonly ProviderHealth[] {
  return getProviderAdapterState().map((state) =>
    Object.freeze({
      provider: state.provider,
      configured: state.enabled,
      mode: state.enabled ? ("local" as const) : ("external_unavailable" as const),
      status: state.enabled ? ("ready" as const) : ("disabled" as const),
      adapter: state.adapter,
      productionActivation: state.enabled
        ? ("enabled" as const)
        : ("requires_configuration" as const),
      reason: state.enabled
        ? ("local_fixture_available" as const)
        : ("external_configuration_required" as const)
    })
  );
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
