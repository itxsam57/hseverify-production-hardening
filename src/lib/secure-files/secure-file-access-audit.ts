import "server-only";

import { bindTrustedAuditActor } from "../audit/audit-domain";
import {
  DatabaseAuditRepository,
  type AuditRepository
} from "../audit/audit-repository";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import type { SecureFileAccessPurpose } from "./secure-file-access-domain";

export type SecureFileAccessAuditAction =
  | "secure_file.access.authorized"
  | "secure_file.access.served";

export async function appendSecureFileAccessAudit(input: {
  principal: AuthorizationPrincipal;
  action: SecureFileAccessAuditAction;
  fileRef: string;
  purpose: SecureFileAccessPurpose;
  expiresAt?: string;
  byteSize?: number;
  repository?: AuditRepository;
}): Promise<void> {
  const metadata: Record<string, unknown> = {
    purpose: input.purpose
  };
  if (input.expiresAt !== undefined) metadata.expiresAt = input.expiresAt;
  if (input.byteSize !== undefined) metadata.byteSize = input.byteSize;

  const repository = input.repository ?? new DatabaseAuditRepository();
  await repository.append(bindTrustedAuditActor(input.principal), {
    action: input.action,
    outcome: "succeeded",
    target: { type: "secure_file", reference: input.fileRef },
    metadata
  });
}
