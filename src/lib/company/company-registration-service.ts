import "server-only";

import { createHash } from "node:crypto";

import {
  createIdentifier,
  createOpaqueToken,
  createOtpCode,
  createTotpSecret,
  decryptSecret,
  encryptSecret,
  hashOpaqueValue,
  hashOtpCode,
  hashPassword,
  maskEmail,
  normalizeDisplayName,
  normalizeEmail,
  validatePassword,
  verifyOtpCode,
  verifyTotp
} from "../auth/auth-domain";
import { getServerEnvironment } from "../config/server-environment";
import {
  companyRegistrationFingerprint,
  createCompanyVerificationCaseId,
  createCompanyVerificationVersionId,
  normalizeCompanyBusinessEmail,
  normalizeCompanyNameFingerprint,
  normalizeCompanyVerificationDraft,
  type CompanySize
} from "./company-verification-domain";
import {
  getCompanyRegistrationRepository,
  type CompanyRegistrationFlow,
  type CompanyRegistrationRepository
} from "./company-registration-repository";

const FLOW_TTL_MS = 60 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_ATTEMPTS = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_STARTS_PER_WINDOW = 5;

export type CompanyRegistrationPublicState = Readonly<{
  step: "pending_email" | "pending_mfa" | "complete";
  deliveryHint: string | null;
  resendAvailableAt: string | null;
  challengeExpiresAt: string | null;
  totpSetupKey: string | null;
  applicationReference: string;
}>;

export type CompanyRegistrationStartResult = Readonly<{
  token: string;
  state: CompanyRegistrationPublicState;
}>;

export class CompanyRegistrationServiceError extends Error {
  constructor(
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
      | "delivery_unavailable",
    readonly userMessage: string,
    readonly retryAt: string | null = null
  ) {
    super(userMessage);
    this.name = "CompanyRegistrationServiceError";
  }
}

type CompanyRegistrationConfig = Readonly<{
  pepper: string;
  sandboxEnabled: boolean;
}>;

function addMilliseconds(value: Date, milliseconds: number): string {
  return new Date(value.getTime() + milliseconds).toISOString();
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "23505" ||
    (typeof candidate.message === "string" && /unique|duplicate key/i.test(candidate.message))
  );
}

function legalNameFingerprint(value: string): string {
  return createHash("sha256")
    .update("hse-company-legal-name-v1\u0000")
    .update(normalizeCompanyNameFingerprint(value))
    .digest("hex");
}

export class CompanyRegistrationService {
  constructor(
    private readonly repository: CompanyRegistrationRepository,
    private readonly config: CompanyRegistrationConfig,
    private readonly now: () => Date = () => new Date()
  ) {}

  private tokenHash(token: string): string {
    return hashOpaqueValue(token, this.config.pepper, "company-registration-flow");
  }

  private requestFingerprintHash(value: string): string {
    return hashOpaqueValue(value, this.config.pepper, "company-registration-request");
  }

  private destinationHash(email: string): string {
    return hashOpaqueValue(
      email,
      this.config.pepper,
      "company-registration-email-destination"
    );
  }

  private ensureDeliveryAvailable(): void {
    if (!this.config.sandboxEnabled) {
      throw new CompanyRegistrationServiceError(
        "delivery_unavailable",
        "Company registration email verification is not available in this environment."
      );
    }
  }

  private async enforceStartRateLimit(input: {
    fingerprintHash: string;
    now: Date;
  }): Promise<void> {
    const nowIso = input.now.toISOString();
    const count = await this.repository.consumeStartRateLimit({
      bucketKey: input.fingerprintHash,
      now: nowIso,
      resetBefore: addMilliseconds(input.now, -RATE_WINDOW_MS)
    });
    if (count > MAX_STARTS_PER_WINDOW) {
      throw new CompanyRegistrationServiceError(
        "rate_limited",
        "Too many Company registration attempts. Try again later."
      );
    }
  }

