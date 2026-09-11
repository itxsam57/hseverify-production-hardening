import "server-only";

import { createHash } from "node:crypto";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import {
  SecureFileAccessDeniedError as SecureFileRepositoryAccessDeniedError,
  deriveSecureFileObjectKey,
  normalizeSecureFileDisplayFilename,
  type SecureFileRecord
} from "./secure-file-domain";
import {
  SecureFileAccessDeniedError,
  issueSecureFileAccessToken,
  normalizeSecureFileAccessPurpose,
  verifySecureFileAccessToken,
  type IssuedSecureFileAccess,
  type SecureFileAccessPurpose
} from "./secure-file-access-domain";

export interface SecureFileAccessLookup {
  findForPrincipal(
    principal: AuthorizationPrincipal,
    fileId: string
  ): Promise<SecureFileRecord | null>;
}

export interface SecureFileAccessStorage {
  read(objectKey: string): Promise<Uint8Array | null>;
}

export type SecureFileAccessHeaders = Readonly<{
  "Content-Type": "application/pdf" | "image/png" | "image/jpeg";
  "Content-Length": string;
  "Content-Disposition": string;
  "Cache-Control": "private, no-store, max-age=0";
  Pragma: "no-cache";
  "X-Content-Type-Options": "nosniff";
  "Referrer-Policy": "no-referrer";
  "Cross-Origin-Resource-Policy": "same-origin";
}>;

export type SecureFileAccessContent = Readonly<{
  fileRef: string;
  purpose: SecureFileAccessPurpose;
  bytes: Uint8Array;
  headers: SecureFileAccessHeaders;
}>;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isAcceptedMime(
  value: SecureFileRecord["detectedMime"]
): value is "application/pdf" | "image/png" | "image/jpeg" {
  return (
    value === "application/pdf" ||
    value === "image/png" ||
    value === "image/jpeg"
  );
}

function extensionMatchesMime(file: SecureFileRecord): boolean {
  if (file.detectedMime === "application/pdf") return file.fileExtension === "pdf";
  if (file.detectedMime === "image/png") return file.fileExtension === "png";
  if (file.detectedMime === "image/jpeg") {
    return file.fileExtension === "jpg" || file.fileExtension === "jpeg";
  }
  return false;
}

function expectedExtension(
  mime: "application/pdf" | "image/png" | "image/jpeg"
): "pdf" | "png" | "jpg" {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  return "jpg";
}

function fileHasAcceptedAvailableProvenance(file: SecureFileRecord): boolean {
  return (
    file.lifecycleStatus === "available" &&
    file.availableAt !== null &&
    isAcceptedMime(file.detectedMime) &&
    extensionMatchesMime(file) &&
    file.byteSize !== null &&
    Number.isSafeInteger(file.byteSize) &&
    file.byteSize > 0 &&
    file.contentSha256 !== null &&
    /^[a-f0-9]{64}$/.test(file.contentSha256) &&
    file.storageAdapterKey === "local_test" &&
    file.objectKey === deriveSecureFileObjectKey(file.fileId)
  );
}

async function findAuthorizedFile(
  repository: SecureFileAccessLookup,
  principal: AuthorizationPrincipal,
  fileRef: string
): Promise<SecureFileRecord | null> {
  try {
    return await repository.findForPrincipal(principal, fileRef);
  } catch (error) {
    // The underlying secure-file repository intentionally owns its own denial
    // error. Translate only that expected authorization denial into the signed
    // access layer's non-enumerating denial contract; operational/database
    // failures must continue to surface as server errors rather than being
    // disguised as authorization failures.
    if (error instanceof SecureFileRepositoryAccessDeniedError) {
      throw new SecureFileAccessDeniedError();
    }
    throw error;
  }
}

