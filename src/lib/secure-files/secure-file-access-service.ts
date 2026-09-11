import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { getServerEnvironment } from "../config/server-environment";
import { createLocalTestPrivateObjectStorage } from "./private-object-storage";
import { appendSecureFileAccessAudit } from "./secure-file-access-audit";
import {
  authorizeSecureFileAccessCore,
  readSecureFileAccessCore,
  type SecureFileAccessContent
} from "./secure-file-access-core";
import {
  SecureFileAccessDeniedError,
  normalizeSecureFileAccessRequest,
  normalizeSecureFileAccessPurpose,
  type IssuedSecureFileAccess,
  type SecureFileAccessPurpose
} from "./secure-file-access-domain";
import { getSecureFileRepository } from "./secure-file-repository";

function requireLocalTestStorageEnvironment(
  value: string
): "development" | "test" {
  // M1.06 has a complete local/test private-storage adapter only. Preview and
  // production must fail closed until a later real private provider exists;
  // never mint a broken authorization or reinterpret server filesystem paths
  // as production object storage.
  if (value !== "development" && value !== "test") {
    throw new SecureFileAccessDeniedError();
  }
  return value;
}

export async function authorizeSecureFileAccess(input: {
  principal: AuthorizationPrincipal;
  request: unknown;
  now?: Date;
}): Promise<IssuedSecureFileAccess> {
  const request = normalizeSecureFileAccessRequest(input.request);
  const environment = getServerEnvironment();
  requireLocalTestStorageEnvironment(environment.appEnvironment);
  const issued = await authorizeSecureFileAccessCore({
    principal: input.principal,
    fileRef: request.fileRef,
    purpose: request.purpose,
    signingSecret: environment.sessionSecret,
    repository: getSecureFileRepository(),
    now: input.now
  });
  await appendSecureFileAccessAudit({
    principal: input.principal,
    action: "secure_file.access.authorized",
    fileRef: issued.fileRef,
    purpose: issued.purpose,
    expiresAt: issued.expiresAt
  });
  return issued;
}

export async function readSecureFileAccess(input: {
  principal: AuthorizationPrincipal;
  token: string;
  expectedPurpose: SecureFileAccessPurpose;
  now?: Date;
}): Promise<SecureFileAccessContent> {
  const expectedPurpose = normalizeSecureFileAccessPurpose(input.expectedPurpose);
  const environment = getServerEnvironment();
  const storageEnvironment = requireLocalTestStorageEnvironment(
    environment.appEnvironment
  );

  const content = await readSecureFileAccessCore({
    principal: input.principal,
    token: input.token,
    expectedPurpose,
    signingSecret: environment.sessionSecret,
    repository: getSecureFileRepository(),
    storage: createLocalTestPrivateObjectStorage(storageEnvironment),
    now: input.now
  });
  await appendSecureFileAccessAudit({
    principal: input.principal,
    action: "secure_file.access.served",
    fileRef: content.fileRef,
    purpose: content.purpose,
    byteSize: content.bytes.byteLength
  });
  return content;
}
