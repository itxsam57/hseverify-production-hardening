import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import {
  DatabaseSecureFileScanRepository,
  type SecureFileScanScheduleResult
} from "./secure-file-scan-repository";

export class SecureFileScanService {
  constructor(
    private readonly repository = new DatabaseSecureFileScanRepository()
  ) {}

  scheduleForPrincipal(input: {
    principal: AuthorizationPrincipal;
    fileRef: string;
  }): Promise<SecureFileScanScheduleResult> {
    return this.repository.scheduleForPrincipal(input);
  }
}

let service: SecureFileScanService | null = null;

export function getSecureFileScanService(): SecureFileScanService {
  service ??= new SecureFileScanService();
  return service;
}
