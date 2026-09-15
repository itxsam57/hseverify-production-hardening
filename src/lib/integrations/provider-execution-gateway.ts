// @ts-expect-error Runtime test harness resolves TypeScript module sources directly.
import { executeProviderCheck } from "./provider-adapter-service.ts";

type Provider = "email" | "sms" | "payment" | "video" | "liveness" | "malware_scanning";

const requests = new Map<string, string>();
const inFlightRequests = new Map<string, Promise<Readonly<Record<string, unknown>>>>();

export type ProviderRequest = Readonly<{
  provider: Provider;
  requestId: string;
  actor: { id: string; role?: string } | null;
  payload: unknown;
}>;

export async function executeExternalRequest(input: ProviderRequest) {
  if (!input.requestId || input.requestId.length > 200) {
    return Object.freeze({ status: "rejected" as const, reason: "invalid_request" as const });
  }

  if (!input.actor) {
    return Object.freeze({ status: "rejected" as const, reason: "unauthorized" as const });
  }

  if (input.actor.role && !["system", "provider_adapter", "admin"].includes(input.actor.role)) {
    return Object.freeze({ status: "rejected" as const, reason: "forbidden" as const });
  }

  const fingerprint = stableFingerprint(input.provider, input.payload);
  const previous = requests.get(input.requestId);
  if (previous && previous !== fingerprint) {
    return Object.freeze({ status: "rejected" as const, reason: "request_replay_conflict" as const });
  }
  if (previous === fingerprint) {
    return Object.freeze({ status: "accepted" as const, replayed: true });
  }

  const inFlight = inFlightRequests.get(input.requestId);
  if (inFlight) {
    return inFlight;
  }

  const execution = (async () => {
    const check = await executeProviderCheck(input.provider);
    if (!check.accepted) {
      return Object.freeze({ status: "rejected" as const, reason: check.reason });
    }

    requests.set(input.requestId, fingerprint);
    return Object.freeze({ status: "accepted" as const, replayed: false, provider: input.provider });
  })();

  inFlightRequests.set(input.requestId, execution);
  try {
    return await execution;
  } finally {
    inFlightRequests.delete(input.requestId);
  }
}

function stableFingerprint(provider: Provider, payload: unknown): string {
  return JSON.stringify([provider, normalizeValue(payload)]);
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeValue(entry)])
    );
  }

  return value;
}
