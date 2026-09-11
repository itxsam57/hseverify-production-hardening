import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { getServerEnvironment } from "../config/server-environment";
import { getDatabaseClient, type DatabaseClient } from "../database/database";
import {
  authorizeSecureFileAccessCore,
  readSecureFileAccessCore,
  type SecureFileAccessLookup
} from "../secure-files/secure-file-access-core";
import { createLocalTestPrivateObjectStorage } from "../secure-files/private-object-storage";
import type { SecureFileRecord } from "../secure-files/secure-file-domain";
import {
  CompanyVerificationAccessDeniedError,
  bindCompanyVerificationDecider,
  type CompanyVerificationCaseStatus,
  type CompanyVerificationDecider
} from "./company-verification-domain";
import { COMPANY_VERIFICATION_DECIDER_GUARD_SQL } from "./company-verification-repository";

export type CompanyVerificationReviewEvidence = Readonly<{
  fileId: string;
  evidenceLabel: string;
  displayFilename: string;
  lifecycleStatus: SecureFileRecord["lifecycleStatus"];
  detectedMime: SecureFileRecord["detectedMime"];
  byteSize: number | null;
}>;

export type CompanyVerificationReviewCase = Readonly<{
  caseId: string;
  tenantId: string;
  caseStatus: Extract<CompanyVerificationCaseStatus, "submitted" | "under_review">;
  lockVersion: number;
  versionNumber: number;
  legalName: string;
  tradingName: string;
  registrationNumber: string;
  country: string;
  industry: string;
  companySize: string;
  website: string;
  authorizedRepresentative: string;
  businessEmail: string;
  businessPhone: string;
  submittedAt: string | null;
  evidence: readonly CompanyVerificationReviewEvidence[];
}>;

type ReviewCaseRow = {
  case_id: string;
  tenant_id: string;
  case_status: "submitted" | "under_review";
  lock_version: number | string;
  version_number: number | string;
  legal_name: string | null;
  trading_name: string | null;
  registration_number: string | null;
  country: string | null;
  industry: string | null;
  company_size: string | null;
  website: string | null;
  authorized_representative: string | null;
  business_email_normalized: string | null;
  business_phone_e164: string | null;
  submitted_at: string | Date | null;
};

type EvidenceRow = {
  case_id: string;
  secure_file_id: string;
  evidence_label: string;
  display_filename: string;
  lifecycle_status: SecureFileRecord["lifecycleStatus"];
  detected_mime: SecureFileRecord["detectedMime"];
  byte_size: number | string | null;
};