function encodeRfc5987Filename(value: string): string {
  return encodeURIComponent(value)
    .replace(/['()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

export function buildSecureFileAccessHeaders(input: {
  file: SecureFileRecord;
  purpose: SecureFileAccessPurpose;
  byteSize: number;
}): SecureFileAccessHeaders {
  const purpose = normalizeSecureFileAccessPurpose(input.purpose);
  if (
    !fileHasAcceptedAvailableProvenance(input.file) ||
    !isAcceptedMime(input.file.detectedMime) ||
    !Number.isSafeInteger(input.byteSize) ||
    input.byteSize < 1 ||
    input.byteSize !== input.file.byteSize
  ) {
    throw new SecureFileAccessDeniedError();
  }

  let displayFilename: string;
  try {
    displayFilename = normalizeSecureFileDisplayFilename(
      input.file.displayFilename
    );
  } catch {
    throw new SecureFileAccessDeniedError();
  }

  const disposition = purpose === "preview" ? "inline" : "attachment";
  const fallbackName = `secure-file.${expectedExtension(input.file.detectedMime)}`;
  const encodedName = encodeRfc5987Filename(displayFilename);
  return Object.freeze({
    "Content-Type": input.file.detectedMime,
    "Content-Length": String(input.byteSize),
    "Content-Disposition": `${disposition}; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "private, no-store, max-age=0" as const,
    Pragma: "no-cache" as const,
    "X-Content-Type-Options": "nosniff" as const,
    "Referrer-Policy": "no-referrer" as const,
    "Cross-Origin-Resource-Policy": "same-origin" as const
  });
}

export async function authorizeSecureFileAccessCore(input: {
  principal: AuthorizationPrincipal;
  fileRef: string;
  purpose: SecureFileAccessPurpose;
  signingSecret: string;
  repository: SecureFileAccessLookup;
  now?: Date;
}): Promise<IssuedSecureFileAccess> {
  const purpose = normalizeSecureFileAccessPurpose(input.purpose);
  const file = await findAuthorizedFile(
    input.repository,
    input.principal,
    input.fileRef
  );
  if (!file || !fileHasAcceptedAvailableProvenance(file)) {
    throw new SecureFileAccessDeniedError();
  }
  return issueSecureFileAccessToken({
    principal: input.principal,
    fileRef: file.fileId,
    purpose,
    signingSecret: input.signingSecret,
    now: input.now
  });
}

export async function readSecureFileAccessCore(input: {
  principal: AuthorizationPrincipal;
  token: string;
  expectedPurpose: SecureFileAccessPurpose;
  signingSecret: string;
  repository: SecureFileAccessLookup;
  storage: SecureFileAccessStorage;
  now?: Date;
}): Promise<SecureFileAccessContent> {
  const expectedPurpose = normalizeSecureFileAccessPurpose(input.expectedPurpose);
  const verified = verifySecureFileAccessToken({
    principal: input.principal,
    token: input.token,
    signingSecret: input.signingSecret,
    now: input.now
  });
  if (verified.purpose !== expectedPurpose) {
    throw new SecureFileAccessDeniedError();
  }

  // Use-time lookup deliberately re-runs the accepted live session/tenant
  // authorization and owner-scope predicates before any private object read.
  const file = await findAuthorizedFile(
    input.repository,
    input.principal,
    verified.fileRef
  );
  if (!file || !fileHasAcceptedAvailableProvenance(file)) {
    throw new SecureFileAccessDeniedError();
  }

  // Missing/tampered content is a safe non-enumerating denial. A thrown storage
  // error is different: it means the trusted private-storage layer itself could
  // not perform the operation and must remain an operational server failure.
  // Do not convert that failure into a misleading authorization/not-found 404.
  const stored = await input.storage.read(file.objectKey);
  if (
    !stored ||
    stored.byteLength !== file.byteSize ||
    sha256(stored) !== file.contentSha256
  ) {
    throw new SecureFileAccessDeniedError();
  }

  const bytes = Uint8Array.from(stored);
  return Object.freeze({
    fileRef: file.fileId,
    purpose: expectedPurpose,
    bytes,
    headers: buildSecureFileAccessHeaders({
      file,
      purpose: expectedPurpose,
      byteSize: bytes.byteLength
    })
  });
}
