import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import {
  mintPublicVerificationCapability,
  verifyPublicVerificationCapability
} from "@/lib/public-verification/public-verification-capability";
import {
  mapWorkerIdentityStatusToPublicStatus,
  normalizePublicVerificationIdentifier,
  projectPublicWorkerVerification,
  type PublicWorkerVerificationProjection,
  type PublicWorkerVerificationSource
} from "@/lib/public-verification/public-verification-domain";
import {
  publicVerificationIdentifierBucketKey
} from "@/lib/public-verification/public-verification-request";
import {
  PUBLIC_VERIFICATION_CONCERN_CATEGORIES,
  type CreatePublicVerificationConcernInput,
  type CreatePublicVerificationConcernResult,
  type PublicVerificationConcernCategory,
  type PublicVerificationRateLimitAction,
  type PublicVerificationRateLimitInput
} from "@/lib/public-verification/public-verification-repository";

export type PublicVerificationStatusResult = {
  kind: "status";
  status: "not_found_or_invalid" | "temporarily_unavailable";
};

export type PublicVerificationLookupResult =
  | PublicVerificationStatusResult
  | {
      kind: "redirect";
      publicToken: string;
    };

export type PublicVerificationResolvedResult =
  | PublicVerificationStatusResult
  | {
      kind: "projection";
      projection: PublicWorkerVerificationProjection;
    };

export interface PublicVerificationRepositoryPort {
  consumeRateLimit(input: PublicVerificationRateLimitInput): Promise<number>;
  findPublicWorkerByPermanentId(
    workerId: string
  ): Promise<PublicWorkerVerificationSource | null>;
  createConcernWithAudit(
    input: CreatePublicVerificationConcernInput
  ): Promise<CreatePublicVerificationConcernResult>;
}

const HEX_64_PATTERN = /^[a-f0-9]{64}$/;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const REQUEST_LOOKUP_LIMIT = 30;
const IDENTIFIER_LOOKUP_LIMIT = 10;
const RESULT_LIMIT = 60;
const CONCERN_LIMIT = 10;
const CONCERN_NONCE_PATTERN = /^concern_nonce_[A-Za-z0-9_-]{24}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+[0-9]{7,31}$/;
const CONCERN_SUBJECT_CONTEXT = "hseverify:m1.12:public-concern-subject:v1";
const CONCERN_IDEMPOTENCY_CONTEXT = "hseverify:m1.12:public-concern-idempotency:v1";

export type PublicVerificationConcernResult =
  | PublicVerificationStatusResult
  | Readonly<{ kind: "validation_error"; message: string }>
  | Readonly<{ kind: "accepted"; concernReference: string }>;