type PreviewFileRow = {
  file_sequence: number | string;
  file_id: string;
  schema_version: number | string;
  reservation_key: string;
  owner_account_id: string;
  owner_role: SecureFileRecord["ownerRole"];
  tenant_id: string | null;
  membership_id: string | null;
  storage_adapter_key: SecureFileRecord["storageAdapterKey"];
  object_key: string;
  display_filename: string;
  lifecycle_status: SecureFileRecord["lifecycleStatus"];
  file_extension: SecureFileRecord["fileExtension"];
  declared_mime: SecureFileRecord["declaredMime"];
  detected_mime: SecureFileRecord["detectedMime"];
  byte_size: number | string | null;
  content_sha256: string | null;
  quarantined_at: string | Date | null;
  available_at: string | Date | null;
  unsafe_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalIso(value: string | Date | null): string | null {
  return value === null ? null : iso(value);
}

async function assertLiveDecider(
  database: DatabaseClient,
  principal: AuthorizationPrincipal
): Promise<CompanyVerificationDecider> {
  const decider = bindCompanyVerificationDecider(principal);
  const result = await database.query<{ session_id: string }>(
    COMPANY_VERIFICATION_DECIDER_GUARD_SQL,
    [decider.sessionId, decider.accountId, decider.role]
  );
  if (result.rows[0]?.session_id !== decider.sessionId) {
    throw new CompanyVerificationAccessDeniedError();
  }
  return decider;
}

function secureFileFromRow(fileRow: PreviewFileRow): SecureFileRecord {
  if (Number(fileRow.schema_version) !== 1) {
    throw new CompanyVerificationAccessDeniedError();
  }
  return Object.freeze({
    sequence: Number(fileRow.file_sequence),
    fileId: fileRow.file_id,
    schemaVersion: 1,
    reservationKey: fileRow.reservation_key,
    ownerAccountId: fileRow.owner_account_id,
    ownerRole: fileRow.owner_role,
    tenantId: fileRow.tenant_id,
    membershipId: fileRow.membership_id,
    storageAdapterKey: fileRow.storage_adapter_key,
    objectKey: fileRow.object_key,
    displayFilename: fileRow.display_filename,
    lifecycleStatus: fileRow.lifecycle_status,
    fileExtension: fileRow.file_extension,
    declaredMime: fileRow.declared_mime,
    detectedMime: fileRow.detected_mime,
    byteSize: fileRow.byte_size === null ? null : Number(fileRow.byte_size),
    contentSha256: fileRow.content_sha256,
    quarantinedAt: optionalIso(fileRow.quarantined_at),
    availableAt: optionalIso(fileRow.available_at),
    unsafeAt: optionalIso(fileRow.unsafe_at),
    createdAt: iso(fileRow.created_at),
    updatedAt: iso(fileRow.updated_at)
  });
}

export class CompanyVerificationReviewService {
  constructor(private readonly database: DatabaseClient) {}

  async listForReview(
    principal: AuthorizationPrincipal
  ): Promise<readonly CompanyVerificationReviewCase[]> {
    await assertLiveDecider(this.database, principal);
    const cases = await this.database.query<ReviewCaseRow>(
      `SELECT
         cases.case_id,
         cases.tenant_id,
         cases.case_status,
         cases.lock_version,
         versions.version_number,
         versions.legal_name,
         versions.trading_name,
         versions.registration_number,
         versions.country,
         versions.industry,
         versions.company_size,
         versions.website,
         versions.authorized_representative,
         versions.business_email_normalized,
         versions.business_phone_e164,
         cases.submitted_at
       FROM company_verification_cases AS cases
       JOIN company_verification_versions AS versions
         ON versions.version_id = cases.current_version_id
       WHERE cases.case_status IN ('submitted', 'under_review')
         AND versions.version_status = 'submitted'
       ORDER BY
         CASE cases.case_status WHEN 'under_review' THEN 0 ELSE 1 END,
         cases.submitted_at ASC NULLS LAST,
         cases.case_id ASC
       LIMIT 250`
    );
    if (cases.rows.length === 0) return Object.freeze([]);

    const caseIds = cases.rows.map((row) => row.case_id);
    const evidence = await this.database.query<EvidenceRow>(
      `SELECT
         evidence.case_id,
         evidence.secure_file_id,
         evidence.evidence_label,
         files.display_filename,
         files.lifecycle_status,
         files.detected_mime,
         files.byte_size
       FROM company_verification_evidence AS evidence
       JOIN company_verification_cases AS cases
         ON cases.case_id = evidence.case_id
        AND cases.current_version_id = evidence.version_id
       JOIN platform_secure_files AS files
         ON files.file_id = evidence.secure_file_id
       WHERE evidence.case_id = ANY($1::text[])
         AND evidence.binding_status = 'active'
         AND files.lifecycle_status = 'available'
         AND files.owner_role = 'company'
         AND files.tenant_id = cases.tenant_id
       ORDER BY evidence.case_id, evidence.created_at, evidence.binding_id`,
      [caseIds]
    );
    const evidenceByCase = new Map<string, CompanyVerificationReviewEvidence[]>();
    for (const row of evidence.rows) {
      const items = evidenceByCase.get(row.case_id) ?? [];
      items.push(Object.freeze({
        fileId: row.secure_file_id,
        evidenceLabel: row.evidence_label,
        displayFilename: row.display_filename,
        lifecycleStatus: row.lifecycle_status,
        detectedMime: row.detected_mime,
        byteSize: row.byte_size === null ? null : Number(row.byte_size)
      }));
      evidenceByCase.set(row.case_id, items);
    }

    return Object.freeze(cases.rows.map((row) => Object.freeze({
      caseId: row.case_id,
      tenantId: row.tenant_id,
      caseStatus: row.case_status,
      lockVersion: Number(row.lock_version),
      versionNumber: Number(row.version_number),
      legalName: row.legal_name ?? "",
      tradingName: row.trading_name ?? "",
      registrationNumber: row.registration_number ?? "",
      country: row.country ?? "",
      industry: row.industry ?? "",
      companySize: row.company_size ?? "",
      website: row.website ?? "",
      authorizedRepresentative: row.authorized_representative ?? "",
      businessEmail: row.business_email_normalized ?? "",
      businessPhone: row.business_phone_e164 ?? "",
      submittedAt: optionalIso(row.submitted_at),
      evidence: Object.freeze(evidenceByCase.get(row.case_id) ?? [])
    })));
  }

  async previewEvidence(
    principal: AuthorizationPrincipal,
    caseId: string,
    fileId: string,
    now = new Date()
  ) {
    await assertLiveDecider(this.database, principal);
    const env = getServerEnvironment();
    if (env.appEnvironment !== "development" && env.appEnvironment !== "test") {
      throw new CompanyVerificationAccessDeniedError();
    }

    const result = await this.database.query<PreviewFileRow>(
      `SELECT files.*
       FROM company_verification_cases AS cases
       JOIN company_verification_versions AS versions
         ON versions.version_id = cases.current_version_id
        AND versions.version_status = 'submitted'
       JOIN company_verification_evidence AS evidence
         ON evidence.case_id = cases.case_id
        AND evidence.version_id = cases.current_version_id
        AND evidence.binding_status = 'active'
       JOIN platform_secure_files AS files
         ON files.file_id = evidence.secure_file_id
       WHERE cases.case_id = $1
         AND cases.case_status IN ('submitted', 'under_review')
         AND files.file_id = $2
         AND files.lifecycle_status = 'available'
         AND files.owner_role = 'company'
         AND files.tenant_id = cases.tenant_id
       LIMIT 1`,
      [caseId, fileId]
    );
    const fileRow = result.rows[0];
    if (!fileRow) throw new CompanyVerificationAccessDeniedError();
    const file = secureFileFromRow(fileRow);

    const lookup: SecureFileAccessLookup = {
      findForPrincipal: async (candidate, requestedFileId) => {
        const decider = await assertLiveDecider(this.database, candidate);
        if (
          decider.accountId !== principal.accountId ||
          decider.sessionId !== principal.sessionId ||
          requestedFileId !== file.fileId
        ) {
          return null;
        }
        return file;
      }
    };
    const issued = await authorizeSecureFileAccessCore({
      principal,
      fileRef: file.fileId,
      purpose: "preview",
      signingSecret: env.sessionSecret,
      repository: lookup,
      now
    });
    return readSecureFileAccessCore({
      principal,
      token: issued.token,
      expectedPurpose: "preview",
      signingSecret: env.sessionSecret,
      repository: lookup,
      storage: createLocalTestPrivateObjectStorage(env.appEnvironment),
      now
    });
  }
}

let service: CompanyVerificationReviewService | null = null;

export async function getCompanyVerificationReviewService(): Promise<CompanyVerificationReviewService> {
  service ??= new CompanyVerificationReviewService(await getDatabaseClient());
  return service;
}