  private async issueEmailChallenge(input: {
    repository: CompanyRegistrationRepository;
    accountId: string;
    email: string;
    requestFingerprintHash: string;
    forceNew: boolean;
  }): Promise<{
    deliveryHint: string;
    resendAvailableAt: string;
    expiresAt: string;
  }> {
    this.ensureDeliveryAvailable();
    const now = this.now();
    const nowIso = now.toISOString();
    const existing = await input.repository.findLatestActiveEmailChallengeForUpdate(
      input.accountId
    );

    if (
      existing &&
      !input.forceNew &&
      existing.expiresAt > nowIso &&
      existing.attemptsRemaining > 0
    ) {
      return {
        deliveryHint: existing.deliveryHint,
        resendAvailableAt: existing.resendAvailableAt,
        expiresAt: existing.expiresAt
      };
    }
    if (existing && input.forceNew && existing.resendAvailableAt > nowIso) {
      throw new CompanyRegistrationServiceError(
        "challenge_cooldown",
        "Wait before requesting another verification code.",
        existing.resendAvailableAt
      );
    }

    await input.repository.authentication.invalidateOtpChallenges({
      accountId: input.accountId,
      purpose: "registration_email",
      invalidatedAt: nowIso
    });

    const challengeId = createIdentifier("otp");
    const code = createOtpCode();
    const destinationHash = this.destinationHash(input.email);
    const deliveryHint = maskEmail(input.email);
    const resendAvailableAt = addMilliseconds(now, OTP_RESEND_COOLDOWN_MS);
    const expiresAt = addMilliseconds(now, OTP_TTL_MS);

    await input.repository.authentication.insertOtpChallenge({
      challengeId,
      accountId: input.accountId,
      purpose: "registration_email",
      channel: "email",
      destinationHash,
      deliveryHint,
      codeHash: hashOtpCode({
        challengeId,
        code,
        destinationHash,
        pepper: this.config.pepper
      }),
      attemptsRemaining: OTP_ATTEMPTS,
      resendAvailableAt,
      expiresAt,
      createdAt: nowIso
    });
    await input.repository.insertSandboxDelivery({
      deliveryId: createIdentifier("delivery"),
      challengeId,
      destinationHash,
      deliveryHint,
      encryptedCode: encryptSecret(code, this.config.pepper),
      createdAt: nowIso
    });
    await input.repository.authentication.insertSecurityEvent({
      eventId: createIdentifier("event"),
      accountId: input.accountId,
      eventType: "otp_issued",
      activeRole: "company",
      requestFingerprintHash: input.requestFingerprintHash,
      metadata: {
        area: "company_registration",
        purpose: "registration_email"
      },
      occurredAt: nowIso
    });

    return { deliveryHint, resendAvailableAt, expiresAt };
  }

  private async stateFromFlow(
    repository: CompanyRegistrationRepository,
    flow: CompanyRegistrationFlow
  ): Promise<CompanyRegistrationPublicState> {
    if (flow.currentStep === "cancelled") {
      throw new CompanyRegistrationServiceError(
        "flow_missing",
        "Start Company registration again to continue."
      );
    }

    if (flow.currentStep === "pending_email") {
      const challenge = await repository.findLatestActiveEmailChallengeForUpdate(
        flow.accountId
      );
      return Object.freeze({
        step: "pending_email" as const,
        deliveryHint: challenge?.deliveryHint ?? null,
        resendAvailableAt: challenge?.resendAvailableAt ?? null,
        challengeExpiresAt: challenge?.expiresAt ?? null,
        totpSetupKey: null,
        applicationReference: flow.caseId
      });
    }

    if (flow.currentStep === "pending_mfa") {
      const factor = await repository.findMfaFactorForUpdate(flow.factorId);
      if (
        !factor ||
        factor.accountId !== flow.accountId ||
        factor.status !== "pending"
      ) {
        throw new CompanyRegistrationServiceError(
          "flow_missing",
          "Company authenticator setup is unavailable. Start registration again."
        );
      }
      return Object.freeze({
        step: "pending_mfa" as const,
        deliveryHint: null,
        resendAvailableAt: null,
        challengeExpiresAt: null,
        totpSetupKey: decryptSecret(
          factor.encryptedSecret,
          this.config.pepper
        ),
        applicationReference: flow.caseId
      });
    }

    return Object.freeze({
      step: "complete" as const,
      deliveryHint: null,
      resendAvailableAt: null,
      challengeExpiresAt: null,
      totpSetupKey: null,
      applicationReference: flow.caseId
    });
  }

