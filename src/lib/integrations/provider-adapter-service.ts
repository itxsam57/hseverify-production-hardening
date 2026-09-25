type ProviderKey =
  | "email"
  | "sms"
  | "payment"
  | "video"
  | "liveness"
  | "malware_scanning";

const LOCAL_FIXTURE_ADAPTERS = new Set<ProviderKey>(["email", "malware_scanning"]);
const BUILT_IN_ADAPTERS = new Set<ProviderKey>(["video"]);

function localFixtureEnvironment(): boolean {
  const explicit = process.env.HSE_APP_ENV?.trim();
  if (explicit) return explicit === "development" || explicit === "test";
  return process.env.NODE_ENV !== "production";
}

function getAdapterState(provider: ProviderKey) {
  const builtIn = BUILT_IN_ADAPTERS.has(provider);
  const localFixture = LOCAL_FIXTURE_ADAPTERS.has(provider);
  const localFixtureEnabled = localFixture && localFixtureEnvironment();
  return {
    provider,
    adapter: builtIn
      ? ("built_in" as const)
      : localFixture
        ? ("local_fixture" as const)
        : ("external" as const),
    enabled: builtIn || localFixtureEnabled
  };
}

export type ProviderExecutionResult = Readonly<{
  provider: ProviderKey;
  accepted: boolean;
  adapter: "local_fixture" | "built_in" | "sandbox" | "external";
  reason:
    | "local_fixture_executed"
    | "built_in_executed"
    | "external_configuration_required";
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
    reason:
      adapter.adapter === "built_in"
        ? ("built_in_executed" as const)
        : ("local_fixture_executed" as const)
  });
}
