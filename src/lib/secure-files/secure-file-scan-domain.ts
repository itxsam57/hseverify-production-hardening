import { createHash } from "node:crypto";

import {
  normalizeSecureFileReference,
  type SecureFileRecord
} from "./secure-file-domain";

export const SECURE_FILE_SCAN_JOB_TYPE = "secure_file.scan" as const;
export const SECURE_FILE_SCAN_SCHEMA_VERSION = 1 as const;
export const SECURE_FILE_SCAN_FINAL_STATUSES = ["available", "unsafe", "scan_failed"] as const;

export type SecureFileScanFinalStatus =
  (typeof SECURE_FILE_SCAN_FINAL_STATUSES)[number];

export type MalwareScanResult =
  | Readonly<{ kind: "clean"; code: "clean" }>
  | Readonly<{ kind: "malicious"; code: string }>
  | Readonly<{ kind: "retryable"; code: string; summary: string }>
  | Readonly<{ kind: "terminal"; code: string; summary: string }>;

export type SecureFileScanContext = Readonly<{
  fileRef: string;
  generation: number;
  attemptNumber: number;
}>;

export class SecureFileScanContractError extends Error {
  constructor(message = "The secure file scan contract is invalid.") {
    super(message);
    this.name = "SecureFileScanContractError";
  }
}

export class SecureFileScanAccessDeniedError extends Error {
  constructor() {
    super("The secure file scan could not be accessed.");
    this.name = "SecureFileScanAccessDeniedError";
  }
}

export class SecureFileScanConflictError extends Error {
  constructor() {
    super("The secure file scan state is no longer compatible with this operation.");
    this.name = "SecureFileScanConflictError";
  }
}

function normalizeSafeCode(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < 2 ||
    normalized.length > 120 ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(normalized)
  ) {
    throw new SecureFileScanContractError("Scanner result code is invalid.");
  }
  return normalized;
}

function normalizeNonCleanCode(value: string): string {
  const normalized = normalizeSafeCode(value);
  if (normalized === "clean") {
    throw new SecureFileScanContractError(
      "Only a clean scanner outcome may use the clean result code."
    );
  }
  return normalized;
}

function normalizeSafeSummary(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 240 ||
    /(password|passcode|otp|totp|token|secret|cookie|authorization|credential)/i.test(normalized)
  ) {
    throw new SecureFileScanContractError("Scanner result summary is invalid.");
  }
  return normalized;
}

export function normalizeMalwareScanResult(value: MalwareScanResult): MalwareScanResult {
  if (!value || typeof value !== "object") {
    throw new SecureFileScanContractError("Scanner result is invalid.");
  }
  switch (value.kind) {
    case "clean":
      if (value.code !== "clean") {
        throw new SecureFileScanContractError("Clean scanner result is invalid.");
      }
      return Object.freeze({ kind: "clean" as const, code: "clean" as const });
    case "malicious":
      return Object.freeze({
        kind: "malicious" as const,
        code: normalizeNonCleanCode(value.code)
      });
    case "retryable":
      return Object.freeze({
        kind: "retryable" as const,
        code: normalizeNonCleanCode(value.code),
        summary: normalizeSafeSummary(value.summary)
      });
    case "terminal":
      return Object.freeze({
        kind: "terminal" as const,
        code: normalizeNonCleanCode(value.code),
        summary: normalizeSafeSummary(value.summary)
      });
  }
}

export function normalizeSecureFileScanGeneration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
    throw new SecureFileScanContractError("Secure file scan generation is invalid.");
  }
  return value;
}

export function normalizeSecureFileScanContext(
  value: SecureFileScanContext
): SecureFileScanContext {
  const fileRef = normalizeSecureFileReference(value.fileRef);
  if (
    !fileRef ||
    !Number.isSafeInteger(value.attemptNumber) ||
    value.attemptNumber < 1 ||
    value.attemptNumber > 5
  ) {
    throw new SecureFileScanContractError("Secure file scan context is invalid.");
  }
  return Object.freeze({
    fileRef,
    generation: normalizeSecureFileScanGeneration(value.generation),
    attemptNumber: value.attemptNumber
  });
}

export function deriveSecureFileScanBusinessKey(input: {
  fileRef: string;
  contentSha256: string;
  generation: number;
}): string {
  const fileRef = normalizeSecureFileReference(input.fileRef);
  if (
    !fileRef ||
    !/^[a-f0-9]{64}$/.test(input.contentSha256)
  ) {
    throw new SecureFileScanContractError("Secure file scan identity is invalid.");
  }
  const generation = normalizeSecureFileScanGeneration(input.generation);
  return `scan:${fileRef}:${input.contentSha256}:${generation}`;
}

export function computeSecureFileContentSha256(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) {
    throw new SecureFileScanContractError("Secure file scan content is empty.");
  }
  return createHash("sha256").update(bytes).digest("hex");
}

export function secureFileHasScannableProvenance(
  file: Pick<SecureFileRecord, "fileExtension" | "declaredMime" | "detectedMime" | "byteSize" | "contentSha256" | "quarantinedAt">
): boolean {
  return (
    file.fileExtension !== null &&
    file.declaredMime !== null &&
    file.detectedMime !== null &&
    file.byteSize !== null &&
    Number.isSafeInteger(file.byteSize) &&
    file.byteSize > 0 &&
    file.contentSha256 !== null &&
    /^[a-f0-9]{64}$/.test(file.contentSha256) &&
    file.quarantinedAt !== null
  );
}