  async start(input: {
    legalName: string;
    tradingName: string;
    registrationNumber: string;
    country: string;
    industry: string;
    companySize: CompanySize | string;
    website: string;
    authorizedRepresentative: string;
    businessEmail: string;
    businessPhone: string;
    password: string;
    termsAccepted: boolean;
    privacyAccepted: boolean;
    requestFingerprint: string;
  }): Promise<CompanyRegistrationStartResult> {
    this.ensureDeliveryAvailable();
    if (!input.termsAccepted || !input.privacyAccepted) {
      throw new CompanyRegistrationServiceError(
        "invalid_input",
        "Accept the terms and privacy notice to create a Company application."
      );
    }

    let email: string;
    let representative: string;
    let normalized: ReturnType<typeof normalizeCompanyVerificationDraft>;
    try {
      email = normalizeCompanyBusinessEmail(input.businessEmail);
      representative = normalizeDisplayName(input.authorizedRepresentative);
      validatePassword(input.password);
      normalized = normalizeCompanyVerificationDraft({
        legalName: input.legalName,
        tradingName: input.tradingName,
        registrationNumber: input.registrationNumber,
        country: input.country,
        industry: input.industry,
        companySize: input.companySize as CompanySize,
        website: input.website,
        authorizedRepresentative: input.authorizedRepresentative,
        businessPhone: input.businessPhone
      });
    } catch (error) {
      throw new CompanyRegistrationServiceError(
        "invalid_input",
        error instanceof Error
          ? error.message
          : "Check the Company registration details."
      );
    }

    if (
      !normalized.legalName ||
      !normalized.tradingName ||
      !normalized.registrationNumber ||
      !normalized.country ||
      !normalized.industry ||
      !normalized.companySize ||
      !normalized.website ||
      !normalized.authorizedRepresentative ||
      !normalized.businessPhone
    ) {
      throw new CompanyRegistrationServiceError(
        "invalid_input",
        "Complete all Company registration fields before creating the application."
      );
    }

    const registration = Object.freeze({
      legalName: normalized.legalName,
      tradingName: normalized.tradingName,
      registrationNumber: normalized.registrationNumber,
      country: normalized.country,
      industry: normalized.industry,
      companySize: normalized.companySize,
      website: normalized.website,
      authorizedRepresentative: normalized.authorizedRepresentative,
      businessPhone: normalized.businessPhone
    });

    const now = this.now();
    const nowIso = now.toISOString();
    const requestFingerprintHash = this.requestFingerprintHash(
      input.requestFingerprint
    );
    await this.enforceStartRateLimit({
      fingerprintHash: requestFingerprintHash,
      now
    });

    const passwordHash = await hashPassword(
      input.password,
      this.config.pepper
    );
    const rawToken = createOpaqueToken();
    const tokenHash = this.tokenHash(rawToken);

    try {
      const value = await this.repository.transaction(async (repository) => {
        if (await repository.authentication.findAccountByEmail(email)) {
          throw new CompanyRegistrationServiceError(
            "registration_unavailable",
            "Company registration cannot be started with these details. Use Company sign in or check the application details."
          );
        }

        const accountId = createIdentifier("account");
        const tenantId = createIdentifier("tenant");
        const membershipId = createIdentifier("membership");
        const caseId = createCompanyVerificationCaseId();
        const versionId = createCompanyVerificationVersionId();
        const factorId = createIdentifier("mfa");
        const flowId = createIdentifier("company_registration");
        const totpSecret = createTotpSecret();

        await repository.authentication.insertSecurityEvent({
          eventId: createIdentifier("event"),
          accountId: null,
          eventType: "registration_started",
          activeRole: "company",
          requestFingerprintHash,
          metadata: { area: "company_registration" },
          occurredAt: nowIso
        });
        await repository.authentication.insertAccount({
          accountId,
          email,
          phone: null,
          displayName: representative,
          status: "pending_email",
          passwordHash,
          workerReference: null,
          now: nowIso
        });
        await repository.authentication.addRole(accountId, "company", nowIso);
        await repository.access.insertMfaFactor({
          factorId,
          accountId,
          encryptedSecret: encryptSecret(totpSecret, this.config.pepper),
          createdAt: nowIso
        });
        await repository.createTenantFoundation({
          tenantId,
          membershipId,
          accountId,
          displayName: registration.legalName,
          caseId,
          versionId,
          legalName: registration.legalName,
          tradingName: registration.tradingName,
          registrationNumber: registration.registrationNumber,
          country: registration.country,
          industry: registration.industry,
          companySize: registration.companySize,
          website: registration.website,
          authorizedRepresentative: registration.authorizedRepresentative,
          businessEmail: email,
          businessPhone: registration.businessPhone,
          termsAcceptedAt: nowIso,
          privacyAcceptedAt: nowIso,
          registrationFingerprint: companyRegistrationFingerprint({
            country: registration.country,
            registrationNumber: registration.registrationNumber
          }),
          legalNameFingerprint: legalNameFingerprint(registration.legalName),
          now: nowIso
        });
        const flow = await repository.insertFlow({
          flowId,
          accountId,
          tenantId,
          membershipId,
          caseId,
          factorId,
          tokenHash,
          expiresAt: addMilliseconds(now, FLOW_TTL_MS),
          now: nowIso
        });
        const challenge = await this.issueEmailChallenge({
          repository,
          accountId,
          email,
          requestFingerprintHash,
          forceNew: false
        });

        return Object.freeze({
          token: rawToken,
          state: Object.freeze({
            step: "pending_email" as const,
            deliveryHint: challenge.deliveryHint,
            resendAvailableAt: challenge.resendAvailableAt,
            challengeExpiresAt: challenge.expiresAt,
            totpSetupKey: null,
            applicationReference: flow.caseId
          })
        });
      });
      return value;
    } catch (error) {
      if (error instanceof CompanyRegistrationServiceError) throw error;
      if (isUniqueViolation(error)) {
        throw new CompanyRegistrationServiceError(
          "registration_unavailable",
          "Company registration cannot be started with these details. A matching account or Company application may already exist."
        );
      }
      throw error;
    }
  }

