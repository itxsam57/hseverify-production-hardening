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
    const current = await this.repository.findLifecycle(input.credentialId);
    if (!current) throw new Error("Credential not found.");
    if (current.status !== input.currentStatus || current.version !== input.version) {
      throw new Error("Credential lifecycle conflict.");
    }

    const result = applyCredentialReviewAction({
      action: input.action,
      currentStatus: current.status,
      changedAt: new Date().toISOString()
    });

    const updated = await this.repository.updateStatus(input.credentialId, result.status, current.version, current.status);
    if (!updated) throw new Error("Credential lifecycle conflict.");
    return {
      credential: updated,
      livingRecordAction: input.action === "revoke"
        ? "restriction_update"
        : input.action === "suspend"
          ? "temporary_restriction_update"
          : "credential_renewal_review"
    };
  }
}
