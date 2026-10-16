import { normalizeCredentialValidityBinding } from "../credential/credential-validity-domain";
import { normalizePublicVerificationIdentifier } from "./public-verification-domain";

const MAX_SCANNED_VALUE_LENGTH = 1600;
const PUBLIC_CAPABILITY_ROUTE = /^\/verify\/(?:result|qr)\/[A-Za-z0-9_-]{80,1200}$/;

export type PublicQrValue =
  | Readonly<{ kind: "identifier"; identifier: string }>
  | Readonly<{ kind: "capability"; path: string }>;

function publicUrl(value: string, origin: string): URL | null {
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function credentialEnvelope(value: unknown, origin: string): PublicQrValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const allowed = ["type", "credentialId", "url", "signing", "validity"];
  if (Object.keys(input).some(key => !allowed.includes(key)) ||
      input.type !== "hse_verify_credential" || typeof input.credentialId !== "string" ||
      typeof input.url !== "string") return null;
  const identifier = normalizePublicVerificationIdentifier(input.credentialId);
  if (!identifier || identifier.kind !== "credential" || identifier.normalizedIdentifier !== input.credentialId) return null;
  const url = publicUrl(input.url, origin);
  if (!url || url.pathname !== "/verify/result/" + identifier.normalizedIdentifier) return null;
  if ("signing" in input) {
    const signing = input.signing;
    if (!signing || typeof signing !== "object" || Array.isArray(signing)) return null;
    const fields = signing as Record<string, unknown>;
    if (Object.keys(fields).length !== 3 || fields.version !== 1 ||
        fields.algorithm !== "HMAC-SHA256" || typeof fields.keyId !== "string" ||
        !/^[a-f0-9]{32}$/.test(fields.keyId)) return null;
  }
  if ("validity" in input) {
    if (!("signing" in input)) return null;
    try { normalizeCredentialValidityBinding(input.validity); } catch { return null; }
  }
  // This is a reference, never authentication of the scanned envelope. The
  // existing server lookup authenticates persisted issuance and projects live status.
  return { kind: "identifier", identifier: identifier.normalizedIdentifier };
}

export function parsePublicQrValue(rawValue: string, origin: string): PublicQrValue | null {
  if (typeof rawValue !== "string" || rawValue.length > MAX_SCANNED_VALUE_LENGTH) return null;
  const value = rawValue.trim();
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const identifier = normalizePublicVerificationIdentifier(value);
  if (identifier) return { kind: "identifier", identifier: identifier.normalizedIdentifier };
  if (value.startsWith("{") || value.startsWith("[")) {
    try { return credentialEnvelope(JSON.parse(value), origin); } catch { return null; }
  }
  const url = publicUrl(value, origin);
  if (!url) return null;
  const resultPrefix = "/verify/result/";
  if (url.pathname.startsWith(resultPrefix)) {
    const credential = normalizePublicVerificationIdentifier(url.pathname.slice(resultPrefix.length));
    if (credential?.kind === "credential") return { kind: "identifier", identifier: credential.normalizedIdentifier };
  }
  if (PUBLIC_CAPABILITY_ROUTE.test(url.pathname)) return { kind: "capability", path: url.pathname };
  return null;
}