  async readState(token: string): Promise<CompanyRegistrationPublicState | null> {
    const nowIso = this.now().toISOString();
    return this.repository.transaction(async (repository) => {
      const flow = await repository.findFlow(this.tokenHash(token), nowIso);
      if (!flow) return null;
      return this.stateFromFlow(repository, flow);
    });
  }

  async verifyEmail(input: {
    token: string;
    code: string;
    requestFingerprint: string;
  }): Promise<CompanyRegistrationPublicState> {
    const now = this.now();
    const nowIso = now.toISOString();
    const requestFingerprintHash = this.requestFingerprintHash(
      input.requestFingerprint
    );

    return this.repository.transaction(async (repository) => {
      const flow = await repository.findFlowForUpdate(this.tokenHash(input.token));
      if (!flow) {
        throw new CompanyRegistrationServiceError(
          "flow_missing",
          "Start Company registration again to continue."
        );
      }
      if (flow.expiresAt <= nowIso) {
        throw new CompanyRegistrationServiceError(
          "flow_expired",
          "This Company registration expired. Start again to continue."
        );
      }
      if (flow.currentStep !== "pending_email") {
        if (
          flow.currentStep === "pending_mfa" ||
          flow.currentStep === "complete"
        ) {
          return this.stateFromFlow(repository, flow);
        }
        throw new CompanyRegistrationServiceError(
          "wrong_step",
          "This Company email verification step is no longer active."
        );
      }

      const challenge = await repository.findLatestActiveEmailChallengeForUpdate(
        flow.accountId
      );
      if (!challenge) {
        throw new CompanyRegistrationServiceError(
          "challenge_missing",
          "Request a new Company email verification code."
        );
      }
      if (challenge.expiresAt <= nowIso) {
        throw new CompanyRegistrationServiceError(
          "challenge_expired",
          "This Company email verification code expired. Request a new code."
        );
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
          accountId: flow.accountId,
          eventType: "otp_failed",
          activeRole: "company",
          requestFingerprintHash,
          metadata: {
            area: "company_registration",
            attemptsRemaining
          },
          occurredAt: nowIso
        });
        throw new CompanyRegistrationServiceError(
          "invalid_code",
          attemptsRemaining > 0
            ? `The verification code is incorrect. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} remaining.`
            : "That verification code can no longer be used. Request a new code."
        );
      }

      if (
        !(await repository.authentication.consumeOtpChallenge(
          challenge.challengeId,
          nowIso
        ))
      ) {
        throw new CompanyRegistrationServiceError(
          "challenge_missing",
          "This Company verification code was already used."
        );
      }

      await repository.authentication.updateAccountAfterEmailVerification(
        flow.accountId,
        nowIso
      );
      if (!(await repository.advanceToMfa({ flowId: flow.flowId, now: nowIso }))) {
        throw new Error("Company registration email transition failed.");
      }
      await repository.authentication.insertSecurityEvent({
        eventId: createIdentifier("event"),
        accountId: flow.accountId,
        eventType: "otp_verified",
        activeRole: "company",
        requestFingerprintHash,
        metadata: {
          area: "company_registration",
          purpose: "registration_email"
        },
        occurredAt: nowIso
      });

      return this.stateFromFlow(repository, {
        ...flow,
        currentStep: "pending_mfa",
        updatedAt: nowIso
      });
    });
  }

  async verifyMfa(input: {
    token: string;
    code: string;
    requestFingerprint: string;
  }): Promise<CompanyRegistrationPublicState> {
    const now = this.now();
    const nowIso = now.toISOString();
    const requestFingerprintHash = this.requestFingerprintHash(
      input.requestFingerprint
    );

    return this.repository.transaction(async (repository) => {
      const flow = await repository.findFlowForUpdate(this.tokenHash(input.token));
      if (!flow) {
        throw new CompanyRegistrationServiceError(
          "flow_missing",
          "Start Company registration again to continue."
        );
      }
      if (flow.expiresAt <= nowIso) {
        throw new CompanyRegistrationServiceError(
          "flow_expired",
          "This Company registration expired. Start again to continue."
        );
      }
      if (flow.currentStep === "complete") {
        return this.stateFromFlow(repository, flow);
      }
      if (flow.currentStep !== "pending_mfa") {
        throw new CompanyRegistrationServiceError(
          "wrong_step",
          "Verify the Company email before setting up the authenticator."
        );
      }

      const factor = await repository.findMfaFactorForUpdate(flow.factorId);
      if (
        !factor ||
        factor.accountId !== flow.accountId ||
        factor.status !== "pending"
      ) {
        throw new CompanyRegistrationServiceError(
          "flow_missing",
          "Company authenticator setup is unavailable."
        );
      }

      const verification = verifyTotp({
        secret: decryptSecret(factor.encryptedSecret, this.config.pepper),
        code: input.code.trim(),
        now,
        lastAcceptedCounter: factor.lastAcceptedCounter
      });
      if (!verification.valid || verification.counter === null) {
        await repository.authentication.insertSecurityEvent({
          eventId: createIdentifier("event"),
          accountId: flow.accountId,
          eventType: "mfa_failed",
          activeRole: "company",
          requestFingerprintHash,
          metadata: { area: "company_registration" },
          occurredAt: nowIso
        });
        throw new CompanyRegistrationServiceError(
          "invalid_code",
          "The authenticator code is invalid or was already used."
        );
      }

      if (
        !(await repository.access.activateMfaFactor({
          factorId: factor.factorId,
          acceptedCounter: verification.counter,
          activatedAt: nowIso
        }))
      ) {
        throw new CompanyRegistrationServiceError(
          "invalid_code",
          "The authenticator code could not be accepted safely."
        );
      }
      if (!(await repository.completeFlow({ flowId: flow.flowId, now: nowIso }))) {
        throw new Error("Company registration MFA transition failed.");
      }
      await repository.authentication.insertSecurityEvent({
        eventId: createIdentifier("event"),
        accountId: flow.accountId,
        eventType: "mfa_enrolled",
        activeRole: "company",
        requestFingerprintHash,
        metadata: { area: "company_registration" },
        occurredAt: nowIso
      });

      return Object.freeze({
        step: "complete" as const,
        deliveryHint: null,
        resendAvailableAt: null,
        challengeExpiresAt: null,
        totpSetupKey: null,
        applicationReference: flow.caseId
      });
    });
  }

  async resendEmail(input: {
    token: string;
    requestFingerprint: string;
  }): Promise<CompanyRegistrationPublicState> {
    const nowIso = this.now().toISOString();
    const requestFingerprintHash = this.requestFingerprintHash(
      input.requestFingerprint
    );

    return this.repository.transaction(async (repository) => {
      const flow = await repository.findFlowForUpdate(this.tokenHash(input.token));
      if (!flow || flow.expiresAt <= nowIso) {
        throw new CompanyRegistrationServiceError(
          "flow_expired",
          "This Company registration expired. Start again to continue."
        );
      }
      if (flow.currentStep !== "pending_email") {
        return this.stateFromFlow(repository, flow);
      }

      const account = await repository.authentication.findAccountById(
        flow.accountId
      );
      if (!account) {
        throw new CompanyRegistrationServiceError(
          "flow_missing",
          "Start Company registration again to continue."
        );
      }

      await this.issueEmailChallenge({
        repository,
        accountId: flow.accountId,
        email: normalizeEmail(account.email),
        requestFingerprintHash,
        forceNew: true
      });
      return this.stateFromFlow(repository, flow);
    });
  }
}

let service: CompanyRegistrationService | null = null;

export async function getCompanyRegistrationService(): Promise<CompanyRegistrationService> {
  if (service) return service;
  const environment = getServerEnvironment();
  service = new CompanyRegistrationService(
    await getCompanyRegistrationRepository(),
    {
      pepper: environment.authPepper,
      sandboxEnabled: environment.authSandboxEnabled
    }
  );
  return service;
}
