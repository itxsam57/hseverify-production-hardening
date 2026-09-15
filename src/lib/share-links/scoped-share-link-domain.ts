import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { DigitalPassport } from "../living-record/living-record-domain";

export const SCOPED_SHARE_FIELDS = Object.freeze([
  "worker_id",
  "qualifications",
  "skills",
  "competencies",
  "restrictions",
  "conditions",
  "next_expiry",
  "employer_detail"
] as const);

export type ScopedShareField = (typeof SCOPED_SHARE_FIELDS)[number];

export type ScopedShareLinkRecord = Readonly<{
  shareLinkId: string;
  ownerWorkerId: string;
  fields: readonly ScopedShareField[];
  purpose: string;
  employerDetail: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  tokenNonceHash: string;
}>;

export type ScopedShareAccessLog = Readonly<{
  shareLinkId: string;
  accessedAt: string;
  outcome: "granted" | "denied";
  reason: "active" | "expired" | "revoked" | "worker_mismatch";
}>;

export type ScopedShareProjection = Readonly<{
  purpose: string;
  employerDetail?: string;
  workerId?: string;
  qualifications?: readonly Readonly<{
    recordId: string;
    title: string;
    issuingOrganization: string | null;
    level: string | null;
    issueDate: string | null;
    expiryDate: string | null;
  }>[];
  skills?: readonly Readonly<{
    recordId: string;
    name: string;
    category: string | null;
    assuranceStatus: "self_declared" | "evidence_verified" | "competency_assessed";
  }>[];
  competencies?: readonly Readonly<{
    competencyId: string;
    title: string;
    status: string;
    expiresAt: string | null;
  }>[];
  restrictions?: readonly string[];
  conditions?: readonly string[];
  nextExpiryAt?: string | null;
}>;

export type ScopedShareResolveResult =
  | Readonly<{
      kind: "granted";
      shareLinkId: string;
      projection: ScopedShareProjection;
    }>
  | Readonly<{
      kind: "denied";
      reason: "invalid" | "expired" | "revoked" | "worker_mismatch";
    }>;

type TokenPayload = Readonly<{
  version: 1;
  shareLinkId: string;
  nonce: string;
}>;

const SHARE_LINK_ID_PATTERN = /^share_link_[A-Za-z0-9_-]{6,80}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;
const MAX_PURPOSE_LENGTH = 240;
const MAX_EMPLOYER_DETAIL_LENGTH = 240;

