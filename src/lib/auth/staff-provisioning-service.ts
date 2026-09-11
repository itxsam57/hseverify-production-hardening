import "server-only";

import { timingSafeEqual } from "node:crypto";

import {
  createIdentifier,
  createOpaqueToken,
  createTotpSecret,
  decryptSecret,
  encryptSecret,
  hashOpaqueValue,
  hashPassword,
  normalizeDisplayName,
  normalizeEmail,
  validatePassword,
  verifyTotp,
  type AuthRole
} from "@/lib/auth/auth-domain";
import {
  getAuthAccessRepository,
  type AuthAccessRepository,
  type StaffEnrollmentFlow,
  type StaffInvitation
} from "@/lib/auth/auth-access-repository";
import { getServerEnvironment } from "@/lib/config/server-environment";

const INVITATION_TTL_MS = 48 * 60 * 60 * 1000;
const ENROLLMENT_TTL_MS = 2 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_INVITATION_REQUESTS = 20;
const MAX_ENROLLMENT_ATTEMPTS = 10;

export type StaffRole = Exclude<AuthRole, "worker">;

export type StaffEnrollmentPublicState = {
  step: "profile" | "totp" | "complete";
  email: string;
  role: StaffRole;
  expiresAt: string;
  totpSecret: string | null;
  otpauthUri: string | null;
};

export class StaffProvisioningError extends Error {
  readonly code:
    | "invalid_input"
    | "access_denied"
    | "rate_limited"
    | "invitation_unavailable"
    | "flow_missing"
    | "flow_expired"
    | "wrong_step"
    | "invalid_totp"
    | "bootstrap_unavailable";
  readonly userMessage: string;

