import "server-only";

import type { HseAppEnvironment } from "../config/environment";
import { getServerEnvironment } from "../config/server-environment";
import {
  normalizeEmailAdapterResult,
  type EmailAdapterInput,
  type EmailAdapterKey,
  type EmailAdapterResult
} from "./email-delivery-domain";

export interface EmailDeliveryAdapter {
  readonly key: EmailAdapterKey;
  deliver(input: EmailAdapterInput): Promise<EmailAdapterResult>;
}

export class LocalTestEmailDeliveryAdapter implements EmailDeliveryAdapter {
  readonly key = "local_test" as const;

  constructor(private readonly environment: HseAppEnvironment) {}

  async deliver(input: EmailAdapterInput): Promise<EmailAdapterResult> {
    if (this.environment !== "development" && this.environment !== "test") {
      return normalizeEmailAdapterResult({
        kind: "terminal",
        code: "provider_unconfigured",
        summary: "Live email delivery is not configured for this environment."
      });
    }

    if (
      input.fixtureRef.startsWith("email.foundation.retry_once.") &&
      input.attemptNumber === 1
    ) {
      return normalizeEmailAdapterResult({
        kind: "retryable",
        code: "local_temporary_unavailable",
        summary: "The local test adapter requested one deterministic retry."
      });
    }

    if (input.fixtureRef.startsWith("email.foundation.retry_always.")) {
      return normalizeEmailAdapterResult({
        kind: "retryable",
        code: "local_temporary_unavailable",
        summary: "The local test adapter requested a deterministic retry."
      });
    }

    if (input.fixtureRef.startsWith("email.foundation.terminal.")) {
      return normalizeEmailAdapterResult({
        kind: "terminal",
        code: "local_recipient_rejected",
        summary: "The local test adapter rejected this deterministic fixture."
      });
    }

    return normalizeEmailAdapterResult({
      kind: "delivered",
      code: "local_accepted",
      summary: "The local test adapter accepted the delivery.",
      providerReference: `local:${input.dispatchKey}`
    });
  }
}

export function getEmailDeliveryAdapter(): EmailDeliveryAdapter {
  return new LocalTestEmailDeliveryAdapter(getServerEnvironment().appEnvironment);
}
