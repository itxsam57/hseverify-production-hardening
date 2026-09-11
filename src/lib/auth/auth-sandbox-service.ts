import "server-only";

import { timingSafeEqual } from "node:crypto";

import {
  decryptSecret,
  hashOpaqueValue,
  normalizeEmail,
  normalizePhone,
  type OtpChannel
} from "@/lib/auth/auth-domain";
import { getWorkerRegistrationRepository } from "@/lib/auth/worker-registration-repository";
import { getServerEnvironment } from "@/lib/config/server-environment";

export class AuthenticationSandboxError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = "AuthenticationSandboxError";
  }
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function destinationContexts(channel: OtpChannel): string[] {
  return channel === "email"
    ? [
        "worker-registration-email-destination",
        "company-registration-email-destination",
        "auth-recovery-email-destination"
      ]
    : ["worker-registration-phone-destination"];
}

export async function readLatestAuthenticationSandboxCode(input: {
  channel: OtpChannel;
  destination: string;
  accessKey: string;
}): Promise<{
  code: string;
  deliveryHint: string;
  createdAt: string;
}> {
  const environment = getServerEnvironment();
  if (
    !environment.authSandboxEnabled ||
    !environment.authSandboxAccessKey ||
    !constantTimeStringEqual(
      input.accessKey,
      environment.authSandboxAccessKey
    )
  ) {
    throw new AuthenticationSandboxError("Sandbox access denied.");
  }

  const destination =
    input.channel === "email"
      ? normalizeEmail(input.destination)
      : normalizePhone(input.destination);
  const repository = await getWorkerRegistrationRepository();
  const deliveries = await Promise.all(
    destinationContexts(input.channel).map((context) =>
      repository.findLatestSandboxDelivery({
        channel: input.channel,
        destinationHash: hashOpaqueValue(
          destination,
          environment.authPepper,
          context
        )
      })
    )
  );
  const delivery = deliveries
    .filter((item) => item !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!delivery) {
    throw new AuthenticationSandboxError(
      "No active sandbox authentication delivery was found."
    );
  }
  await repository.markSandboxDeliveryOpened({
    deliveryId: delivery.deliveryId,
    openedAt: new Date().toISOString()
  });
  return {
    code: decryptSecret(delivery.encryptedCode, environment.authPepper),
    deliveryHint: delivery.deliveryHint,
    createdAt: delivery.createdAt
  };
}
