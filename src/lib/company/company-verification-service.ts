import "server-only";

import {
  bindTrustedAuditActor,
  bindTrustedCompanyApplicationAuditActor
} from "../audit/audit-domain";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import {
  bindCompanyVerificationDecider,
  bindCompanyVerificationManager,
  type CompanyVerificationDraftInput,
  type CompanyVerificationSnapshot
} from "./company-verification-domain";
import {
  getCompanyVerificationRepository,
  type CompanyVerificationRepository
} from "./company-verification-repository";

export class CompanyVerificationService {
  constructor(
    private readonly repository: CompanyVerificationRepository = getCompanyVerificationRepository()
  ) {}

  loadOwn(principal: AuthorizationPrincipal): Promise<CompanyVerificationSnapshot> {
    return this.repository.loadOwn(bindCompanyVerificationManager(principal));
  }

  saveDraft(input: {
    principal: AuthorizationPrincipal;
    draft: CompanyVerificationDraftInput;
    expectedDraftRevision: number;
  }): Promise<CompanyVerificationSnapshot> {
    return this.repository.saveDraft({
      manager: bindCompanyVerificationManager(input.principal),
      actor: bindTrustedCompanyApplicationAuditActor(input.principal),
      draft: input.draft,
      expectedDraftRevision: input.expectedDraftRevision
    });
  }

  bindEvidence(input: {
    principal: AuthorizationPrincipal;
    secureFileId: string;
    evidenceLabel: string;
    expectedActiveBindingId: string | null;
  }) {
    return this.repository.bindEvidence({
      manager: bindCompanyVerificationManager(input.principal),
      actor: bindTrustedCompanyApplicationAuditActor(input.principal),
      secureFileId: input.secureFileId,
      evidenceLabel: input.evidenceLabel,
      expectedActiveBindingId: input.expectedActiveBindingId
    });
  }

  submit(input: {
    principal: AuthorizationPrincipal;
    expectedLockVersion: number;
  }): Promise<CompanyVerificationSnapshot> {
    return this.repository.submit({
      manager: bindCompanyVerificationManager(input.principal),
      actor: bindTrustedCompanyApplicationAuditActor(input.principal),
      expectedLockVersion: input.expectedLockVersion
    });
  }

  withdraw(input: {
    principal: AuthorizationPrincipal;
    expectedLockVersion: number;
  }): Promise<CompanyVerificationSnapshot> {
    return this.repository.withdraw({
      manager: bindCompanyVerificationManager(input.principal),
      actor: bindTrustedCompanyApplicationAuditActor(input.principal),
      expectedLockVersion: input.expectedLockVersion
    });
  }

  startCorrection(input: {
    principal: AuthorizationPrincipal;
    expectedLockVersion: number;
  }): Promise<CompanyVerificationSnapshot> {
    return this.repository.startCorrection({
      manager: bindCompanyVerificationManager(input.principal),
      actor: bindTrustedCompanyApplicationAuditActor(input.principal),
      expectedLockVersion: input.expectedLockVersion
    });
  }

  beginReview(input: {
    principal: AuthorizationPrincipal;
    caseId: string;
  }): Promise<void> {
    return this.repository.beginReview({
      decider: bindCompanyVerificationDecider(input.principal),
      actor: bindTrustedAuditActor(input.principal),
      caseId: input.caseId
    });
  }

  decide(input: {
    principal: AuthorizationPrincipal;
    caseId: string;
    outcome: "verified" | "changes_requested" | "rejected";
  }): Promise<void> {
    return this.repository.decide({
      decider: bindCompanyVerificationDecider(input.principal),
      actor: bindTrustedAuditActor(input.principal),
      caseId: input.caseId,
      outcome: input.outcome
    });
  }
}

let service: CompanyVerificationService | null = null;

export function getCompanyVerificationService(): CompanyVerificationService {
  service ??= new CompanyVerificationService();
  return service;
}
