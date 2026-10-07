import "server-only";

import type { RegistrationDeliveryIntent, RegistrationDeliveryStatus } from "./registration-delivery-repository";

import {
  createIdentifier,
  createOpaqueToken,
  createOtpCode,
  encryptSecret,
  hashOpaqueValue,
  hashOtpCode,
  hashPassword,
  maskEmail,
  normalizeEmail,
  validatePassword,
  verifyOtpCode,
  type AuthRole
} from "@/lib/auth/auth-domain";
import {
  getAuthAccessRepository,
  type AuthAccessRepository,
  type RecoveryFlow
} from "@/lib/auth/auth-access-repository";
import { getServerEnvironment } from "@/lib/config/server-environment";

const RECOVERY_FLOW_TTL_MS = 20 * 60 * 1000;
const RECOVERY_OTP_TTL_MS = 10 * 60 * 1000;
const RECOVERY_RESEND_COOLDOWN_MS = 60 * 1000;
const RECOVERY_OTP_ATTEMPTS = 5;
const RECOVERY_RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_RECOVERY_REQUESTS = 5;
const MAX_RECOVERY_RESET_ATTEMPTS = 10;

export class AuthenticationRecoveryError extends Error {
  readonly code:
    | "invalid_input"
    | "rate_limited"
    | "flow_missing"
    | "flow_expired"
    | "invalid_code"
    | "cooldown"
    | "unavailable";
  readonly userMessage: string;
  readonly retryAt: string | null;

  constructor(input: {
    code: AuthenticationRecoveryError["code"];
    userMessage: string;
    retryAt?: string | null;
  }) {
    super(input.userMessage);
    this.name = "AuthenticationRecoveryError";
    this.code = input.code;
    this.userMessage = input.userMessage;
    this.retryAt = input.retryAt ?? null;
  }
}

export type RecoveryPublicState = {
  role: AuthRole;
  expiresAt: string;
  deliveryStatus?: RegistrationDeliveryStatus | null;
};

function addMilliseconds(value: Date, milliseconds: number): string {
  return new Date(value.getTime() + milliseconds).toISOString();
}

export class AuthRecoveryService {
  constructor(
    private readonly repository: AuthAccessRepository,
    private readonly config: {
      pepper: string;
      sandboxEnabled: boolean;
      registrationDeliveryChannels?: readonly ("email" | "phone")[];
    },
    private readonly now: () => Date = () => new Date()
  ) {}

  private flowTokenHash(token: string): string {
    return hashOpaqueValue(token, this.config.pepper, "auth-recovery-flow");
  }

  private requestHash(value: string): string {
    return hashOpaqueValue(value, this.config.pepper, "auth-recovery-request");
  }

  private destinationHash(email: string): string {
    return hashOpaqueValue(
      email,
      this.config.pepper,
      "auth-recovery-email-destination"
    );
  }

  private async enforceRateLimit(input: {
    bucketValue: string;
    context: "request" | "reset";
    limit: number;
    now: Date;
  }): Promise<void> {
    const attempts = await this.repository.consumeAccessRateLimit({
      action: "password_reset",
      bucketKey: hashOpaqueValue(
        input.bucketValue,
        this.config.pepper,
        `auth-recovery-${input.context}-rate-limit`
      ),
      now: input.now.toISOString(),
      resetBefore: addMilliseconds(input.now, -RECOVERY_RATE_WINDOW_MS)
    });
    if (attempts > input.limit) {
      throw new AuthenticationRecoveryError({
        code: "rate_limited",
        userMessage: "Too many recovery attempts. Wait before trying again."
      });
    }
  }

