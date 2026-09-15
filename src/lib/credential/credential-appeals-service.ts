import "server-only";

import { assertIndependentReview, submitCredentialAppeal, transitionCredentialAppeal, type CredentialAppeal } from "./credential-appeals-domain";
import { CredentialAppealsRepository } from "./credential-appeals-repository";

export class CredentialAppealsService {
  constructor(private readonly repository = new CredentialAppealsRepository()) {}

  async submit(input: { credentialId: string; workerId: string; reason: string; evidence?: readonly string[]; createdAt: string }, sequence: string): Promise<CredentialAppeal> {
    const appeal = submitCredentialAppeal(input, sequence);
    return this.repository.save(appeal);
  }

  async review(appeal: CredentialAppeal, status: CredentialAppeal["status"], reviewerId = ""): Promise<CredentialAppeal> {
    assertIndependentReview(status, reviewerId, appeal.workerId);
    return this.repository.updateStatus(transitionCredentialAppeal(appeal, status));
  }

  async reviewOutcome(appeal: CredentialAppeal, status: CredentialAppeal["status"], reviewerId = "") {
    assertIndependentReview(status, reviewerId, appeal.workerId);
    const updated = transitionCredentialAppeal(appeal, status);
    return {
      appeal: await this.repository.updateStatus(updated),
      livingRecordAction: status === "accepted" ? "review_required" : status === "rejected" ? "unchanged" : "pending"
    };
  }
}
