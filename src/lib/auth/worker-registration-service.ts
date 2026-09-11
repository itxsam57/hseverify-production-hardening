import "server-only";

import { timingSafeEqual } from "node:crypto";

import {
  createIdentifier,
  createOpaqueToken,
  createOtpCode,
  createWorkerRegistrationReference,
  decryptSecret,
  encryptSecret,
  hashOpaqueValue,
  hashOtpCode,
  hashPassword,
  maskEmail,
  maskPhone,
  normalizeDisplayName,
  normalizeEmail,
  normalizePhone,
  validatePassword,
  verifyOtpCode,
  type OtpChannel,
  type OtpPurpose
} from "@/lib/auth/auth-domain";
import type { AuthAccount, AuthOtpChallenge } from "@/lib/auth/auth-repository";
import {
  getWorkerRegistrationRepository,
  type PendingRegistrationStep,
  type RegistrationFlow,
  type WorkerRegistrationRepository
} from "@/lib/auth/worker-registration-repository";
import { getServerEnvironment } from "@/lib/config/server-environment";

const FLOW_TTL_MS = 60 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_ATTEMPTS = 5;
const REGISTRATION_RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_REGISTRATION_STARTS_PER_WINDOW = 5;

export type RegistrationPublicStep =
  | "pending_email"
  | "pending_phone"
  | "complete";

export type RegistrationPublicState = {
  step: RegistrationPublicStep;
  deliveryHint: string | null;
  resendAvailableAt: string | null;
  challengeExpiresAt: string | null;
  workerReference: string | null;
};

export type RegistrationStartResult = {
  token: string;
  state: RegistrationPublicState;
};

export type RegistrationVerifyResult = {
  state: RegistrationPublicState;
};

export class RegistrationServiceError extends Error {
  readonly code:
    | "invalid_input"
    | "rate_limited"
    | "registration_unavailable"
    | "flow_missing"
    | "flow_expired"
    | "wrong_step"
    | "challenge_missing"
    | "challenge_expired"
    | "challenge_cooldown"
    | "invalid_code"
    | "delivery_unavailable"
    | "sandbox_denied";
  readonly userMessage: string;
  readonly retryAt: string | null;

  constructor(input: {
    code: RegistrationServiceError["code"];
    userMessage: string;
    retryAt?: string | null;
  }) {
    super(input.userMessage);
    this.name = "RegistrationServiceError";
    this.code = input.code;
    this.userMessage = input.userMessage;
    this.retryAt = input.retryAt ?? null;
  }
}

type RegistrationServiceConfig = {
  pepper: string;
  sandboxEnabled: boolean;
  sandboxAccessKey: string | null;
};

type IssuedChallenge = {
  challenge: AuthOtpChallenge;
  deliveryHint: string;
};

function addMilliseconds(value: Date, milliseconds: number): string {
  return new Date(value.getTime() + milliseconds).toISOString();
}

function registrationStepForAccount(
  account: AuthAccount
): PendingRegistrationStep {
  return account.status === "pending_phone" ? "pending_phone" : "pending_email";
}

function purposeForStep(step: PendingRegistrationStep): OtpPurpose {
  return step === "pending_email"
    ? "registration_email"
    : "registration_phone";
}

function channelForStep(step: PendingRegistrationStep): OtpChannel {
  return step === "pending_email" ? "email" : "phone";
}

function destinationForStep(
  account: AuthAccount,
  step: PendingRegistrationStep
): string {
  if (step === "pending_email") return account.email;
  if (!account.phone) {
    throw new RegistrationServiceError({
      code: "registration_unavailable",
      userMessage: "Registration cannot continue with these details."
    });
  }
  return account.phone;
}

function deliveryHintForStep(
  account: AuthAccount,
  step: PendingRegistrationStep
): string {
  return step === "pending_email"
    ? maskEmail(account.email)
    : maskPhone(destinationForStep(account, step));
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "23505" ||
    (typeof candidate.message === "string" &&
      /unique|duplicate key/i.test(candidate.message))
  );
}