  private async issueChallenge(input: {
    repository: AuthAccessRepository;
    accountId: string;
    email: string;
    requestFingerprintHash: string;
    now: Date;
  }): Promise<{challengeId: string; deliveryIntent: RegistrationDeliveryIntent | null}> {
    const nowIso = input.now.toISOString();
    await input.repository.authentication.invalidateOtpChallenges({
      accountId: input.accountId,
      purpose: "password_reset",
      invalidatedAt: nowIso
    });

    const challengeId = createIdentifier("otp");
    const code = createOtpCode();
    const destinationHash = this.destinationHash(input.email);
    const deliveryHint = maskEmail(input.email);
    await input.repository.authentication.insertOtpChallenge({
      challengeId,
      accountId: input.accountId,
      purpose: "password_reset",
      channel: "email",
      destinationHash,
      deliveryHint,
      codeHash: hashOtpCode({
        challengeId,
        code,
        destinationHash,
        pepper: this.config.pepper
      }),
      attemptsRemaining: RECOVERY_OTP_ATTEMPTS,
      resendAvailableAt: addMilliseconds(
        input.now,
        RECOVERY_RESEND_COOLDOWN_MS
      ),
      expiresAt: addMilliseconds(input.now, RECOVERY_OTP_TTL_MS),
      createdAt: nowIso
    });
    let deliveryIntent: RegistrationDeliveryIntent | null = null;
    if (this.config.sandboxEnabled) {
    await input.repository.insertSandboxDelivery({
      deliveryId: createIdentifier("delivery"),
      challengeId,
      channel: "email",
      destinationHash,
      deliveryHint,
      encryptedCode: encryptSecret(code, this.config.pepper),
      createdAt: nowIso
    });
    } else {
      deliveryIntent = {deliveryId:createIdentifier("delivery"),challengeId,
        encryptedPayload:encryptSecret(JSON.stringify({destination:input.email,code,purpose:"password_reset",channel:"email"}),this.config.pepper),
        createdAt:nowIso};
    }
    await input.repository.authentication.insertSecurityEvent({
      eventId: createIdentifier("event"),
      accountId: input.accountId,
      eventType: "otp_issued",
      requestFingerprintHash: input.requestFingerprintHash,
      metadata: { purpose: "password_reset", channel: "email" },
      occurredAt: nowIso
    });
    return {challengeId,deliveryIntent};
  }

  async request(input: {
    role: AuthRole;
    email: string;
    requestFingerprint: string;
  }): Promise<{ token: string }> {
    let email: string;
    try {
      email = normalizeEmail(input.email);
    } catch {
      email = input.email.trim().toLowerCase().slice(0, 254);
    }
    const now = this.now();
    const nowIso = now.toISOString();
    await this.enforceRateLimit({
      bucketValue: `${input.requestFingerprint}\u0000${email}\u0000${input.role}`,
      context: "request",
      limit: MAX_RECOVERY_REQUESTS,
      now
    });

    const token = createOpaqueToken();
    if ((!this.config.sandboxEnabled && !this.config.registrationDeliveryChannels?.includes("email")) || !email) {
      return { token };
    }

    const requestFingerprintHash = this.requestHash(
      input.requestFingerprint
    );
    await this.repository.transaction(async (repository) => {
      const account = await repository.findAccountByEmailForUpdate(email);
      if (
        !account ||
        !account.passwordHash ||
        !["active", "locked"].includes(account.status) ||
        !(await repository.hasRole(account.accountId, input.role))
      ) {
        await repository.authentication.insertSecurityEvent({
          eventId: createIdentifier("event"),
          accountId: account?.accountId ?? null,
          eventType: "password_reset_requested",
          activeRole: input.role,
          requestFingerprintHash,
          metadata: { eligible: false },
          occurredAt: nowIso
        });
        return;
      }

      await repository.invalidateRecoveryFlows({
        accountId: account.accountId,
        invalidatedAt: nowIso
      });
      const {challengeId,deliveryIntent} = await this.issueChallenge({
        repository,
        accountId: account.accountId,
        email: account.email,
        requestFingerprintHash,
        now
      });
      await repository.insertRecoveryFlow({
        flowId: createIdentifier("recovery"),
        accountId: account.accountId,
        activeRole: input.role,
        tokenHash: this.flowTokenHash(token),
        challengeId,
        expiresAt: addMilliseconds(now, RECOVERY_FLOW_TTL_MS),
        createdAt: nowIso
      });
      if (deliveryIntent) await repository.enqueueRecoveryDelivery(deliveryIntent);
      await repository.authentication.insertSecurityEvent({
        eventId: createIdentifier("event"),
        accountId: account.accountId,
        eventType: "password_reset_requested",
        activeRole: input.role,
        requestFingerprintHash,
        metadata: { eligible: true },
        occurredAt: nowIso
      });
    });

    return { token };
  }

