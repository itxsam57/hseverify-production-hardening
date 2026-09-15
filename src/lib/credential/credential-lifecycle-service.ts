import "server-only";

import { CredentialIssuanceRepository } from "./credential-issuance-repository";
import { applyCredentialReviewAction, type CredentialReviewAction } from "./credential-appeals-domain";

export class CredentialLifecycleService {
  constructor(private readonly repository = new CredentialIssuanceRepository()) {}

  async changeStatus(input: {
    credentialId: string;
    action: CredentialReviewAction;
    currentStatus: "valid" | "expired" | "suspended" | "revoked";
    version: number;
  }) {
    const result = applyCredentialReviewAction({
      action: input.action,
      currentStatus: input.currentStatus,
      changedAt: new Date().toISOString()
    });

    const updated = await this.repository.updateStatus(input.credentialId, result.status, input.version, input.currentStatus);
    if (!updated) throw new Error("Credential lifecycle conflict.");
    return updated;
  }
}