function text(value: string, label: string, maximum: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function optionalText(value: string | null | undefined, label: string, maximum: number): string | null {
  if (value == null || value.trim() === "") return null;
  return text(value, label, maximum);
}

function timestamp(value: string | Date, label: string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid.`);
  return parsed.toISOString();
}

function normalizeFields(fields: readonly ScopedShareField[]): readonly ScopedShareField[] {
  const unique = [...new Set(fields)];
  if (
    unique.length === 0 ||
    unique.some((field) => !SCOPED_SHARE_FIELDS.includes(field))
  ) {
    throw new Error("Scoped share fields are invalid.");
  }
  return Object.freeze(unique);
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function encodePayload(payload: TokenPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload, "utf8").digest("base64url");
}

function mintToken(payload: TokenPayload, secret: string): string {
  const encoded = encodePayload(payload);
  return `${encoded}.${signPayload(encoded, secret)}`;
}

function parseToken(token: string, secret: string): TokenPayload | null {
  if (typeof token !== "string" || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = Buffer.from(signPayload(parts[0], secret), "utf8");
  const received = Buffer.from(parts[1], "utf8");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<TokenPayload>;
    if (
      decoded.version !== 1 ||
      typeof decoded.shareLinkId !== "string" ||
      !SHARE_LINK_ID_PATTERN.test(decoded.shareLinkId) ||
      typeof decoded.nonce !== "string" ||
      !NONCE_PATTERN.test(decoded.nonce)
    ) {
      return null;
    }
    return Object.freeze({ version: 1, shareLinkId: decoded.shareLinkId, nonce: decoded.nonce });
  } catch {
    return null;
  }
}

function project(record: ScopedShareLinkRecord, passport: DigitalPassport): ScopedShareProjection {
  const fields = new Set(record.fields);
  const projection: {
    purpose: string;
    employerDetail?: string;
    workerId?: string;
    qualifications?: ScopedShareProjection["qualifications"];
    skills?: ScopedShareProjection["skills"];
    competencies?: ScopedShareProjection["competencies"];
    restrictions?: readonly string[];
    conditions?: readonly string[];
    nextExpiryAt?: string | null;
  } = { purpose: record.purpose };

  if (fields.has("employer_detail") && record.employerDetail) {
    projection.employerDetail = record.employerDetail;
  }
  if (fields.has("worker_id")) projection.workerId = passport.workerId;
  if (fields.has("qualifications")) {
    projection.qualifications = Object.freeze(
      passport.qualifications.map((item) => Object.freeze({
        recordId: item.recordId,
        title: item.title,
        issuingOrganization: item.issuingOrganization,
        level: item.level,
        issueDate: item.issueDate,
        expiryDate: item.expiryDate
      }))
    );
  }
  if (fields.has("skills")) {
    projection.skills = Object.freeze(
      passport.skills.map((item) => Object.freeze({
        recordId: item.recordId,
        name: item.name,
        category: item.category,
        assuranceStatus: item.assuranceStatus
      }))
    );
  }
  if (fields.has("competencies")) {
    projection.competencies = Object.freeze(
      passport.competencies.map((item) => {
        const current = item.versions.at(-1);
        if (!current) throw new Error("Living Record must contain a current version.");
        return Object.freeze({
          competencyId: item.competencyId,
          title: item.title,
          status: current.status,
          expiresAt: current.expiresAt
        });
      })
    );
  }
  if (fields.has("restrictions")) projection.restrictions = Object.freeze([...passport.activeRestrictions]);
  if (fields.has("conditions")) projection.conditions = Object.freeze([...passport.activeConditions]);
  if (fields.has("next_expiry")) projection.nextExpiryAt = passport.nextExpiryAt;

  return Object.freeze(projection);
}

export class ScopedShareLinkManager {
  private readonly links = new Map<string, ScopedShareLinkRecord>();
  private readonly accessLogs: ScopedShareAccessLog[] = [];
  private readonly secret: string;
  private readonly idFactory: () => string;
  private readonly nonceFactory: () => string;

  constructor(
    secret: string,
    idFactory: () => string = () => `share_link_${randomBytes(18).toString("base64url")}`,
    nonceFactory: () => string = () => randomBytes(24).toString("base64url")
  ) {
    if (secret.length < 32) throw new Error("Scoped share signing secret is invalid.");
    this.secret = secret;
    this.idFactory = idFactory;
    this.nonceFactory = nonceFactory;
  }

  restore(record: ScopedShareLinkRecord): void {
    if (!SHARE_LINK_ID_PATTERN.test(record.shareLinkId)) {
      throw new Error("Scoped share identifier is invalid.");
    }
    this.links.set(record.shareLinkId, Object.freeze(record));
  }

  restoreAccessLog(log: ScopedShareAccessLog): void {
    this.accessLogs.push(Object.freeze(log));
  }

  create(input: {
    ownerWorkerId: string;
    fields: readonly ScopedShareField[];
    purpose: string;
    employerDetail?: string | null;
    createdAt: string | Date;
    expiresAt?: string | Date | null;
  }): Readonly<{ record: ScopedShareLinkRecord; token: string; shareUrl: string }> {
    const shareLinkId = this.idFactory();
    const nonce = this.nonceFactory();
    if (!SHARE_LINK_ID_PATTERN.test(shareLinkId) || !NONCE_PATTERN.test(nonce)) {
      throw new Error("Scoped share identifier generation failed.");
    }
    if (this.links.has(shareLinkId)) throw new Error("Scoped share link already exists.");

    const createdAt = timestamp(input.createdAt, "Scoped share creation time");
    const expiresAt = input.expiresAt == null
      ? null
      : timestamp(input.expiresAt, "Scoped share expiry time");
    if (expiresAt !== null && expiresAt <= createdAt) {
      throw new Error("Scoped share expiry must be after creation.");
    }

    const fields = normalizeFields(input.fields);
    const employerDetail = optionalText(
      input.employerDetail,
      "Employer detail",
      MAX_EMPLOYER_DETAIL_LENGTH
    );
    if (fields.includes("employer_detail") && !employerDetail) {
      throw new Error("Employer detail is required when that field is shared.");
    }

    const record = Object.freeze({
      shareLinkId,
      ownerWorkerId: text(input.ownerWorkerId, "Worker ID", 160),
      fields,
      purpose: text(input.purpose, "Share purpose", MAX_PURPOSE_LENGTH),
      employerDetail,
      createdAt,
      expiresAt,
      revokedAt: null,
      tokenNonceHash: digest(nonce)
    });
    this.links.set(shareLinkId, record);
    const token = mintToken({ version: 1, shareLinkId, nonce }, this.secret);
    return Object.freeze({
      record,
      token,
      shareUrl: `/share/${encodeURIComponent(token)}?shareLinkId=${encodeURIComponent(shareLinkId)}`
    });
  }

  revoke(input: {
    ownerWorkerId: string;
    shareLinkId: string;
    revokedAt: string | Date;
  }): ScopedShareLinkRecord {
    const existing = this.links.get(input.shareLinkId);
    if (!existing || existing.ownerWorkerId !== input.ownerWorkerId) {
      throw new Error("Scoped share link was not found for this Worker.");
    }
    if (existing.revokedAt) return existing;
    const revokedAt = timestamp(input.revokedAt, "Scoped share revocation time");
    if (revokedAt < existing.createdAt) {
      throw new Error("Scoped share revocation cannot predate creation.");
    }
    const revoked = Object.freeze({ ...existing, revokedAt });
    this.links.set(existing.shareLinkId, revoked);
    return revoked;
  }

  resolve(input: {
    token: string;
    passport: DigitalPassport;
    accessedAt: string | Date;
  }): ScopedShareResolveResult {
    const accessedAt = timestamp(input.accessedAt, "Scoped share access time");
    const payload = parseToken(input.token, this.secret);
    if (!payload) return Object.freeze({ kind: "denied", reason: "invalid" });
    const record = this.links.get(payload.shareLinkId);
    if (!record || digest(payload.nonce) !== record.tokenNonceHash) {
      return Object.freeze({ kind: "denied", reason: "invalid" });
    }

    const deny = (reason: Exclude<ScopedShareResolveResult, { kind: "granted" }>["reason"]): ScopedShareResolveResult => {
      if (reason !== "invalid") {
        this.accessLogs.push(Object.freeze({
          shareLinkId: record.shareLinkId,
          accessedAt,
          outcome: "denied",
          reason
        }));
      }
      return Object.freeze({ kind: "denied", reason });
    };

    if (record.revokedAt) return deny("revoked");
    if (record.expiresAt && accessedAt >= record.expiresAt) return deny("expired");
    if (input.passport.workerId !== record.ownerWorkerId) return deny("worker_mismatch");

    this.accessLogs.push(Object.freeze({
      shareLinkId: record.shareLinkId,
      accessedAt,
      outcome: "granted",
      reason: "active"
    }));
    return Object.freeze({
      kind: "granted",
      shareLinkId: record.shareLinkId,
      projection: project(record, input.passport)
    });
  }

  listOwnedLinks(ownerWorkerId: string): readonly ScopedShareLinkRecord[] {
    return Object.freeze(
      [...this.links.values()].filter((record) => record.ownerWorkerId === ownerWorkerId)
    );
  }

  listAccessLogs(ownerWorkerId: string, shareLinkId: string): readonly ScopedShareAccessLog[] {
    const record = this.links.get(shareLinkId);
    if (!record || record.ownerWorkerId !== ownerWorkerId) {
      throw new Error("Scoped share link was not found for this Worker.");
    }
    return Object.freeze(this.accessLogs.filter((event) => event.shareLinkId === shareLinkId));
  }
}