  async readState(token: string): Promise<RecoveryPublicState | null> {
    const now = this.now().toISOString();
    return this.repository.transaction(async (repository) => {
      const flow = await repository.findRecoveryFlowForUpdate(
        this.flowTokenHash(token)
      );
      if (
        !flow ||
        flow.consumedAt ||
        flow.expiresAt <= now
      ) {
        return null;
      }
      return { role: flow.activeRole, expiresAt: flow.expiresAt,
        ...(!this.config.sandboxEnabled ? {deliveryStatus:await repository.readRecoveryDeliveryStatus(flow.challengeId)} : {}) };
    });
  }

  private validateFlow(flow: RecoveryFlow | null, nowIso: string): RecoveryFlow {
    if (!flow || flow.consumedAt) {
      throw new AuthenticationRecoveryError({
        code: this.config.sandboxEnabled ? "flow_missing" : "invalid_code",
        userMessage: this.config.sandboxEnabled ? "This recovery request is no longer available." : "The verification code is invalid or expired."
      });
    }
    if (flow.expiresAt <= nowIso) {
      throw new AuthenticationRecoveryError({
        code: this.config.sandboxEnabled ? "flow_expired" : "invalid_code",
        userMessage: this.config.sandboxEnabled ? "This recovery request has expired. Start again." : "The verification code is invalid or expired."
      });
    }
    return flow;
  }

  async resetPassword(input: {
    token: string;
    code: string;
    password: string;
  }): Promise<{ role: AuthRole }> {
    try {
      validatePassword(input.password);
    } catch (error) {
      throw new AuthenticationRecoveryError({
        code: "invalid_input",
        userMessage:
          error instanceof Error ? error.message : "Choose a valid password."
      });
    }

    const now = this.now();
    await this.enforceRateLimit({
      bucketValue: this.flowTokenHash(input.token),
      context: "reset",
      limit: MAX_RECOVERY_RESET_ATTEMPTS,
      now
    });
    const passwordHash = await hashPassword(
      input.password,
      this.config.pepper
    );

    const result = await this.repository.transaction(async (repository) => {
      const candidate=await repository.findRecoveryFlowForUpdate(this.flowTokenHash(input.token));
      const flow=this.validateFlow(candidate,this.config.sandboxEnabled ? this.now().toISOString() : await repository.readRecoveryTime());
      const challenge = await repository.authentication.findOtpChallengeForUpdate(flow.challengeId);
      const nowIso=this.config.sandboxEnabled ? this.now().toISOString() : await repository.readRecoveryTime();
      this.validateFlow(flow,nowIso);
      if (
        !challenge ||
        challenge.accountId !== flow.accountId ||
        challenge.purpose !== "password_reset" ||
        challenge.channel !== "email" ||
        challenge.consumedAt ||
        challenge.invalidatedAt ||
        challenge.expiresAt <= nowIso ||
        challenge.attemptsRemaining <= 0
      ) {
        throw new AuthenticationRecoveryError({
          code: "invalid_code",
          userMessage: "The verification code is invalid or expired."
        });
      }

      const valid = verifyOtpCode({
        challengeId: challenge.challengeId,
        code: input.code.trim(),
        destinationHash: challenge.destinationHash,
        pepper: this.config.pepper,
        expectedHash: challenge.codeHash
      });
      if (!valid) {
        const remaining = await repository.authentication.recordOtpFailure(
          challenge.challengeId,
          nowIso
        );
        await repository.authentication.insertSecurityEvent({
          eventId: createIdentifier("event"),
          accountId: flow.accountId,
          eventType: "otp_failed",
          activeRole: flow.activeRole,
          metadata: { purpose: "password_reset", attemptsRemaining: remaining },
          occurredAt: nowIso
        });
        // Commit the rejected attempt and its audit before surfacing the domain error.
        return {
          error: new AuthenticationRecoveryError({
            code: "invalid_code",
            userMessage:
              !this.config.sandboxEnabled ? "The verification code is invalid or expired." : remaining > 0
                ? `The verification code is incorrect. ${remaining} attempt(s) remain.`
                : "The verification code can no longer be used. Start again."
          })
        } as const;
      }

      if (
        !(await repository.authentication.consumeOtpChallenge(
          challenge.challengeId,
          nowIso
        )) ||
        !(await repository.consumeRecoveryFlow({
          flowId: flow.flowId,
          consumedAt: nowIso
        }))
      ) {
        throw new AuthenticationRecoveryError({
          code: "invalid_code",
          userMessage: "The verification code has already been used."
        });
      }

      await repository.authentication.setPassword(
        flow.accountId,
        passwordHash,
        nowIso
      );
      await repository.authentication.revokeAllSessions({
        accountId: flow.accountId,
        revokedAt: nowIso,
        reason: "password_reset"
      });
      await repository.authentication.insertSecurityEvent({
        eventId: createIdentifier("event"),
        accountId: flow.accountId,
        eventType: "otp_verified",
        activeRole: flow.activeRole,
        metadata: { purpose: "password_reset" },
        occurredAt: nowIso
      });
      await repository.authentication.insertSecurityEvent({
        eventId: createIdentifier("event"),
        accountId: flow.accountId,
        eventType: "password_reset_completed",
        activeRole: flow.activeRole,
        occurredAt: nowIso
      });
      return { value: { role: flow.activeRole } } as const;
    });
    if ("error" in result) throw result.error;
    return result.value;
  }