function digestConcernValue(secret: string, context: string, value: string): string {
  return createHmac("sha256", secret)
    .update(context, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest("hex");
}

function normalizeConcernText(
  value: unknown,
  maximumLength: number
): string {
  if (typeof value !== "string" || value.length > maximumLength + 64) return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeConcernCategory(
  value: unknown
): PublicVerificationConcernCategory | null {
  return typeof value === "string" &&
    PUBLIC_VERIFICATION_CONCERN_CATEGORIES.includes(
      value as PublicVerificationConcernCategory
    )
    ? (value as PublicVerificationConcernCategory)
    : null;
}

function createPublicConcernId(): string {
  return `public_concern_${randomBytes(18).toString("base64url")}`;
}

const SAFE_MISS: PublicVerificationStatusResult = Object.freeze({
  kind: "status",
  status: "not_found_or_invalid"
});
const TEMPORARILY_UNAVAILABLE: PublicVerificationStatusResult = Object.freeze({
  kind: "status",
  status: "temporarily_unavailable"
});

function normalizeClock(now: Date): Date {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Public verification service clock is invalid.");
  }
  return now;
}

function normalizeRequestFingerprint(value: string): string {
  if (typeof value !== "string" || !HEX_64_PATTERN.test(value)) {
    throw new Error("Public verification request fingerprint is invalid.");
  }
  return value;
}

function rateInput(
  action: PublicVerificationRateLimitAction,
  bucketKey: string,
  now: Date
): PublicVerificationRateLimitInput {
  return {
    action,
    bucketKey,
    now: now.toISOString(),
    resetBefore: new Date(now.getTime() - RATE_LIMIT_WINDOW_MS).toISOString()
  };
}

export class PublicVerificationService {
  constructor(
    private readonly repository: PublicVerificationRepositoryPort,
    private readonly secret: string
  ) {
    if (typeof secret !== "string" || secret.length < 32) {
      throw new Error("Public verification service secret is invalid.");
    }
  }

  private async consume(
    action: PublicVerificationRateLimitAction,
    bucketKey: string,
    now: Date
  ): Promise<number | null> {
    try {
      return await this.repository.consumeRateLimit(
        rateInput(action, bucketKey, now)
      );
    } catch {
      return null;
    }
  }

  async lookupPublicVerification(input: {
    rawIdentifier: string;
    requestFingerprint: string;
    now?: Date;
  }): Promise<PublicVerificationLookupResult> {
    const now = normalizeClock(input.now ?? new Date());
    const requestFingerprint = normalizeRequestFingerprint(
      input.requestFingerprint
    );

    const requestCount = await this.consume(
      "lookup",
      requestFingerprint,
      now
    );
    if (requestCount === null || requestCount > REQUEST_LOOKUP_LIMIT) {
      return TEMPORARILY_UNAVAILABLE;
    }

    const identifier = normalizePublicVerificationIdentifier(
      input.rawIdentifier
    );
    if (!identifier) return SAFE_MISS;

    let identifierBucketKey: string;
    try {
      identifierBucketKey = publicVerificationIdentifierBucketKey(
        identifier.normalizedIdentifier,
        this.secret
      );
    } catch {
      return SAFE_MISS;
    }

    const identifierCount = await this.consume(
      "lookup",
      identifierBucketKey,
      now
    );
    if (identifierCount === null || identifierCount > IDENTIFIER_LOOKUP_LIMIT) {
      return TEMPORARILY_UNAVAILABLE;
    }

    if (identifier.kind !== "worker") return SAFE_MISS;

    let source: PublicWorkerVerificationSource | null;
    try {
      source = await this.repository.findPublicWorkerByPermanentId(
        identifier.normalizedIdentifier
      );
    } catch {
      return TEMPORARILY_UNAVAILABLE;
    }
    if (!source) return SAFE_MISS;

    if (
      mapWorkerIdentityStatusToPublicStatus(source.lifecycleStatus) ===
      "not_found_or_invalid"
    ) {
      return SAFE_MISS;
    }

    return {
      kind: "redirect",
      publicToken: mintPublicVerificationCapability(
        {
          identifierKind: "worker",
          normalizedIdentifier: identifier.normalizedIdentifier
        },
        this.secret,
        now
      )
    };
  }

  async resolvePublicVerificationCapability(input: {
    publicToken: string;
    requestFingerprint: string;
    now?: Date;
  }): Promise<PublicVerificationResolvedResult> {
    const now = normalizeClock(input.now ?? new Date());
    const requestFingerprint = normalizeRequestFingerprint(
      input.requestFingerprint
    );

    const resultCount = await this.consume("result", requestFingerprint, now);
    if (resultCount === null || resultCount > RESULT_LIMIT) {
      return TEMPORARILY_UNAVAILABLE;
    }

    const capability = verifyPublicVerificationCapability(
      input.publicToken,
      this.secret,
      now
    );
    if (!capability || capability.identifierKind !== "worker") {
      return SAFE_MISS;
    }

    let source: PublicWorkerVerificationSource | null;
    try {
      source = await this.repository.findPublicWorkerByPermanentId(
        capability.normalizedIdentifier
      );
    } catch {
      return TEMPORARILY_UNAVAILABLE;
    }
    if (!source) return SAFE_MISS;

    if (
      mapWorkerIdentityStatusToPublicStatus(source.lifecycleStatus) ===
      "not_found_or_invalid"
    ) {
      return SAFE_MISS;
    }

    return {
      kind: "projection",
      projection: projectPublicWorkerVerification(source, now.toISOString())
    };
  }
  async submitPublicVerificationConcern(input: {
    publicToken: string;
    requestFingerprint: string;
    category: unknown;
    description: unknown;
    contactName?: unknown;
    contactEmail?: unknown;
    contactPhone?: unknown;
    idempotencyNonce: unknown;
    now?: Date;
    [key: string]: unknown;
  }): Promise<PublicVerificationConcernResult> {
    const now = normalizeClock(input.now ?? new Date());
    let requestFingerprint: string;
    try {
      requestFingerprint = normalizeRequestFingerprint(input.requestFingerprint);
    } catch {
      return Object.freeze({
        kind: "validation_error",
        message: "Concern request metadata is invalid."
      });
    }

    const category = normalizeConcernCategory(input.category);
    const description = normalizeConcernText(input.description, 4000);
    const contactName = normalizeConcernText(input.contactName ?? "", 160) || null;
    const contactEmailRaw = normalizeConcernText(input.contactEmail ?? "", 320);
    const contactEmail = contactEmailRaw ? contactEmailRaw.toLowerCase() : null;
    const contactPhone = normalizeConcernText(input.contactPhone ?? "", 32) || null;
    const idempotencyNonce =
      typeof input.idempotencyNonce === "string" ? input.idempotencyNonce.trim() : "";

    if (
      !category ||
      description.length < 10 ||
      description.length > 4000 ||
      (contactEmail !== null && !EMAIL_PATTERN.test(contactEmail)) ||
      (contactPhone !== null && !PHONE_PATTERN.test(contactPhone)) ||
      (contactEmail === null && contactPhone === null) ||
      !CONCERN_NONCE_PATTERN.test(idempotencyNonce)
    ) {
      return Object.freeze({
        kind: "validation_error",
        message: "Check the concern details and contact information."
      });
    }

    const capability = verifyPublicVerificationCapability(
      input.publicToken,
      this.secret,
      now
    );
    if (!capability || capability.identifierKind !== "worker") {
      return SAFE_MISS;
    }

    const concernCount = await this.consume("concern", requestFingerprint, now);
    if (concernCount === null || concernCount > CONCERN_LIMIT) {
      return TEMPORARILY_UNAVAILABLE;
    }

    let source: PublicWorkerVerificationSource | null;
    try {
      source = await this.repository.findPublicWorkerByPermanentId(
        capability.normalizedIdentifier
      );
    } catch {
      return TEMPORARILY_UNAVAILABLE;
    }
    if (
      !source ||
      mapWorkerIdentityStatusToPublicStatus(source.lifecycleStatus) ===
        "not_found_or_invalid"
    ) {
      return SAFE_MISS;
    }

    const subjectReferenceHash = digestConcernValue(
      this.secret,
      CONCERN_SUBJECT_CONTEXT,
      `${capability.identifierKind}:${capability.normalizedIdentifier}`
    );
    const idempotencyKey = digestConcernValue(
      this.secret,
      CONCERN_IDEMPOTENCY_CONTEXT,
      `${subjectReferenceHash}:${idempotencyNonce}`
    );

    try {
      const concern = await this.repository.createConcernWithAudit({
        concernId: createPublicConcernId(),
        subjectReferenceHash,
        category,
        description,
        contactName,
        contactEmail,
        contactPhone,
        idempotencyKey,
        requestFingerprintHash: requestFingerprint
      });
      return Object.freeze({
        kind: "accepted",
        concernReference: concern.concernId
      });
    } catch {
      return TEMPORARILY_UNAVAILABLE;
    }
  }
}