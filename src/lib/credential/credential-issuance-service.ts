import "server-only";

import { issueCredential, transitionCredential, type CredentialIssueRequest, type CredentialStatus } from "./credential-issuance-domain";
import { CredentialIssuanceRepository } from "./credential-issuance-repository";

export class CredentialIssuanceService {
  constructor(
    private readonly repository = new CredentialIssuanceRepository(),
    private readonly signingSecret?: string
  ) {}

  async issue(request: CredentialIssueRequest, sequence: string) {
    const signingSecret = this.signingSecret ?? (await import("../config/server-environment")).getServerEnvironment().credentialSigningSecret;
    if (!signingSecret) throw new Error("Credential signing key is not configured.");
    const credential = issueCredential(request, sequence, signingSecret);
    await this.repository.save(credential);
    return credential;
  }

  async changeStatus(credentialId: string, nextStatus: CredentialStatus) {
    const current = await this.repository.findPublic(credentialId);
    if (!current) return null;

    const transitioned = transitionCredential(current, nextStatus, new Date().toISOString());
    return this.repository.updateStatus(credentialId, transitioned.status, current.version);
  }
}