  async resend(input: { token: string }): Promise<void> {
    if (!this.config.sandboxEnabled && !this.config.registrationDeliveryChannels?.includes("email")) {
      throw new AuthenticationRecoveryError({
        code: "unavailable",
        userMessage: "Recovery delivery is unavailable in this environment."
      });
    }
    await this.repository.transaction(async (repository) => {
      const candidate = await repository.findRecoveryFlowForUpdate(this.flowTokenHash(input.token));
      let nowIso=this.config.sandboxEnabled ? this.now().toISOString() : await repository.readRecoveryTime();
      // Production resend must not reveal whether the requested account/role exists.
      if (!this.config.sandboxEnabled && (!candidate || candidate.consumedAt || candidate.expiresAt<=nowIso)) return;
      const flow = this.validateFlow(candidate,nowIso);
      const previous = await repository.authentication.findOtpChallengeForUpdate(
        flow.challengeId
      );
      nowIso=this.config.sandboxEnabled ? this.now().toISOString() : await repository.readRecoveryTime();
      if (!this.config.sandboxEnabled && flow.expiresAt<=nowIso) return;
      this.validateFlow(flow,nowIso);
      if (previous && previous.resendAvailableAt > nowIso) {
        if (!this.config.sandboxEnabled) return;
        throw new AuthenticationRecoveryError({
          code: "cooldown",
          userMessage: "Wait before requesting another verification code.",
          retryAt: previous.resendAvailableAt
        });
      }
      const account = await repository.authentication.findAccountById(
        flow.accountId
      );
      if (!account) {
        throw new AuthenticationRecoveryError({
          code: "flow_missing",
          userMessage: "This recovery request is no longer available."
        });
      }
      const {challengeId,deliveryIntent} = await this.issueChallenge({
        repository,
        accountId: flow.accountId,
        email: account.email,
        requestFingerprintHash: hashOpaqueValue(
          input.token,
          this.config.pepper,
          "auth-recovery-resend-request"
        ),
        now: new Date(nowIso)
      });
      if (
        !(await repository.updateRecoveryChallenge({
          flowId: flow.flowId,
          challengeId,
          updatedAt: nowIso
        }))
      ) {
        throw new AuthenticationRecoveryError({
          code: "flow_missing",
          userMessage: "This recovery request is no longer available."
        });
      }
      if (deliveryIntent) await repository.enqueueRecoveryDelivery(deliveryIntent);
    });
  }
}

export function isPasswordRecoveryConfigured(): boolean {
  const environment = getServerEnvironment();
  return environment.authSandboxEnabled || Boolean(
    environment.registrationOtpProviders?.emailApiKey && environment.registrationOtpProviders.emailFrom
  );
}

export async function getAuthRecoveryService(): Promise<AuthRecoveryService> {
  const environment = getServerEnvironment();
  return new AuthRecoveryService(await getAuthAccessRepository(), {
    pepper: environment.authPepper,
    sandboxEnabled: environment.authSandboxEnabled,
    registrationDeliveryChannels: environment.registrationOtpProviders?.emailApiKey && environment.registrationOtpProviders.emailFrom ? ["email"] : []
  });
}
