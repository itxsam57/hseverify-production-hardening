type ProviderKey =
  | "email"
  | "sms"
  | "payment"
  | "video"
  | "liveness"
  | "malware_scanning";

const LOCAL_ADAPTERS = new Set<ProviderKey>(["email", "malware_scanning"]);

function getAdapterState(provider: ProviderKey) {
  return {
    provider,
    adapter: LOCAL_ADAPTERS.has(provider) ? ("local_fixture" as const) : ("external" as const),
    enabled: LOCAL_ADAPTERS.has(provider)
  };
}

export type ProviderExecutionResult = Readonly<{
  provider: ProviderKey;
  accepted: boolean;
  adapter: "local_fixture" | "sandbox" | "external";
  reason: "local_fixture_executed" | "external_configuration_required";
}>;

export async function executeProviderCheck(
  provider: ProviderKey
): Promise<ProviderExecutionResult> {
  const adapter = getAdapterState(provider);

  if (!adapter.enabled) {
    return Object.freeze({
      provider,
      accepted: false,
      adapter: adapter.adapter,
      reason: "external_configuration_required" as const
    });
  }

  return Object.freeze({
    provider,
    accepted: true,
    adapter: adapter.adapter,
    reason: "local_fixture_executed" as const
  });
}