export class WorkerRegistrationService {
  constructor(
    private readonly repository: WorkerRegistrationRepository,
    private readonly config: RegistrationServiceConfig,
    private readonly now: () => Date = () => new Date()
  ) {}

  private tokenHash(token: string): string {
    return hashOpaqueValue(token, this.config.pepper, "worker-registration-flow");
  }

  private requestFingerprintHash(value: string): string {
    return hashOpaqueValue(
      value,
      this.config.pepper,
      "worker-registration-request"
    );
  }

  private destinationHash(channel: OtpChannel, value: string): string {
    return hashOpaqueValue(
      value,
      this.config.pepper,
      `worker-registration-${channel}-destination`
    );
  }

  private ensureDeliveryAvailable(): void {
    if (!this.config.sandboxEnabled) {
      throw new RegistrationServiceError({
        code: "delivery_unavailable",
        userMessage:
          "Registration verification delivery is not available in this environment."
      });
    }
  }

  private async enforceStartRateLimit(input: {
    requestFingerprintHash: string;
    now: Date;
  }): Promise<void> {
    const nowIso = input.now.toISOString();
    const blocked = await this.repository.transaction(async (repository) => {
      const attemptCount =
        await repository.consumeRegistrationStartRateLimit({
          bucketKey: input.requestFingerprintHash,
          now: nowIso,
          resetBefore: addMilliseconds(
            input.now,
            -REGISTRATION_RATE_WINDOW_MS
          )
        });
      if (attemptCount <= MAX_REGISTRATION_STARTS_PER_WINDOW) {
        return false;
      }

      await repository.authentication.insertSecurityEvent({
        eventId: createIdentifier("event"),
        accountId: null,
        eventType: "access_denied",
        requestFingerprintHash: input.requestFingerprintHash,
        metadata: { area: "worker_registration", reason: "rate_limit" },
        occurredAt: nowIso
      });
      return true;
    });

    if (blocked) {
      throw new RegistrationServiceError({
        code: "rate_limited",
        userMessage: "Too many registration attempts. Wait before trying again."
      });
    }
  }

  private async issueChallenge(input: {
    repository: WorkerRegistrationRepository;
    account: AuthAccount;
    step: PendingRegistrationStep;
    requestFingerprintHash: string;
    forceNew: boolean;
  }): Promise<IssuedChallenge> {
    this.ensureDeliveryAvailable();

    const now = this.now();
    const nowIso = now.toISOString();
    const purpose = purposeForStep(input.step);
    const channel = channelForStep(input.step);
    const destination = destinationForStep(input.account, input.step);
    const destinationHash = this.destinationHash(channel, destination);
    const deliveryHint = deliveryHintForStep(input.account, input.step);
    const existing =
      await input.repository.findLatestActiveChallengeForUpdate({
        accountId: input.account.accountId,
        purpose
      });

    if (
      existing &&
      !input.forceNew &&
      existing.expiresAt > nowIso &&
      existing.attemptsRemaining > 0
    ) {
      return { challenge: existing, deliveryHint: existing.deliveryHint };
    }

    if (existing && input.forceNew && existing.resendAvailableAt > nowIso) {
      throw new RegistrationServiceError({
        code: "challenge_cooldown",
        userMessage: "Wait before requesting another verification code.",
        retryAt: existing.resendAvailableAt
      });
    }

    await input.repository.authentication.invalidateOtpChallenges({
      accountId: input.account.accountId,
      purpose,
      invalidatedAt: nowIso
    });

    const challengeId = createIdentifier("otp");
    const code = createOtpCode();
    const challenge = await input.repository.authentication.insertOtpChallenge({
      challengeId,
      accountId: input.account.accountId,
      purpose,
      channel,
      destinationHash,
      deliveryHint,
      codeHash: hashOtpCode({
        challengeId,
        code,
        destinationHash,
        pepper: this.config.pepper
      }),
      attemptsRemaining: OTP_ATTEMPTS,
      resendAvailableAt: addMilliseconds(now, OTP_RESEND_COOLDOWN_MS),
      expiresAt: addMilliseconds(now, OTP_TTL_MS),
      createdAt: nowIso
    });

    await input.repository.insertSandboxDelivery({
      deliveryId: createIdentifier("delivery"),
      challengeId,
      channel,
      destinationHash,
      deliveryHint,
      encryptedCode: encryptSecret(code, this.config.pepper),
      createdAt: nowIso
    });

    await input.repository.authentication.insertSecurityEvent({
      eventId: createIdentifier("event"),
      accountId: input.account.accountId,
      eventType: "otp_issued",
      activeRole: "worker",
      requestFingerprintHash: input.requestFingerprintHash,
      metadata: { purpose, channel, deliveryHint },
      occurredAt: nowIso
    });

    return { challenge, deliveryHint };
  }