  constructor(
    code: StaffProvisioningError["code"],
    userMessage: string
  ) {
    super(userMessage);
    this.name = "StaffProvisioningError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

function addMilliseconds(value: Date, milliseconds: number): string {
  return new Date(value.getTime() + milliseconds).toISOString();
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

function allowedInvitationRoles(inviterRole: AuthRole): readonly StaffRole[] {
  if (inviterRole === "root") {
    return ["company", "assessor", "verifier", "admin", "root"];
  }
  if (inviterRole === "admin") {
    return ["company", "assessor", "verifier"];
  }
  return [];
}

function combineEnrollmentTokens(
  invitationToken: string,
  flowToken: string
): string {
  return `${invitationToken}.${flowToken}`;
}

function splitEnrollmentTokens(value: string): {
  invitationToken: string;
  flowToken: string;
} {
  const [invitationToken, flowToken, unexpected] = value.split(".");
  if (!invitationToken || !flowToken || unexpected) {
    throw new StaffProvisioningError(
      "flow_missing",
      "This enrollment can no longer be continued."
    );
  }
  return { invitationToken, flowToken };
}

function publicStep(
  flow: StaffEnrollmentFlow
): StaffEnrollmentPublicState["step"] {
  if (flow.currentStep === "profile") return "profile";
  if (flow.currentStep === "totp") return "totp";
  if (flow.currentStep === "complete") return "complete";
  throw new StaffProvisioningError(
    "flow_missing",
    "This enrollment can no longer be continued."
  );
}

export class StaffProvisioningService {
  constructor(
    private readonly repository: AuthAccessRepository,
    private readonly config: {
      pepper: string;
      sandboxEnabled: boolean;
      sandboxAccessKey: string | null;
    },
    private readonly now: () => Date = () => new Date()
  ) {}

  private invitationTokenHash(token: string): string {
    return hashOpaqueValue(token, this.config.pepper, "staff-invitation");
  }

  private enrollmentTokenHash(token: string): string {
    return hashOpaqueValue(token, this.config.pepper, "staff-enrollment");
  }

  private async enforceRateLimit(input: {
    action: "staff_invitation" | "root_bootstrap";
    bucketValue: string;
    limit: number;
  }): Promise<void> {
    const now = this.now();
    const attempts = await this.repository.consumeAccessRateLimit({
      action: input.action,
      bucketKey: hashOpaqueValue(
        input.bucketValue,
        this.config.pepper,
        `auth-${input.action}-rate-limit`
      ),
      now: now.toISOString(),
      resetBefore: addMilliseconds(now, -RATE_WINDOW_MS)
    });
    if (attempts > input.limit) {
      throw new StaffProvisioningError(
        "rate_limited",
        "Too many requests. Wait before trying again."
      );
    }
  }

  private otpauthUri(email: string, secret: string): string {
    const issuer = "HSE Verify";
    const label = `${issuer}:${email}`;
    const parameters = new URLSearchParams({
      secret,
      issuer,
      algorithm: "SHA1",
      digits: "6",
      period: "30"
    });
    return `otpauth://totp/${encodeURIComponent(label)}?${parameters.toString()}`;
  }

  private validateInvitation(
    invitation: StaffInvitation | null,
    nowIso: string
  ): StaffInvitation {
    if (
      !invitation ||
      invitation.status !== "pending" ||
      invitation.expiresAt <= nowIso
    ) {
      throw new StaffProvisioningError(
        "invitation_unavailable",
        "This staff invitation is invalid, expired or already used."
      );
    }
    return invitation;
  }

  private validateFlow(
    flow: StaffEnrollmentFlow | null,
    nowIso: string
  ): StaffEnrollmentFlow {
    if (!flow || flow.currentStep === "cancelled") {
      throw new StaffProvisioningError(
        "flow_missing",
        "This enrollment can no longer be continued."
      );
    }
    if (flow.expiresAt <= nowIso) {
      throw new StaffProvisioningError(
        "flow_expired",
        "This enrollment has expired. Open the invitation again."
      );
    }
    return flow;
  }

  private async lockedEnrollmentContext(input: {
    repository: AuthAccessRepository;
    combinedToken: string;
    nowIso: string;
  }): Promise<{
    flow: StaffEnrollmentFlow;
    invitation: StaffInvitation;
  }> {
    const tokens = splitEnrollmentTokens(input.combinedToken);
    const flow = this.validateFlow(
      await input.repository.findStaffEnrollmentFlowForUpdate(
        this.enrollmentTokenHash(tokens.flowToken)
      ),
      input.nowIso
    );
    const invitation = this.validateInvitation(
      await input.repository.findStaffInvitationByTokenHashForUpdate(
        this.invitationTokenHash(tokens.invitationToken)
      ),
      input.nowIso
    );
    if (flow.invitationId !== invitation.invitationId) {
      throw new StaffProvisioningError(
        "flow_missing",
        "This enrollment can no longer be continued."
      );
    }
    return { flow, invitation };
  }

  private async insertInvitation(input: {
    repository: AuthAccessRepository;
    email: string;
    role: StaffRole;
    token: string;
    invitedByAccountId: string | null;
    now: Date;
  }): Promise<StaffInvitation> {
    const nowIso = input.now.toISOString();
    return input.repository.insertStaffInvitation({
      invitationId: createIdentifier("invitation"),
      email: input.email,
      role: input.role,
      tokenHash: this.invitationTokenHash(input.token),
      invitedByAccountId: input.invitedByAccountId,
      expiresAt: addMilliseconds(input.now, INVITATION_TTL_MS),
      createdAt: nowIso
    });
  }

  async createInvitation(input: {
    inviterAccountId: string;
    inviterRole: AuthRole;
    email: string;
    role: StaffRole;
    requestFingerprint: string;
  }): Promise<{ token: string; invitation: StaffInvitation }> {
    if (!allowedInvitationRoles(input.inviterRole).includes(input.role)) {
      throw new StaffProvisioningError(
        "access_denied",
        "This portal cannot create that staff role."
      );
    }

    let email: string;
    try {
      email = normalizeEmail(input.email);
    } catch (error) {
      throw new StaffProvisioningError(
        "invalid_input",
        error instanceof Error ? error.message : "Enter a valid email address."
      );
    }

    await this.enforceRateLimit({
      action: "staff_invitation",
      bucketValue: `${input.inviterAccountId}\u0000${input.requestFingerprint}`,
      limit: MAX_INVITATION_REQUESTS
    });

    const now = this.now();
    const token = createOpaqueToken();
    try {
      const invitation = await this.repository.transaction(
        async (repository) => {
          if (await repository.authentication.findAccountByEmail(email)) {
            throw new StaffProvisioningError(
              "invitation_unavailable",
              "An invitation cannot be created for these details."
            );
          }
          const created = await this.insertInvitation({
            repository,
            email,
            role: input.role,
            token,
            invitedByAccountId: input.inviterAccountId,
            now
          });
          await repository.authentication.insertSecurityEvent({
            eventId: createIdentifier("event"),
            accountId: input.inviterAccountId,
            eventType: "invitation_created",
            activeRole: input.inviterRole,
            metadata: {
              invitationId: created.invitationId,
              invitedRole: created.role
            },
            occurredAt: now.toISOString()
          });
          return created;
        }
      );
      return { token, invitation };
    } catch (error) {
      if (error instanceof StaffProvisioningError) throw error;
      if (isUniqueViolation(error)) {
        throw new StaffProvisioningError(
          "invitation_unavailable",
          "An invitation cannot be created for these details."
        );
      }
      throw error;
    }
  }

  async createRootBootstrapInvitation(input: {
    email: string;
    accessKey: string;
    requestFingerprint: string;
  }): Promise<{ token: string; invitation: StaffInvitation }> {
    if (
      !this.config.sandboxEnabled ||
      !this.config.sandboxAccessKey ||
      !constantTimeStringEqual(input.accessKey, this.config.sandboxAccessKey)
    ) {
      throw new StaffProvisioningError(
        "bootstrap_unavailable",
        "Root bootstrap is unavailable."
      );
    }

    let email: string;
    try {
      email = normalizeEmail(input.email);
    } catch (error) {
      throw new StaffProvisioningError(
        "invalid_input",
        error instanceof Error ? error.message : "Enter a valid email address."
      );
    }

    await this.enforceRateLimit({
      action: "root_bootstrap",
      bucketValue: input.requestFingerprint,
      limit: 5
    });

    const now = this.now();
    const token = createOpaqueToken();
    try {
      const invitation = await this.repository.transaction(
        async (repository) => {
          if (
            (await repository.countRoleAssignments("root")) > 0 ||
            (await repository.authentication.findAccountByEmail(email))
          ) {
            throw new StaffProvisioningError(
              "bootstrap_unavailable",
              "Root bootstrap is unavailable."
            );
          }
          const created = await this.insertInvitation({
            repository,
            email,
            role: "root",
            token,
            invitedByAccountId: null,
            now
          });
          await repository.authentication.insertSecurityEvent({
            eventId: createIdentifier("event"),
            accountId: null,
            eventType: "invitation_created",
            activeRole: "root",
            metadata: {
              invitationId: created.invitationId,
              bootstrap: true
            },
            occurredAt: now.toISOString()
          });
          return created;
        }
      );
      return { token, invitation };
    } catch (error) {
      if (error instanceof StaffProvisioningError) throw error;
      if (isUniqueViolation(error)) {
        throw new StaffProvisioningError(
          "bootstrap_unavailable",
          "Root bootstrap is unavailable."
        );
      }
      throw error;
    }
  }

  async beginEnrollment(invitationToken: string): Promise<{ token: string }> {
    const now = this.now();
    const nowIso = now.toISOString();
    const flowToken = createOpaqueToken();
    await this.repository.transaction(async (repository) => {
      const invitation = this.validateInvitation(
        await repository.findStaffInvitationByTokenHashForUpdate(
          this.invitationTokenHash(invitationToken)
        ),
        nowIso
      );
      await repository.createOrRotateStaffEnrollmentFlow({
        flowId: createIdentifier("enrollment"),
        invitationId: invitation.invitationId,
        tokenHash: this.enrollmentTokenHash(flowToken),
        expiresAt: addMilliseconds(now, ENROLLMENT_TTL_MS),
        now: nowIso
      });
    });
    return { token: combineEnrollmentTokens(invitationToken, flowToken) };
  }

  async readEnrollmentState(
    combinedToken: string
  ): Promise<StaffEnrollmentPublicState | null> {
    const nowIso = this.now().toISOString();
    try {
      return await this.repository.transaction(async (repository) => {
        const { flow, invitation } = await this.lockedEnrollmentContext({
          repository,
          combinedToken,
          nowIso
        });
        const step = publicStep(flow);
        let secret: string | null = null;
        if (step === "totp" && flow.factorId) {
          const factor = await repository.findMfaFactorForUpdate(flow.factorId);
          if (!factor || factor.status !== "pending") return null;
          try {
            secret = decryptSecret(factor.encryptedSecret, this.config.pepper);
          } catch {
            return null;
          }
        }
        return {
          step,
          email: invitation.email,
          role: invitation.role,
          expiresAt: flow.expiresAt,
          totpSecret: secret,
          otpauthUri:
            secret === null
              ? null
              : this.otpauthUri(invitation.email, secret)
        };
      });
    } catch (error) {
      if (error instanceof StaffProvisioningError) return null;
      throw error;
    }
  }

  async completeProfile(input: {
    combinedToken: string;
    displayName: string;
    password: string;
  }): Promise<StaffEnrollmentPublicState> {
    let displayName: string;
    try {
      displayName = normalizeDisplayName(input.displayName);
      validatePassword(input.password);
    } catch (error) {
      throw new StaffProvisioningError(
        "invalid_input",
        error instanceof Error ? error.message : "Check the account details."
      );
    }

    const passwordHash = await hashPassword(input.password, this.config.pepper);
    const now = this.now();
    const nowIso = now.toISOString();
    return this.repository.transaction(async (repository) => {
      const { flow, invitation } = await this.lockedEnrollmentContext({
        repository,
        combinedToken: input.combinedToken,
        nowIso
      });
      if (flow.currentStep !== "profile") {
        throw new StaffProvisioningError(
          "wrong_step",
          "This enrollment has already moved to verification."
        );
      }
      if (await repository.authentication.findAccountByEmail(invitation.email)) {
        throw new StaffProvisioningError(
          "invitation_unavailable",
          "This staff invitation can no longer create an account."
        );
      }

      const accountId = createIdentifier("account");
      await repository.authentication.insertAccount({
        accountId,
        email: invitation.email,
        phone: null,
        displayName,
        status: "pending_email",
        passwordHash,
        workerReference: null,
        now: nowIso
      });
      await repository.authentication.addRole(
        accountId,
        invitation.role,
        nowIso
      );
      await repository.authentication.updateAccountAfterEmailVerification(
        accountId,
        nowIso
      );

      const secret = createTotpSecret();
      const factorId = createIdentifier("mfa");
      await repository.insertMfaFactor({
        factorId,
        accountId,
        encryptedSecret: encryptSecret(secret, this.config.pepper),
        createdAt: nowIso
      });
      if (
        !(await repository.advanceStaffEnrollmentToTotp({
          flowId: flow.flowId,
          accountId,
          factorId,
          updatedAt: nowIso
        }))
      ) {
        throw new Error("Staff enrollment step transition failed.");
      }
      await repository.authentication.insertSecurityEvent({
        eventId: createIdentifier("event"),
        accountId,
        eventType: "password_created",
        activeRole: invitation.role,
        occurredAt: nowIso
      });
      return {
        step: "totp",
        email: invitation.email,
        role: invitation.role,
        expiresAt: flow.expiresAt,
        totpSecret: secret,
        otpauthUri: this.otpauthUri(invitation.email, secret)
      };
    });
  }

  async verifyEnrollmentTotp(input: {
    combinedToken: string;
    code: string;
  }): Promise<{ role: StaffRole }> {
    const now = this.now();
    const nowIso = now.toISOString();
    const tokens = splitEnrollmentTokens(input.combinedToken);
    await this.enforceRateLimit({
      action: "staff_invitation",
      bucketValue: this.enrollmentTokenHash(tokens.flowToken),
      limit: MAX_ENROLLMENT_ATTEMPTS
    });

    return this.repository.transaction(async (repository) => {
      const { flow, invitation } = await this.lockedEnrollmentContext({
        repository,
        combinedToken: input.combinedToken,
        nowIso
      });
      if (
        flow.currentStep !== "totp" ||
        !flow.accountId ||
        !flow.factorId
      ) {
        throw new StaffProvisioningError(
          "wrong_step",
          "Complete the account details before verifying MFA."
        );
      }

      const factor = await repository.findMfaFactorForUpdate(flow.factorId);
      if (!factor || factor.status !== "pending") {
        throw new StaffProvisioningError(
          "invalid_totp",
          "The authenticator setup can no longer be verified."
        );
      }

      let secret: string;
      try {
        secret = decryptSecret(factor.encryptedSecret, this.config.pepper);
      } catch {
        throw new StaffProvisioningError(
          "invalid_totp",
          "The authenticator setup can no longer be verified."
        );
      }

      const verified = verifyTotp({
        secret,
        code: input.code.trim(),
        now,
        lastAcceptedCounter: factor.lastAcceptedCounter
      });
      if (
        !verified.valid ||
        verified.counter === null ||
        !(await repository.activateMfaFactor({
          factorId: factor.factorId,
          acceptedCounter: verified.counter,
          activatedAt: nowIso
        }))
      ) {
        await repository.authentication.insertSecurityEvent({
          eventId: createIdentifier("event"),
          accountId: flow.accountId,
          eventType: "mfa_failed",
          activeRole: invitation.role,
          metadata: { area: "staff_enrollment" },
          occurredAt: nowIso
        });
        throw new StaffProvisioningError(
          "invalid_totp",
          "The authenticator code is incorrect, expired or already used."
        );
      }

      if (
        !(await repository.markInvitationAccepted({
          invitationId: invitation.invitationId,
          accountId: flow.accountId,
          acceptedAt: nowIso
        })) ||
        !(await repository.completeStaffEnrollment({
          flowId: flow.flowId,
          completedAt: nowIso
        }))
      ) {
        throw new Error("Staff enrollment completion failed.");
      }

      await repository.authentication.insertSecurityEvent({
        eventId: createIdentifier("event"),
        accountId: flow.accountId,
        eventType: "mfa_enrolled",
        activeRole: invitation.role,
        occurredAt: nowIso
      });
      await repository.authentication.insertSecurityEvent({
        eventId: createIdentifier("event"),
        accountId: flow.accountId,
        eventType: "invitation_accepted",
        activeRole: invitation.role,
        metadata: { invitationId: invitation.invitationId },
        occurredAt: nowIso
      });
      return { role: invitation.role };
    });
  }

  async cancelEnrollment(combinedToken: string): Promise<void> {
    const nowIso = this.now().toISOString();
    try {
      await this.repository.transaction(async (repository) => {
        const { flow } = await this.lockedEnrollmentContext({
          repository,
          combinedToken,
          nowIso
        });
        if (!["profile", "totp"].includes(flow.currentStep)) return;
        if (
          !(await repository.cancelStaffEnrollment({
            flowId: flow.flowId,
            cancelledAt: nowIso
          }))
        ) {
          return;
        }
        if (flow.accountId) {
          await repository.deleteUnfinishedStaffAccount(flow.accountId);
        }
      });
    } catch (error) {
      if (!(error instanceof StaffProvisioningError)) throw error;
    }
  }

  async listInvitations(
    inviterAccountId: string
  ): Promise<StaffInvitation[]> {
    return this.repository.listStaffInvitations(inviterAccountId);
  }
}

export async function getStaffProvisioningService(): Promise<StaffProvisioningService> {
  const environment = getServerEnvironment();
  return new StaffProvisioningService(await getAuthAccessRepository(), {
    pepper: environment.authPepper,
    sandboxEnabled: environment.authSandboxEnabled,
    sandboxAccessKey: environment.authSandboxAccessKey
  });
}
