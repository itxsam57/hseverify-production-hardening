import "server-only";

import {
  createIdentifier,
  decryptSecret,
  hashOpaqueValue,
  hashPassword,
  normalizeEmail,
  roleRequiresMfa,
  verifyPassword,
  verifyTotp,
  type AuthRole
} from "@/lib/auth/auth-domain";
import {
  getAuthAccessRepository,
  type AuthAccessRepository
} from "@/lib/auth/auth-access-repository";
import { getServerEnvironment } from "@/lib/config/server-environment";

const SIGN_IN_WINDOW_MS = 10 * 60 * 1000;
const MAX_SIGN_IN_REQUESTS = 20;
const FAILED_ATTEMPT_LIMIT = 5;
const ACCOUNT_LOCK_MS = 15 * 60 * 1000;
const DUMMY_PASSWORD = "HSE-Verify-Timing-Only-9!Password";

let dummyPasswordHashPromise: Promise<string> | null = null;

export class AuthenticationLoginError extends Error {
  readonly code: "invalid_credentials" | "locked" | "rate_limited";
  readonly userMessage: string;

  constructor(
    code: AuthenticationLoginError["code"],
    userMessage: string
  ) {
    super(userMessage);
    this.name = "AuthenticationLoginError";
    this.code = code;
    this.userMessage = userMessage;
  }
}

function addMilliseconds(value: Date, milliseconds: number): string {
  return new Date(value.getTime() + milliseconds).toISOString();
}

function dummyPasswordHash(pepper: string): Promise<string> {
  dummyPasswordHashPromise ??= hashPassword(DUMMY_PASSWORD, pepper);
  return dummyPasswordHashPromise;
}

function genericInvalidCredentials(): AuthenticationLoginError {
  return new AuthenticationLoginError(
    "invalid_credentials",
    "The email, password or verification code is incorrect."
  );
}