  private stateFrom(
    flow: RegistrationFlow,
    account: AuthAccount,
    challenge: AuthOtpChallenge | null
  ): RegistrationPublicState {
    if (flow.currentStep === "complete") {
      return {
        step: "complete",
        deliveryHint: null,
        resendAvailableAt: null,
        challengeExpiresAt: null,
        workerReference: account.workerReference
      };
    }

    if (
      flow.currentStep !== "pending_email" &&
      flow.currentStep !== "pending_phone"
    ) {
      throw new RegistrationServiceError({
        code: "flow_missing",
        userMessage: "This registration can no longer be continued."
      });
    }

    return {
      step: flow.currentStep,
      deliveryHint:
        challenge?.deliveryHint ??
        deliveryHintForStep(account, flow.currentStep),
      resendAvailableAt: challenge?.resendAvailableAt ?? null,
      challengeExpiresAt: challenge?.expiresAt ?? null,
      workerReference: null
    };
  }

  async start(input: {
    displayName: string;
    email: string;
    phone: string;
    password: string;
    requestFingerprint: string;
  }): Promise<RegistrationStartResult> {
    this.ensureDeliveryAvailable();

    let displayName: string;
    let email: string;
    let phone: string;
    try {
      displayName = normalizeDisplayName(input.displayName);
      email = normalizeEmail(input.email);
      phone = normalizePhone(input.phone);
      validatePassword(input.password);
    } catch (error) {
      throw new RegistrationServiceError({
        code: "invalid_input",
        userMessage:
          error instanceof Error ? error.message : "Check the registration details."
      });
    }

    const now = this.now();
    const nowIso = now.toISOString();
    const requestFingerprintHash = this.requestFingerprintHash(
      input.requestFingerprint
    );
    await this.enforceStartRateLimit({ requestFingerprintHash, now });

    const passwordHash = await hashPassword(input.password, this.config.pepper);
    const rawToken = createOpaqueToken();
    const tokenHash = this.tokenHash(rawToken);
    const flowId = createIdentifier("registration");

    try {
      const result = await this.repository.transaction(async (repository) => {
        await repository.authentication.insertSecurityEvent({
          eventId: createIdentifier("event"),
          accountId: null,
          eventType: "registration_started",
          requestFingerprintHash,
          metadata: { channelOrder: ["email", "phone"] },
          occurredAt: nowIso
        });

        const emailAccount =
          await repository.authentication.findAccountByEmail(email);
        const phoneAccount = await repository.findAccountByPhone(phone);

        let account: AuthAccount;
        if (!emailAccount && !phoneAccount) {
          const accountId = createIdentifier("account");
          account = await repository.authentication.insertAccount({
            accountId,
            email,
            phone,
            displayName,
            status: "pending_email",
            passwordHash,
            workerReference: createWorkerRegistrationReference(accountId),
            now: nowIso
          });
          await repository.authentication.addRole(accountId, "worker", nowIso);
        } else {
          const sameAccount =
            emailAccount &&
            phoneAccount &&
            emailAccount.accountId === phoneAccount.accountId;
          const pendingWorker = sameAccount
            ? await repository.findMatchingPendingWorker({ email, phone })
            : null;

          if (!pendingWorker) {
            await repository.authentication.insertSecurityEvent({
              eventId: createIdentifier("event"),
              accountId: emailAccount?.accountId ?? phoneAccount?.accountId ?? null,
              eventType: "access_denied",
              activeRole: "worker",
              requestFingerprintHash,
              metadata: {
                area: "worker_registration",
                reason: "contact_conflict"
              },
              occurredAt: nowIso
            });
            return {
              error: new RegistrationServiceError({
                code: "registration_unavailable",
                userMessage:
                  "Registration cannot be started with these details. Check the information or use Worker sign in."
              })
            } as const;
          }

          if (pendingWorker.status === "pending_email") {
            const replaced = await repository.replacePendingRegistrationDetails({
              accountId: pendingWorker.accountId,
              displayName,
              passwordHash,
              now: nowIso
            });
            if (!replaced) {
              throw new Error("Pending registration detail replacement failed.");
            }
            account = {
              ...pendingWorker,
              displayName,
              passwordHash,
              updatedAt: nowIso
            };
          } else {
            account = pendingWorker;
          }
        }

        const step = registrationStepForAccount(account);
        const flow = await repository.createOrRotateFlow({
          flowId,
          accountId: account.accountId,
          tokenHash,
          currentStep: step,
          expiresAt: addMilliseconds(now, FLOW_TTL_MS),
          now: nowIso
        });
        const issued = await this.issueChallenge({
          repository,
          account,
          step,
          requestFingerprintHash,
          forceNew: false
        });

        return {
          value: {
            token: rawToken,
            state: this.stateFrom(flow, account, issued.challenge)
          }
        } as const;
      });

      if ("error" in result) throw result.error;
      return result.value;
    } catch (error) {
      if (error instanceof RegistrationServiceError) throw error;
      if (isUniqueViolation(error)) {
        throw new RegistrationServiceError({
          code: "registration_unavailable",
          userMessage:
            "Registration cannot be started with these details. Check the information or use Worker sign in."
        });
      }
      throw error;
    }
  }

