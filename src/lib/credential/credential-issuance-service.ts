import "server-only";

import { issueCredential, transitionCredential, type CredentialIssueRequest, type CredentialStatus } from "./credential-issuance-domain";
import { CredentialIssuanceRepository } from "./credential-issuance-repository";

export class CredentialIssuanceService {
  constructor(private readonly repository = new CredentialIssuanceRepository()) {}

  async issue(request: CredentialIssueRequest, sequence: string) {
    const credential = issueCredential(request, sequence);
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
