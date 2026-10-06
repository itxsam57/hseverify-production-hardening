export type OtpProviderConfig = Readonly<{
  emailApiKey?: string; emailFrom?: string;
  smsAccountSid?: string; smsAuthToken?: string; smsFrom?: string;
}>;
export type OtpDispatch = Readonly<{
  challengeId: string; channel: "email" | "phone"; destination: string;
  code: string; expiresAt: string;
}>;
export type OtpProviderResult =
  | Readonly<{kind: "accepted"; providerReference: string}>
  | Readonly<{kind: "retryable" | "terminal" | "unknown"; code: string}>;

const safeValue = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximum &&
  !/[\x00-\x1f\x7f]/.test(value);
const email = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const phone = (value: string) => /^\+[1-9][0-9]{7,14}$/.test(value);

// The durable dispatcher must verify challenge expiry/invalidation before invoking this transport.
// Provider acceptance is not delivery confirmation. Ambiguous SMS results must not be retried blindly.
export function createOtpProviderTransport(config: OtpProviderConfig, fetcher: typeof fetch = fetch) {
  return {
    async send(input: OtpDispatch): Promise<OtpProviderResult> {
      if (!/^otp_[A-Za-z0-9_-]{24}$/.test(input.challengeId) ||
          !/^[0-9]{6}$/.test(input.code) || !safeValue(input.destination, 254) ||
          !Number.isFinite(Date.parse(input.expiresAt)) ||
          (input.channel !== "email" && input.channel !== "phone") ||
          !(input.channel === "email" ? email(input.destination) : phone(input.destination))) {
        return {kind: "terminal", code: "invalid_dispatch"};
      }
      const isEmail = input.channel === "email";
      const configured = isEmail
        ? safeValue(config.emailApiKey, 512) && safeValue(config.emailFrom, 320)
        : /^AC[0-9a-fA-F]{32}$/.test(config.smsAccountSid ?? "") &&
          safeValue(config.smsAuthToken, 512) && phone(config.smsFrom ?? "");
      if (!configured) return {kind: "terminal", code: "provider_unconfigured"};
      const message = `Your HSE Verify verification code is ${input.code}. It expires at ${input.expiresAt}. If you did not request this code, ignore this message.`;
      const headers: Record<string, string> = isEmail
        ? {Authorization: `Bearer ${config.emailApiKey}`, "Content-Type": "application/json", "Idempotency-Key": input.challengeId}
        : {Authorization: "Basic " + Buffer.from(`${config.smsAccountSid}:${config.smsAuthToken}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded"};
      const body = isEmail
        ? JSON.stringify({from: config.emailFrom, to: [input.destination], subject: "Verify your HSE Verify account", text: message})
        : new URLSearchParams({From: config.smsFrom!, To: input.destination, Body: message}).toString();
      const endpoint = isEmail ? "https://api.resend.com/emails"
        : `https://api.twilio.com/2010-04-01/Accounts/${config.smsAccountSid}/Messages.json`;
      try {
        const response = await fetcher(endpoint, {method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(10000)});
        if (!response.ok) {
          if (isEmail && response.status === 409) {
            const body: unknown = await response.json().catch(() => null);
            const concurrent = body && typeof body === "object" &&
              (body as {name?: unknown}).name === "concurrent_idempotent_requests";
            return {kind: concurrent ? "retryable" : "terminal", code: "provider_http_409"};
          }
          if (!isEmail && response.status >= 500) return {kind: "unknown", code: "provider_outcome_unknown"};
          return {kind: response.status === 429 || response.status >= 500 ? "retryable" : "terminal", code: `provider_http_${response.status}`};
        }
        const result: unknown = await response.json();
        const reference = result && typeof result === "object"
          ? (isEmail ? (result as {id?: unknown}).id : (result as {sid?: unknown}).sid) : null;
        if (!safeValue(reference, 240) || !/^[A-Za-z0-9_-]+$/.test(reference) ||
            (!isEmail && !/^SM[0-9a-fA-F]{32}$/.test(reference))) {
          return isEmail ? {kind: "retryable", code: "provider_invalid_response"}
            : {kind: "unknown", code: "provider_outcome_unknown"};
        }
        return {kind: "accepted", providerReference: reference};
      } catch {
        return isEmail ? {kind: "retryable", code: "provider_unreachable"}
          : {kind: "unknown", code: "provider_outcome_unknown"};
      }
    }
  };
}