  async readState(token: string): Promise<RegistrationPublicState | null> {
    const nowIso = this.now().toISOString();
    return this.repository.transaction(async (repository) => {
      const flow = await repository.findFlowByTokenHash(
        this.tokenHash(token),
        nowIso
      );
      if (!flow) return null;
      const account = await repository.authentication.findAccountById(
        flow.accountId
      );
      if (!account) return null;
      const challenge =
        flow.currentStep === "pending_email" ||
        flow.currentStep === "pending_phone"
          ? await repository.findLatestActiveChallengeForUpdate({
              accountId: account.accountId,
              purpose: purposeForStep(flow.currentStep)
            })
          : null;
      return this.stateFrom(flow, account, challenge);
    });
  }

  async verify(input: {
    token: string;
    code: string;
    requestFingerprint: string;
  }): Promise<RegistrationVerifyResult> {
    const now = this.now();
    const nowIso = now.toISOString();
    const tokenHash = this.tokenHash(input.token);
    const requestFingerprintHash = this.requestFingerprintHash(
      input.requestFingerprint
    );

    const result = await this.repository.transaction(async (repository) => {
      const flow = await repository.findFlowForUpdate(tokenHash);
      if (!flow || flow.currentStep === "cancelled") {
        return {
          error: new RegistrationServiceError({
            code: "flow_missing",
            userMessage: "Start registration again to continue."
          })
        } as const;
      }
      if (flow.expiresAt <= nowIso) {
        return {
          error: new RegistrationServiceError({
            code: "flow_expired",
            userMessage: "This registration expired. Start again to continue."
          })
        } as const;
      }
      if (flow.currentStep === "complete") {
        const account = await repository.authentication.findAccountById(
          flow.accountId
        );
        if (!account) {
          return {
            error: new RegistrationServiceError({
              code: "flow_missing",
              userMessage: "Start registration again to continue."
            })
          } as const;
        }
        return { value: { state: this.stateFrom(flow, account, null) } } as const;
      }
      if (
        flow.currentStep !== "pending_email" &&
        flow.currentStep !== "pending_phone"
      ) {
        return {
          error: new RegistrationServiceError({
            code: "wrong_step",
            userMessage: "This verification step is no longer active."
          })
        } as const;
      }

      const account = await repository.authentication.findAccountById(
        flow.accountId
      );
      if (!account) {
        return {
          error: new RegistrationServiceError({
            code: "flow_missing",
            userMessage: "Start registration again to continue."
          })
        } as const;
      }

      const challenge =
        await repository.findLatestActiveChallengeForUpdate({
          accountId: account.accountId,
          purpose: purposeForStep(flow.currentStep)
        });
      if (!challenge) {
        return {
          error: new RegistrationServiceError({
            code: "challenge_missing",
            userMessage: "Request a new verification code to continue."
          })
        } as const;
      }
      if (challenge.expiresAt <= nowIso) {
        return {
          error: new RegistrationServiceError({
            code: "challenge_expired",
            userMessage: "This verification code expired. Request a new code."
          })
        } as const;
      }

      const valid = verifyOtpCode({
        challengeId: challenge.challengeId,
        code: input.code.trim(),
        destinationHash: challenge.destinationHash,
        pepper: this.config.pepper,
        expectedHash: challenge.codeHash
      });
      if (!valid) {
        const attemptsRemaining =
          await repository.authentication.recordOtpFailure(
            challenge.challengeId,
            nowIso
          );
        await repository.authentication.insertSecurityEvent({
          eventId: createIdentifier("event"),
          accountId: account.accountId,
          eventType: "otp_failed",
          activeRole: "worker",
          requestFingerprintHash,
          metadata: {
            purpose: challenge.purpose,
            channel: challenge.channel,
            attemptsRemaining
          },
          occurredAt: nowIso
        });
        return {
          error: new RegistrationServiceError({
            code: "invalid_code",
            userMessage:
              attemptsRemaining > 0
                ? `The verification code is incorrect. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} remaining.`
                : "That code can no longer be used. Request a new code."
          })
        } as const;
      }

      const consumed =
        await repository.authentication.consumeOtpChallenge(
          challenge.challengeId,
          nowIso
        );
      if (!consumed) {
        return {
          error: new RegistrationServiceError({
            code: "challenge_missing",
            userMessage: "This verification code was already used."
          })
        } as const;
      }

      await repository.authentication.insertSecurityEvent({
        eventId: createIdentifier("event"),
        accountId: account.accountId,
        eventType: "otp_verified",
        activeRole: "worker",
        requestFingerprintHash,
        metadata: {
          purpose: challenge.purpose,
          channel: challenge.channel
        },
        occurredAt: nowIso
      });

      if (flow.currentStep === "pending_email") {
        const updatedAccount =
          await repository.authentication.updateAccountAfterEmailVerification(
            account.accountId,
            nowIso
          );
        const advanced = await repository.advanceFlow({
          accountId: account.accountId,
          from: "pending_email",
          to: "pending_phone",
          now: nowIso
        });
        if (!advanced) {
          throw new Error("Registration flow email transition failed.");
        }
        const issued = await this.issueChallenge({
          repository,
          account: updatedAccount,
          step: "pending_phone",
          requestFingerprintHash,
          forceNew: true
        });
        const nextFlow: RegistrationFlow = {
          ...flow,
          currentStep: "pending_phone",
          updatedAt: nowIso
        };
        return {
          value: {
            state: this.stateFrom(nextFlow, updatedAccount, issued.challenge)
          }
        } as const;
      }

      const updatedAccount =
        await repository.authentication.updateAccountAfterPhoneVerification(
          account.accountId,
          nowIso
        );
      if (updatedAccount.status !== "active" || !updatedAccount.passwordHash) {
        throw new Error("Registration activation invariant failed.");
      }
      const advanced = await repository.advanceFlow({
        accountId: account.accountId,
        from: "pending_phone",
        to: "complete",
        now: nowIso
      });
      if (!advanced) {
        throw new Error("Registration flow phone transition failed.");
      }
      const completeFlow: RegistrationFlow = {
        ...flow,
        currentStep: "complete",
        completedAt: nowIso,
        updatedAt: nowIso
      };
      return {
        value: {
          state: this.stateFrom(completeFlow, updatedAccount, null)
        }
      } as const;
    });

    if ("error" in result) throw result.error;
    return result.value;
  }