export class AuthLoginService {
  constructor(
    private readonly repository: AuthAccessRepository,
    private readonly pepper: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  private requestBucket(input: {
    requestFingerprint: string;
    email: string;
    role: AuthRole;
  }): string {
    return hashOpaqueValue(
      `${input.requestFingerprint}\u0000${input.email}\u0000${input.role}`,
      this.pepper,
      "auth-sign-in-rate-limit"
    );
  }

  private async enforceRateLimit(input: {
    requestFingerprint: string;
    email: string;
    role: AuthRole;
  }): Promise<void> {
    const now = this.now();
    const attempts = await this.repository.consumeAccessRateLimit({
      action: "sign_in",
      bucketKey: this.requestBucket(input),
      now: now.toISOString(),
      resetBefore: addMilliseconds(now, -SIGN_IN_WINDOW_MS)
    });
    if (attempts > MAX_SIGN_IN_REQUESTS) {
      throw new AuthenticationLoginError(
        "rate_limited",
        "Too many sign-in attempts. Wait before trying again."
      );
    }
  }

  private async recordFailure(input: {
    repository: AuthAccessRepository;
    accountId: string;
    role: AuthRole;
    requestFingerprintHash: string;
    occurredAt: string;
  }): Promise<void> {
    const lockUntil = addMilliseconds(
      new Date(input.occurredAt),
      ACCOUNT_LOCK_MS
    );
    const account = await input.repository.authentication.recordLoginFailure({
      accountId: input.accountId,
      failedAt: input.occurredAt,
      lockAtCount: FAILED_ATTEMPT_LIMIT,
      lockUntil
    });
    await input.repository.authentication.insertSecurityEvent({
      eventId: createIdentifier("event"),
      accountId: input.accountId,
      eventType: "login_failed",
      activeRole: input.role,
      requestFingerprintHash: input.requestFingerprintHash,
      metadata: {
        failedSignInCount: account.failedSignInCount
      },
      occurredAt: input.occurredAt
    });
    if (account.status === "locked") {
      await input.repository.authentication.insertSecurityEvent({
        eventId: createIdentifier("event"),
        accountId: input.accountId,
        eventType: "account_locked",
        activeRole: input.role,
        requestFingerprintHash: input.requestFingerprintHash,
        metadata: { lockedUntil: account.lockedUntil },
        occurredAt: input.occurredAt
      });
    }
  }

  async signIn(input: {
    role: AuthRole;
    email: string;
    password: string;
    verificationCode?: string | null;
    requestFingerprint: string;
  }): Promise<{ accountId: string; role: AuthRole }> {
    let email: string;
    try {
      email = normalizeEmail(input.email);
    } catch {
      email = input.email.trim().toLowerCase().slice(0, 254);
    }
    if (!email || !input.password || input.password.length > 256) {
      throw genericInvalidCredentials();
    }

    await this.enforceRateLimit({
      requestFingerprint: input.requestFingerprint,
      email,
      role: input.role
    });

    const requestFingerprintHash = hashOpaqueValue(
      input.requestFingerprint,
      this.pepper,
      "auth-sign-in-request"
    );
    const preliminary = await this.repository.authentication.findAccountByEmail(
      email
    );
    const storedHash =
      preliminary?.passwordHash ?? (await dummyPasswordHash(this.pepper));
    const passwordMatches = await verifyPassword(
      input.password,
      storedHash,
      this.pepper
    );
    const now = this.now();
    const nowIso = now.toISOString();

    const result = await this.repository.transaction(async (repository) => {
      let account = await repository.findAccountByEmailForUpdate(email);
      if (!account) return null;

      const hasRole = await repository.hasRole(account.accountId, input.role);
      const passwordStillMatches =
        passwordMatches &&
        preliminary?.accountId === account.accountId &&
        preliminary.passwordHash === account.passwordHash;

      if (
        account.status === "locked" &&
        account.lockedUntil &&
        Date.parse(account.lockedUntil) <= now.getTime()
      ) {
        await repository.authentication.clearLoginFailures(
          account.accountId,
          nowIso
        );
        await repository.authentication.insertSecurityEvent({
          eventId: createIdentifier("event"),
          accountId: account.accountId,
          eventType: "account_unlocked",
          activeRole: input.role,
          requestFingerprintHash,
          metadata: { reason: "lock_expired" },
          occurredAt: nowIso
        });
        account = {
          ...account,
          status: "active",
          lockedUntil: null,
          failedSignInCount: 0
        };
      }

      if (account.status === "locked") {
        return passwordStillMatches && hasRole
          ? ({ locked: true } as const)
          : null;
      }

      if (
        !hasRole ||
        account.status !== "active" ||
        !account.passwordHash ||
        !passwordStillMatches
      ) {
        if (hasRole && account.status === "active") {
          await this.recordFailure({
            repository,
            accountId: account.accountId,
            role: input.role,
            requestFingerprintHash,
            occurredAt: nowIso
          });
        } else {
          await repository.authentication.insertSecurityEvent({
            eventId: createIdentifier("event"),
            accountId: account.accountId,
            eventType: "access_denied",
            activeRole: input.role,
            requestFingerprintHash,
            metadata: {
              area: "sign_in",
              reason: hasRole ? "account_state" : "role_not_assigned"
            },
            occurredAt: nowIso
          });
        }
        return null;
      }

      if (roleRequiresMfa(input.role)) {
        const factor = await repository.findActiveMfaFactorForUpdate(
          account.accountId
        );
        const verificationCode = input.verificationCode?.trim() ?? "";
        if (!factor || !/^\d{6}$/.test(verificationCode)) {
          await this.recordFailure({
            repository,
            accountId: account.accountId,
            role: input.role,
            requestFingerprintHash,
            occurredAt: nowIso
          });
          await repository.authentication.insertSecurityEvent({
            eventId: createIdentifier("event"),
            accountId: account.accountId,
            eventType: "mfa_failed",
            activeRole: input.role,
            requestFingerprintHash,
            metadata: { reason: factor ? "invalid_format" : "not_enrolled" },
            occurredAt: nowIso
          });
          return null;
        }

        let secret: string;
        try {
          secret = decryptSecret(factor.encryptedSecret, this.pepper);
        } catch {
          await repository.authentication.insertSecurityEvent({
            eventId: createIdentifier("event"),
            accountId: account.accountId,
            eventType: "mfa_failed",
            activeRole: input.role,
            requestFingerprintHash,
            metadata: { reason: "secret_unavailable" },
            occurredAt: nowIso
          });
          return null;
        }

        const verified = verifyTotp({
          secret,
          code: verificationCode,
          now,
          lastAcceptedCounter: factor.lastAcceptedCounter
        });
        if (
          !verified.valid ||
          verified.counter === null ||
          !(await repository.acceptMfaCounter({
            factorId: factor.factorId,
            acceptedCounter: verified.counter
          }))
        ) {
          await this.recordFailure({
            repository,
            accountId: account.accountId,
            role: input.role,
            requestFingerprintHash,
            occurredAt: nowIso
          });
          await repository.authentication.insertSecurityEvent({
            eventId: createIdentifier("event"),
            accountId: account.accountId,
            eventType: "mfa_failed",
            activeRole: input.role,
            requestFingerprintHash,
            metadata: { reason: "invalid_or_replayed" },
            occurredAt: nowIso
          });
          return null;
        }
        await repository.authentication.insertSecurityEvent({
          eventId: createIdentifier("event"),
          accountId: account.accountId,
          eventType: "mfa_succeeded",
          activeRole: input.role,
          requestFingerprintHash,
          occurredAt: nowIso
        });
      }

      await repository.authentication.clearLoginFailures(
        account.accountId,
        nowIso
      );
      return { accountId: account.accountId, role: input.role } as const;
    });

    if (!result) throw genericInvalidCredentials();
    if ("locked" in result) {
      throw new AuthenticationLoginError(
        "locked",
        "This account is temporarily locked. Try again later or reset the password."
      );
    }
    return result;
  }
}

export async function getAuthLoginService(): Promise<AuthLoginService> {
  const environment = getServerEnvironment();
  return new AuthLoginService(
    await getAuthAccessRepository(),
    environment.authPepper
  );
}
