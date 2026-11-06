import type { RuntimeEnvironment } from "../config/environment";

export const PROVIDER_KEYS = ["email", "sms", "payment", "video", "liveness", "malware_scanning"] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];
type ProviderConfiguration = Pick<RuntimeEnvironment, "appEnvironment" | "registrationOtpProviders">;
export type ProviderHealth = Readonly<{
 provider: ProviderKey;
 configured: boolean;
 mode: "local" | "sandbox" | "external" | "external_unavailable";
 status: "ready" | "configured" | "disabled";
 reason: "local_fixture_available" | "built_in_available" | "external_configuration_required" | "configured_not_verified";
 adapter: "local_fixture" | "built_in" | "external";
 productionActivation: "enabled" | "configured_unverified" | "requires_configuration";
 observedAvailability: "not_checked";
}>;
export type ProviderAdapterState = Readonly<Pick<ProviderHealth, "provider" | "adapter"> & { enabled: boolean }>;

// Consume the same validated environment used by real transports. No provider calls
// are made here: configuration is not an availability or delivery observation.
export function getProviderHealth(environment: ProviderConfiguration): readonly ProviderHealth[] {
 const local = environment.appEnvironment === "development" || environment.appEnvironment === "test";
 const config = environment.registrationOtpProviders;
 const emailConfigured = Boolean(config?.emailApiKey && config.emailFrom);
 const smsConfigured = Boolean(config?.smsAccountSid && config.smsAuthToken && config.smsFrom);
 return PROVIDER_KEYS.map(provider => {
  const builtIn = provider === "video";
  // Preview/production scanner factory always selects ClamAV (default clamscan).
  // Selection cannot prove the executable or its signature database is available.
  const externalConfigured = (provider === "email" && emailConfigured) ||
   (provider === "sms" && smsConfigured) || (provider === "malware_scanning" && !local);
  const fixture = local && !externalConfigured && (provider === "email" || provider === "malware_scanning");
  return Object.freeze({
   provider,
   configured: builtIn || externalConfigured,
   mode: builtIn ? "local" : externalConfigured ? "external" : fixture ? "sandbox" : "external_unavailable",
   status: builtIn || fixture ? "ready" : externalConfigured ? "configured" : "disabled",
   reason: builtIn ? "built_in_available" : externalConfigured ? "configured_not_verified" : fixture ? "local_fixture_available" : "external_configuration_required",
   adapter: builtIn ? "built_in" : fixture ? "local_fixture" : "external",
   productionActivation: builtIn ? "enabled" : externalConfigured ? "configured_unverified" : "requires_configuration",
   observedAvailability: "not_checked"
  } satisfies ProviderHealth);
 });
}

export function getProviderAdapterState(environment: ProviderConfiguration): readonly ProviderAdapterState[] {
 return getProviderHealth(environment).map(row => Object.freeze({provider: row.provider, adapter: row.adapter, enabled: row.status !== "disabled"}));
}
export function getProviderHealthByKey(provider: ProviderKey, environment: ProviderConfiguration): ProviderHealth {
 const row = getProviderHealth(environment).find(item => item.provider === provider);
 if (!row) throw new Error(`Unknown provider: ${provider}`);
 return row;
}