  async resend(input: {
    token: string;
    requestFingerprint: string;
  }): Promise<RegistrationPublicState> {
    const nowIso = this.now().toISOString();
    const requestFingerprintHash = this.requestFingerprintHash(
      input.requestFingerprint
    );
    const result = await this.repository.transaction(async (repository) => {
      const flow = await repository.findFlowForUpdate(this.tokenHash(input.token));
      if (!flow || flow.expiresAt <= nowIso) {
        return {
          error: new RegistrationServiceError({
            code: "flow_expired",
            userMessage: "This registration expired. Start again to continue."
          })
        } as const;
      }
      if (
        flow.currentStep !== "pending_email" &&
        flow.currentStep !== "pending_phone"
      ) {
        return {
          error: new RegistrationServiceError({
            code: "wrong_step",
            userMessage: "This verification step is no longer active."
          })
        } as const;
      }
      const account = await repository.authentication.findAccountById(
        flow.accountId
      );
      if (!account) {
        return {
          error: new RegistrationServiceError({
            code: "flow_missing",
            userMessage: "Start registration again to continue."
          })
        } as const;
      }
      const issued = await this.issueChallenge({
        repository,
        account,
        step: flow.currentStep,
        requestFingerprintHash,
        forceNew: true
      });
      return {
        value: this.stateFrom(flow, account, issued.challenge)
      } as const;
    });
    if ("error" in result) throw result.error;
    return result.value;
  }

