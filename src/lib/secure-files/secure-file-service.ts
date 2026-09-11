import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import {
  bindTrustedSecureFileOwner,
  createSecureFileReservationIntent,
  type SecureFileQueryOptions,
  type SecureFileRecord
} from "./secure-file-domain";
import {
  getSecureFileRepository,
  type SecureFileRepository,
  type SecureFileReservationResult
} from "./secure-file-repository";

export class SecureFileService {
  constructor(
    private readonly repository: SecureFileRepository = getSecureFileRepository()
  ) {}

  reserveForPrincipal(input: {
    principal: AuthorizationPrincipal;
    businessReference: string;
    displayFilename: string;
  }): Promise<SecureFileReservationResult> {
    const owner = bindTrustedSecureFileOwner(input.principal);
    const intent = createSecureFileReservationIntent({
      owner,
      businessReference: input.businessReference,
      displayFilename: input.displayFilename
    });
    return this.repository.reserve(owner, intent);
  }

  listForPrincipal(
    principal: AuthorizationPrincipal,
    options?: SecureFileQueryOptions
  ): Promise<readonly SecureFileRecord[]> {
    return this.repository.listForPrincipal(principal, options);
  }

  findForPrincipal(
    principal: AuthorizationPrincipal,
    fileId: string
  ): Promise<SecureFileRecord | null> {
    return this.repository.findForPrincipal(principal, fileId);
  }
}

let service: SecureFileService | null = null;

export function getSecureFileService(): SecureFileService {
  service ??= new SecureFileService();
  return service;
}
