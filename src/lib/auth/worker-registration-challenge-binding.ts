import "server-only";

import { hashOpaqueValue } from "@/lib/auth/auth-domain";
import {
  getWorkerRegistrationRepository,
  type PendingRegistrationStep
} from "@/lib/auth/worker-registration-repository";
import { getServerEnvironment } from "@/lib/config/server-environment";

export type WorkerRegistrationChallengeBinding = {
  step: PendingRegistrationStep;
  challengeId: string | null;
};

export async function readWorkerRegistrationChallengeBinding(
  token: string
): Promise<WorkerRegistrationChallengeBinding | null> {
  const environment = getServerEnvironment();
  const repository = await getWorkerRegistrationRepository();
  const tokenHash = hashOpaqueValue(
    token,
    environment.authPepper,
    "worker-registration-flow"
  );
  const now = new Date().toISOString();

  return repository.transaction(async (transaction) => {
    const flow = await transaction.findFlowByTokenHash(tokenHash, now);
    if (
      !flow ||
      (flow.currentStep !== "pending_email" &&
        flow.currentStep !== "pending_phone")
    ) {
      return null;
    }

    const challenge = await transaction.findLatestActiveChallengeForUpdate({
      accountId: flow.accountId,
      purpose:
        flow.currentStep === "pending_email"
          ? "registration_email"
          : "registration_phone"
    });

    return {
      step: flow.currentStep,
      challengeId: challenge?.challengeId ?? null
    };
  });
}