  async cancel(token: string): Promise<void> {
    const nowIso = this.now().toISOString();
    await this.repository.transaction(async (repository) => {
      const flow = await repository.findFlowForUpdate(this.tokenHash(token));
      if (!flow || flow.currentStep === "complete" || flow.currentStep === "cancelled") {
        return;
      }

      await repository.authentication.insertSecurityEvent({
        eventId: createIdentifier("event"),
        accountId: flow.accountId,
        eventType: "access_denied",
        activeRole: "worker",
        metadata: {
          area: "worker_registration",
          reason: "user_cancelled"
        },
        occurredAt: nowIso
      });

      const deleted = await repository.deleteUnactivatedAccount(flow.accountId);
      if (!deleted) {
        throw new Error("Unactivated registration account could not be cancelled.");
      }
    });
  }

  async readSandboxCode(input: {
    channel: OtpChannel;
    destination: string;
    accessKey: string;
  }): Promise<{
    code: string;
    deliveryHint: string;
    createdAt: string;
  }> {
    if (
      !this.config.sandboxEnabled ||
      !this.config.sandboxAccessKey ||
      !constantTimeStringEqual(
        input.accessKey,
        this.config.sandboxAccessKey
      )
    ) {
      throw new RegistrationServiceError({
        code: "sandbox_denied",
        userMessage: "Sandbox access denied."
      });
    }

    const destination =
      input.channel === "email"
        ? normalizeEmail(input.destination)
        : normalizePhone(input.destination);
    const delivery = await this.repository.findLatestSandboxDelivery({
      channel: input.channel,
      destinationHash: this.destinationHash(input.channel, destination)
    });
    if (!delivery) {
      throw new RegistrationServiceError({
        code: "challenge_missing",
        userMessage: "No active sandbox verification delivery was found."
      });
    }
    await this.repository.markSandboxDeliveryOpened({
      deliveryId: delivery.deliveryId,
      openedAt: this.now().toISOString()
    });
    return {
      code: decryptSecret(delivery.encryptedCode, this.config.pepper),
      deliveryHint: delivery.deliveryHint,
      createdAt: delivery.createdAt
    };
  }
}

export async function getWorkerRegistrationService(): Promise<WorkerRegistrationService> {
  const environment = getServerEnvironment();
  return new WorkerRegistrationService(
    await getWorkerRegistrationRepository(),
    {
      pepper: environment.authPepper,
      sandboxEnabled: environment.authSandboxEnabled,
      sandboxAccessKey: environment.authSandboxAccessKey
    }
  );
}
