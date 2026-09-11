import "server-only";

import { createHash } from "node:crypto";

import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { TrustedAuditActor } from "../audit/audit-domain";
import { getDatabaseClient, type DatabaseClient } from "../database/database";
import {
  CompanyVerificationAccessDeniedError,
  CompanyVerificationConflictError,
  CompanyVerificationNotFoundError,
  CompanyVerificationNotReadyError,
  assertCompanyVerificationDecider,
  assertCompanyVerificationManager,
  companyRegistrationFingerprint,
  createCompanyDuplicateSignalId,
  createCompanyEvidenceBindingId,
  createCompanyVerificationVersionId,
  normalizeCompanyEvidenceLabel,
  normalizeCompanyNameFingerprint,
  normalizeCompanyVerificationDraft,
  type CompanyVerificationCaseRecord,
  type CompanyVerificationDecider,
  type CompanyVerificationDraftInput,
  type CompanyVerificationEvidenceRecord,
  type CompanyVerificationManager,
  type CompanyVerificationSnapshot,
  type CompanyVerificationVersionRecord
} from "./company-verification-domain";

export const COMPANY_VERIFICATION_MANAGER_GUARD_SQL = `
SELECT sessions.session_id
FROM auth_sessions AS sessions
JOIN auth_accounts AS accounts
  ON accounts.account_id = sessions.account_id
JOIN auth_tenant_memberships AS memberships
  ON memberships.membership_id = $4
 AND memberships.tenant_id = $3
 AND memberships.account_id = sessions.account_id
 AND memberships.portal_role = 'company'
JOIN platform_tenants AS tenants
  ON tenants.tenant_id = memberships.tenant_id
WHERE sessions.session_id = $1
  AND sessions.account_id = $2
  AND sessions.active_role = 'company'
  AND accounts.account_status = 'active'
  AND sessions.revoked_at IS NULL
  AND sessions.expires_at > CURRENT_TIMESTAMP
  AND memberships.membership_status = 'active'
  AND memberships.membership_role IN ('owner', 'admin')
  AND tenants.tenant_status IN ('pending', 'active')
FOR UPDATE OF sessions, accounts, memberships, tenants`;

export const COMPANY_VERIFICATION_DECIDER_GUARD_SQL = `
SELECT sessions.session_id
FROM auth_sessions AS sessions
JOIN auth_accounts AS accounts
  ON accounts.account_id = sessions.account_id
JOIN auth_account_roles AS roles
  ON roles.account_id = sessions.account_id
 AND roles.role = sessions.active_role
WHERE sessions.session_id = $1
  AND sessions.account_id = $2
  AND sessions.active_role = $3
  AND sessions.active_role IN ('admin', 'root')
  AND accounts.account_status = 'active'
  AND sessions.revoked_at IS NULL
  AND sessions.expires_at > CURRENT_TIMESTAMP
FOR UPDATE OF sessions, accounts`;

const CASE_COLUMNS = `
  case_id, tenant_id, owner_account_id, current_version_id, case_status,
  lock_version, registration_fingerprint, legal_name_fingerprint,
  created_at, updated_at, submitted_at, verified_at, rejected_at, withdrawn_at
`;

const VERSION_COLUMNS = `
  version_id, case_id, version_number, parent_version_id, version_status,
  draft_revision, legal_name, trading_name, registration_number, country,
  industry, company_size, website, authorized_representative,
  business_email_normalized, business_phone_e164,
  terms_accepted_at, privacy_accepted_at,
  created_at, updated_at, submitted_at, terminal_at
`;

const EVIDENCE_COLUMNS = `
  binding_id, case_id, version_id, secure_file_id, evidence_label,
  binding_status, replaced_binding_id, created_at, superseded_at
`;

type DatabaseTimestamp = string | Date;

type CaseRow = {
  case_id: string;
  tenant_id: string;
  owner_account_id: string;
  current_version_id: string | null;
  case_status: CompanyVerificationCaseRecord["caseStatus"];
  lock_version: number | string;
  registration_fingerprint: string | null;
  legal_name_fingerprint: string | null;
  created_at: DatabaseTimestamp;
  updated_at: DatabaseTimestamp;
  submitted_at: DatabaseTimestamp | null;
  verified_at: DatabaseTimestamp | null;
  rejected_at: DatabaseTimestamp | null;
  withdrawn_at: DatabaseTimestamp | null;
};

type VersionRow = {
  version_id: string;
  case_id: string;
  version_number: number | string;
  parent_version_id: string | null;
  version_status: CompanyVerificationVersionRecord["versionStatus"];
  draft_revision: number | string;
  legal_name: string | null;
  trading_name: string | null;
  registration_number: string | null;
  country: string | null;
  industry: string | null;
  company_size: CompanyVerificationVersionRecord["companySize"];
  website: string | null;
  authorized_representative: string | null;
  business_email_normalized: string | null;
  business_phone_e164: string | null;
  terms_accepted_at: DatabaseTimestamp | null;
  privacy_accepted_at: DatabaseTimestamp | null;
  created_at: DatabaseTimestamp;
  updated_at: DatabaseTimestamp;
  submitted_at: DatabaseTimestamp | null;
  terminal_at: DatabaseTimestamp | null;
};

type EvidenceRow = {
  binding_id: string;
  case_id: string;
  version_id: string;
  secure_file_id: string;
  evidence_label: string;
  binding_status: "active" | "superseded";
  replaced_binding_id: string | null;
  created_at: DatabaseTimestamp;
  superseded_at: DatabaseTimestamp | null;
};

function timestamp(value: DatabaseTimestamp): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalTimestamp(value: DatabaseTimestamp | null): string | null {
  return value === null ? null : timestamp(value);
}

function caseFromRow(row: CaseRow): CompanyVerificationCaseRecord {
  if (!row.current_version_id) throw new CompanyVerificationNotFoundError();
  return Object.freeze({
    caseId: row.case_id,
    tenantId: row.tenant_id,
    ownerAccountId: row.owner_account_id,
    currentVersionId: row.current_version_id,
    caseStatus: row.case_status,
    lockVersion: Number(row.lock_version),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    submittedAt: optionalTimestamp(row.submitted_at),
    verifiedAt: optionalTimestamp(row.verified_at),
    rejectedAt: optionalTimestamp(row.rejected_at),
    withdrawnAt: optionalTimestamp(row.withdrawn_at)
  });
}

function versionFromRow(row: VersionRow): CompanyVerificationVersionRecord {
  return Object.freeze({
    versionId: row.version_id,
    caseId: row.case_id,
    versionNumber: Number(row.version_number),
    parentVersionId: row.parent_version_id,
    versionStatus: row.version_status,
    draftRevision: Number(row.draft_revision),
    legalName: row.legal_name,
    tradingName: row.trading_name,
    registrationNumber: row.registration_number,
    country: row.country,
    industry: row.industry,
    companySize: row.company_size,
    website: row.website,
    authorizedRepresentative: row.authorized_representative,
    businessEmail: row.business_email_normalized,
    businessPhone: row.business_phone_e164,
    termsAcceptedAt: optionalTimestamp(row.terms_accepted_at),
    privacyAcceptedAt: optionalTimestamp(row.privacy_accepted_at),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    submittedAt: optionalTimestamp(row.submitted_at),
    terminalAt: optionalTimestamp(row.terminal_at)
  });
}

function evidenceFromRow(row: EvidenceRow): CompanyVerificationEvidenceRecord {
  return Object.freeze({
    bindingId: row.binding_id,
    caseId: row.case_id,
    versionId: row.version_id,
    secureFileId: row.secure_file_id,
    evidenceLabel: row.evidence_label,
    status: row.binding_status,
    replacedBindingId: row.replaced_binding_id,
    createdAt: timestamp(row.created_at),
    supersededAt: optionalTimestamp(row.superseded_at)
  });
}

function legalNameFingerprint(value: string): string {
  return createHash("sha256")
    .update("hse-company-legal-name-v1\u0000")
    .update(normalizeCompanyNameFingerprint(value))
    .digest("hex");
}

async function assertLiveManager(
  database: DatabaseClient,
  managerInput: CompanyVerificationManager
): Promise<CompanyVerificationManager> {
  const manager = assertCompanyVerificationManager(managerInput);
  const result = await database.query<{ session_id: string }>(
    COMPANY_VERIFICATION_MANAGER_GUARD_SQL,
    [manager.sessionId, manager.accountId, manager.tenantId, manager.membershipId]
  );
  if (result.rows[0]?.session_id !== manager.sessionId) {
    throw new CompanyVerificationAccessDeniedError();
  }
  return manager;
}

async function assertLiveDecider(
  database: DatabaseClient,
  deciderInput: CompanyVerificationDecider
): Promise<CompanyVerificationDecider> {
  const decider = assertCompanyVerificationDecider(deciderInput);
  const result = await database.query<{ session_id: string }>(
    COMPANY_VERIFICATION_DECIDER_GUARD_SQL,
    [decider.sessionId, decider.accountId, decider.role]
  );
  if (result.rows[0]?.session_id !== decider.sessionId) {
    throw new CompanyVerificationAccessDeniedError();
  }
  return decider;
}

async function lockCaseForTenant(
  database: DatabaseClient,
  tenantId: string
): Promise<CaseRow> {
  const result = await database.query<CaseRow>(
    `SELECT ${CASE_COLUMNS}
     FROM company_verification_cases
     WHERE tenant_id = $1
     FOR UPDATE`,
    [tenantId]
  );
  const row = result.rows[0];
  if (!row || !row.current_version_id) throw new CompanyVerificationNotFoundError();
  return row;
}

async function lockCaseById(
  database: DatabaseClient,
  caseId: string
): Promise<CaseRow> {
  const result = await database.query<CaseRow>(
    `SELECT ${CASE_COLUMNS}
     FROM company_verification_cases
     WHERE case_id = $1
     FOR UPDATE`,
    [caseId]
  );
  const row = result.rows[0];
  if (!row || !row.current_version_id) throw new CompanyVerificationNotFoundError();
  return row;
}

async function lockVersion(
  database: DatabaseClient,
  versionId: string
): Promise<VersionRow> {
  const result = await database.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS}
     FROM company_verification_versions
     WHERE version_id = $1
     FOR UPDATE`,
    [versionId]
  );
  const row = result.rows[0];
  if (!row) throw new CompanyVerificationNotFoundError();
  return row;
}

async function listEvidence(
  database: DatabaseClient,
  versionId: string
): Promise<readonly CompanyVerificationEvidenceRecord[]> {
  const result = await database.query<EvidenceRow>(
    `SELECT ${EVIDENCE_COLUMNS}
     FROM company_verification_evidence
     WHERE version_id = $1
     ORDER BY created_at, binding_id`,
    [versionId]
  );
  return Object.freeze(result.rows.map(evidenceFromRow));
}

async function duplicateStatus(
  database: DatabaseClient,
  caseRow: CaseRow,
  versionId: string
): Promise<CompanyVerificationSnapshot["duplicateStatus"]> {
  if (!caseRow.registration_fingerprint || !caseRow.legal_name_fingerprint) {
    return "not_checked";
  }
  const signals = await database.query<{ signal_type: string; strength: string }>(
    `SELECT signal_type, strength
     FROM company_verification_duplicate_signals
     WHERE version_id = $1`,
    [versionId]
  );
  if (signals.rows.some((row) => row.signal_type === "registration_number")) {
    return "registration_conflict";
  }
  if (signals.rows.some((row) => row.signal_type === "legal_name")) {
    return "similar_found";
  }
  return "clear";
}

async function refreshLegalNameSignal(
  database: DatabaseClient,
  caseRow: CaseRow,
  versionId: string
): Promise<void> {
  await database.query(
    `DELETE FROM company_verification_duplicate_signals
     WHERE version_id = $1
       AND signal_type = 'legal_name'`,
    [versionId]
  );
  if (!caseRow.legal_name_fingerprint) return;
  const matching = await database.query<{ case_id: string }>(
    `SELECT case_id
     FROM company_verification_cases
     WHERE case_id <> $1
       AND legal_name_fingerprint = $2
       AND case_status NOT IN ('withdrawn', 'rejected')
     LIMIT 1`,
    [caseRow.case_id, caseRow.legal_name_fingerprint]
  );
  if (!matching.rows[0]) return;
  await database.query(
    `INSERT INTO company_verification_duplicate_signals (
       signal_id, case_id, version_id, signal_type, strength, created_at
     ) VALUES ($1, $2, $3, 'legal_name', 'similar', CURRENT_TIMESTAMP)
     ON CONFLICT (version_id, signal_type, strength) DO NOTHING`,
    [createCompanyDuplicateSignalId(), caseRow.case_id, versionId]
  );
}

export class CompanyVerificationRepository {
  constructor(
    private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()
  ) {}

  private client(): Promise<DatabaseClient> {
    return this.clientPromise;
  }

  async loadOwn(managerInput: CompanyVerificationManager): Promise<CompanyVerificationSnapshot> {
    const database = await this.client();
    return database.transaction(async (transaction) => {
      const manager = await assertLiveManager(transaction, managerInput);
      const caseRow = await lockCaseForTenant(transaction, manager.tenantId);
      const versionRow = await lockVersion(transaction, caseRow.current_version_id!);
      if (versionRow.case_id !== caseRow.case_id) throw new CompanyVerificationNotFoundError();
      return Object.freeze({
        case: caseFromRow(caseRow),
        currentVersion: versionFromRow(versionRow),
        evidence: await listEvidence(transaction, versionRow.version_id),
        duplicateStatus: await duplicateStatus(transaction, caseRow, versionRow.version_id)
      });
    });
  }

  async saveDraft(input: {
    manager: CompanyVerificationManager;
    actor: TrustedAuditActor;
    draft: CompanyVerificationDraftInput;
    expectedDraftRevision: number;
  }): Promise<CompanyVerificationSnapshot> {
    const normalized = normalizeCompanyVerificationDraft(input.draft);
    const database = await this.client();
    try {
      return await database.transaction(async (transaction) => {
        const manager = await assertLiveManager(transaction, input.manager);
        const caseRow = await lockCaseForTenant(transaction, manager.tenantId);
        const versionRow = await lockVersion(transaction, caseRow.current_version_id!);
        if (
          caseRow.case_status !== "draft" ||
          versionRow.version_status !== "draft" ||
          versionRow.case_id !== caseRow.case_id ||
          Number(versionRow.draft_revision) !== input.expectedDraftRevision
        ) {
          throw new CompanyVerificationConflictError();
        }

        const registrationFingerprint =
          normalized.country && normalized.registrationNumber
            ? companyRegistrationFingerprint({
                country: normalized.country,
                registrationNumber: normalized.registrationNumber
              })
            : null;
        const nameFingerprint = normalized.legalName
          ? legalNameFingerprint(normalized.legalName)
          : null;

        await transaction.query(
          `UPDATE company_verification_cases
           SET registration_fingerprint = $2,
               legal_name_fingerprint = $3,
               updated_at = CURRENT_TIMESTAMP
           WHERE case_id = $1`,
          [caseRow.case_id, registrationFingerprint, nameFingerprint]
        );
        const updated = await transaction.query<VersionRow>(
          `UPDATE company_verification_versions
           SET legal_name = $2,
               trading_name = $3,
               registration_number = $4,
               country = $5,
               industry = $6,
               company_size = $7,
               website = $8,
               authorized_representative = $9,
               business_email_normalized = $10,
               business_phone_e164 = $11,
               draft_revision = draft_revision + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE version_id = $1
             AND version_status = 'draft'
             AND draft_revision = $12
           RETURNING ${VERSION_COLUMNS}`,
          [
            versionRow.version_id,
            normalized.legalName,
            normalized.tradingName,
            normalized.registrationNumber,
            normalized.country,
            normalized.industry,
            normalized.companySize,
            normalized.website,
            normalized.authorizedRepresentative,
            manager.verifiedEmail,
            normalized.businessPhone,
            input.expectedDraftRevision
          ]
        );
        const saved = updated.rows[0];
        if (!saved) throw new CompanyVerificationConflictError();

        const refreshedCase = await lockCaseForTenant(transaction, manager.tenantId);
        await refreshLegalNameSignal(transaction, refreshedCase, saved.version_id);
        const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
        await audit.append(input.actor, {
          action: "company_verification.updated",
          outcome: "succeeded",
          target: { type: "company_verification", reference: refreshedCase.case_id },
          metadata: { versionNumber: Number(saved.version_number), draftRevision: Number(saved.draft_revision) }
        });
        return Object.freeze({
          case: caseFromRow(refreshedCase),
          currentVersion: versionFromRow(saved),
          evidence: await listEvidence(transaction, saved.version_id),
          duplicateStatus: await duplicateStatus(transaction, refreshedCase, saved.version_id)
        });
      });
    } catch (error) {
      const candidate = error as { code?: unknown; message?: unknown };
      if (
        candidate?.code === "23505" ||
        (typeof candidate?.message === "string" && /company_verification_registration_claim_idx|duplicate key/i.test(candidate.message))
      ) {
        throw new CompanyVerificationConflictError(
          "A matching Company registration is already claimed by another application."
        );
      }
      throw error;
    }
  }

  async bindEvidence(input: {
    manager: CompanyVerificationManager;
    actor: TrustedAuditActor;
    secureFileId: string;
    evidenceLabel: string;
    expectedActiveBindingId: string | null;
  }): Promise<CompanyVerificationEvidenceRecord> {
    const label = normalizeCompanyEvidenceLabel(input.evidenceLabel);
    const database = await this.client();
    return database.transaction(async (transaction) => {
      const manager = await assertLiveManager(transaction, input.manager);
      const caseRow = await lockCaseForTenant(transaction, manager.tenantId);
      const versionRow = await lockVersion(transaction, caseRow.current_version_id!);
      if (caseRow.case_status !== "draft" || versionRow.version_status !== "draft") {
        throw new CompanyVerificationConflictError("Submitted Company evidence cannot be changed.");
      }

      const file = await transaction.query<{ file_id: string }>(
        `SELECT file_id
         FROM platform_secure_files
         WHERE file_id = $1
           AND owner_account_id = $2
           AND owner_role = 'company'
           AND tenant_id = $3
           AND membership_id = $4
           AND lifecycle_status = 'available'
         FOR UPDATE`,
        [input.secureFileId, manager.accountId, manager.tenantId, manager.membershipId]
      );
      if (!file.rows[0]) throw new CompanyVerificationAccessDeniedError();

      const current = await transaction.query<EvidenceRow>(
        `SELECT ${EVIDENCE_COLUMNS}
         FROM company_verification_evidence
         WHERE version_id = $1
           AND evidence_label = $2
           AND binding_status = 'active'
         FOR UPDATE`,
        [versionRow.version_id, label]
      );
      const existing = current.rows[0];
      if (existing?.secure_file_id === input.secureFileId) {
        return evidenceFromRow(existing);
      }
      if ((existing?.binding_id ?? null) !== input.expectedActiveBindingId) {
        throw new CompanyVerificationConflictError();
      }
      if (existing) {
        await transaction.query(
          `UPDATE company_verification_evidence
           SET binding_status = 'superseded', superseded_at = CURRENT_TIMESTAMP
           WHERE binding_id = $1
             AND binding_status = 'active'`,
          [existing.binding_id]
        );
      }
      const inserted = await transaction.query<EvidenceRow>(
        `INSERT INTO company_verification_evidence (
           binding_id, case_id, version_id, secure_file_id, evidence_label,
           binding_status, replaced_binding_id, created_at
         ) VALUES ($1, $2, $3, $4, $5, 'active', $6, CURRENT_TIMESTAMP)
         RETURNING ${EVIDENCE_COLUMNS}`,
        [
          createCompanyEvidenceBindingId(),
          caseRow.case_id,
          versionRow.version_id,
          input.secureFileId,
          label,
          existing?.binding_id ?? null
        ]
      );
      const row = inserted.rows[0];
      if (!row) throw new CompanyVerificationConflictError();
      const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
      await audit.append(input.actor, {
        action: "company_verification.evidence.bound",
        outcome: "succeeded",
        target: { type: "company_verification", reference: caseRow.case_id },
        metadata: { versionNumber: Number(versionRow.version_number), evidenceLabel: label }
      });
      return evidenceFromRow(row);
    });
  }

  async submit(input: {
    manager: CompanyVerificationManager;
    actor: TrustedAuditActor;
    expectedLockVersion: number;
  }): Promise<CompanyVerificationSnapshot> {
    const database = await this.client();
    return database.transaction(async (transaction) => {
      const manager = await assertLiveManager(transaction, input.manager);
      const caseRow = await lockCaseForTenant(transaction, manager.tenantId);
      const versionRow = await lockVersion(transaction, caseRow.current_version_id!);
      if (
        caseRow.case_status !== "draft" ||
        versionRow.version_status !== "draft" ||
        Number(caseRow.lock_version) !== input.expectedLockVersion
      ) {
        throw new CompanyVerificationConflictError();
      }

      const requirements: string[] = [];
      const requiredFields: Array<[string, unknown]> = [
        ["Legal name", versionRow.legal_name],
        ["Trading name", versionRow.trading_name],
        ["Registration number", versionRow.registration_number],
        ["Country", versionRow.country],
        ["Industry", versionRow.industry],
        ["Company size", versionRow.company_size],
        ["Website", versionRow.website],
        ["Authorized representative", versionRow.authorized_representative],
        ["Business email", versionRow.business_email_normalized],
        ["Business phone", versionRow.business_phone_e164],
        ["Terms acceptance", versionRow.terms_accepted_at],
        ["Privacy acceptance", versionRow.privacy_accepted_at]
      ];
      for (const [label, value] of requiredFields) {
        if (value === null || value === "") requirements.push(label);
      }

      const evidence = await transaction.query<{ binding_id: string }>(
        `SELECT evidence.binding_id
         FROM company_verification_evidence AS evidence
         JOIN platform_secure_files AS files
           ON files.file_id = evidence.secure_file_id
         WHERE evidence.version_id = $1
           AND evidence.binding_status = 'active'
           AND files.owner_account_id = $2
           AND files.owner_role = 'company'
           AND files.tenant_id = $3
           AND files.membership_id = $4
           AND files.lifecycle_status = 'available'
         FOR UPDATE OF evidence, files`,
        [versionRow.version_id, manager.accountId, manager.tenantId, manager.membershipId]
      );
      if (evidence.rows.length < 1) requirements.push("Company evidence");
      if (requirements.length > 0) {
        throw new CompanyVerificationNotReadyError(
          Object.freeze(requirements),
          `Complete ${requirements.join(", ")} before submitting.`
        );
      }

      await refreshLegalNameSignal(transaction, caseRow, versionRow.version_id);
      const nowResult = await transaction.query<{ now: DatabaseTimestamp }>(
        `SELECT CURRENT_TIMESTAMP AS now`
      );
      const now = timestamp(nowResult.rows[0]!.now);
      const versionUpdate = await transaction.query<VersionRow>(
        `UPDATE company_verification_versions
         SET version_status = 'submitted', submitted_at = $2, updated_at = $2
         WHERE version_id = $1
           AND version_status = 'draft'
         RETURNING ${VERSION_COLUMNS}`,
        [versionRow.version_id, now]
      );
      const submittedVersion = versionUpdate.rows[0];
      if (!submittedVersion) throw new CompanyVerificationConflictError();
      const caseUpdate = await transaction.query<CaseRow>(
        `UPDATE company_verification_cases
         SET case_status = 'submitted',
             lock_version = lock_version + 1,
             submitted_at = $2,
             updated_at = $2
         WHERE case_id = $1
           AND case_status = 'draft'
           AND lock_version = $3
         RETURNING ${CASE_COLUMNS}`,
        [caseRow.case_id, now, input.expectedLockVersion]
      );
      const submittedCase = caseUpdate.rows[0];
      if (!submittedCase) throw new CompanyVerificationConflictError();
      const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
      await audit.append(input.actor, {
        action: "company_verification.submitted",
        outcome: "succeeded",
        target: { type: "company_verification", reference: caseRow.case_id },
        metadata: { versionNumber: Number(submittedVersion.version_number) }
      });
      return Object.freeze({
        case: caseFromRow(submittedCase),
        currentVersion: versionFromRow(submittedVersion),
        evidence: await listEvidence(transaction, submittedVersion.version_id),
        duplicateStatus: await duplicateStatus(transaction, submittedCase, submittedVersion.version_id)
      });
    });
  }

  async withdraw(input: {
    manager: CompanyVerificationManager;
    actor: TrustedAuditActor;
    expectedLockVersion: number;
  }): Promise<CompanyVerificationSnapshot> {
    const database = await this.client();
    return database.transaction(async (transaction) => {
      const manager = await assertLiveManager(transaction, input.manager);
      const caseRow = await lockCaseForTenant(transaction, manager.tenantId);
      const versionRow = await lockVersion(transaction, caseRow.current_version_id!);
      if (
        caseRow.case_status !== "submitted" ||
        versionRow.version_status !== "submitted" ||
        Number(caseRow.lock_version) !== input.expectedLockVersion
      ) {
        throw new CompanyVerificationConflictError(
          "A Company application can be withdrawn only before review begins."
        );
      }
      const nowResult = await transaction.query<{ now: DatabaseTimestamp }>(`SELECT CURRENT_TIMESTAMP AS now`);
      const now = timestamp(nowResult.rows[0]!.now);
      const versionUpdate = await transaction.query<VersionRow>(
        `UPDATE company_verification_versions
         SET version_status = 'withdrawn', terminal_at = $2, updated_at = $2
         WHERE version_id = $1
           AND version_status = 'submitted'
         RETURNING ${VERSION_COLUMNS}`,
        [versionRow.version_id, now]
      );
      const caseUpdate = await transaction.query<CaseRow>(
        `UPDATE company_verification_cases
         SET case_status = 'withdrawn',
             lock_version = lock_version + 1,
             withdrawn_at = $2,
             registration_fingerprint = NULL,
             updated_at = $2
         WHERE case_id = $1
           AND case_status = 'submitted'
           AND lock_version = $3
         RETURNING ${CASE_COLUMNS}`,
        [caseRow.case_id, now, input.expectedLockVersion]
      );
      if (!versionUpdate.rows[0] || !caseUpdate.rows[0]) {
        throw new CompanyVerificationConflictError();
      }
      const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
      await audit.append(input.actor, {
        action: "company_verification.withdrawn",
        outcome: "succeeded",
        target: { type: "company_verification", reference: caseRow.case_id },
        metadata: { versionNumber: Number(versionRow.version_number) }
      });
      return Object.freeze({
        case: caseFromRow(caseUpdate.rows[0]),
        currentVersion: versionFromRow(versionUpdate.rows[0]),
        evidence: await listEvidence(transaction, versionRow.version_id),
        duplicateStatus: "clear" as const
      });
    });
  }

  async startCorrection(input: {
    manager: CompanyVerificationManager;
    actor: TrustedAuditActor;
    expectedLockVersion: number;
  }): Promise<CompanyVerificationSnapshot> {
    const database = await this.client();
    return database.transaction(async (transaction) => {
      const manager = await assertLiveManager(transaction, input.manager);
      const caseRow = await lockCaseForTenant(transaction, manager.tenantId);
      const current = await lockVersion(transaction, caseRow.current_version_id!);
      if (
        caseRow.case_status !== "changes_requested" ||
        current.version_status !== "changes_requested" ||
        Number(caseRow.lock_version) !== input.expectedLockVersion
      ) {
        throw new CompanyVerificationConflictError();
      }
      const maxVersion = await transaction.query<{ next_number: number | string }>(
        `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_number
         FROM company_verification_versions
         WHERE case_id = $1`,
        [caseRow.case_id]
      );
      const nextNumber = Number(maxVersion.rows[0]?.next_number ?? 0);
      if (!Number.isSafeInteger(nextNumber) || nextNumber < 2) {
        throw new CompanyVerificationConflictError();
      }
      const nextVersionId = createCompanyVerificationVersionId();
      const inserted = await transaction.query<VersionRow>(
        `INSERT INTO company_verification_versions (
           version_id, case_id, version_number, parent_version_id,
           version_status, draft_revision,
           legal_name, trading_name, registration_number, country, industry,
           company_size, website, authorized_representative,
           business_email_normalized, business_phone_e164,
           terms_accepted_at, privacy_accepted_at, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, 'draft', 0,
           $5, $6, $7, $8, $9,
           $10, $11, $12,
           $13, $14,
           $15, $16, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         )
         RETURNING ${VERSION_COLUMNS}`,
        [
          nextVersionId,
          caseRow.case_id,
          nextNumber,
          current.version_id,
          current.legal_name,
          current.trading_name,
          current.registration_number,
          current.country,
          current.industry,
          current.company_size,
          current.website,
          current.authorized_representative,
          manager.verifiedEmail,
          current.business_phone_e164,
          current.terms_accepted_at,
          current.privacy_accepted_at
        ]
      );
      const version = inserted.rows[0];
      if (!version) throw new CompanyVerificationConflictError();
      const caseUpdate = await transaction.query<CaseRow>(
        `UPDATE company_verification_cases
         SET current_version_id = $2,
             case_status = 'draft',
             lock_version = lock_version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE case_id = $1
           AND case_status = 'changes_requested'
           AND lock_version = $3
         RETURNING ${CASE_COLUMNS}`,
        [caseRow.case_id, nextVersionId, input.expectedLockVersion]
      );
      if (!caseUpdate.rows[0]) throw new CompanyVerificationConflictError();
      const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
      await audit.append(input.actor, {
        action: "company_verification.status.changed",
        outcome: "succeeded",
        target: { type: "company_verification", reference: caseRow.case_id },
        metadata: { from: "changes_requested", to: "draft", versionNumber: nextNumber }
      });
      return Object.freeze({
        case: caseFromRow(caseUpdate.rows[0]),
        currentVersion: versionFromRow(version),
        evidence: Object.freeze([]),
        duplicateStatus: await duplicateStatus(transaction, caseUpdate.rows[0], version.version_id)
      });
    });
  }

  async beginReview(input: {
    decider: CompanyVerificationDecider;
    actor: TrustedAuditActor;
    caseId: string;
  }): Promise<void> {
    const database = await this.client();
    await database.transaction(async (transaction) => {
      await assertLiveDecider(transaction, input.decider);
      const caseRow = await lockCaseById(transaction, input.caseId);
      if (caseRow.case_status !== "submitted") throw new CompanyVerificationConflictError();
      const updated = await transaction.query(
        `UPDATE company_verification_cases
         SET case_status = 'under_review', lock_version = lock_version + 1, updated_at = CURRENT_TIMESTAMP
         WHERE case_id = $1 AND case_status = 'submitted'`,
        [caseRow.case_id]
      );
      if (updated.affectedRows !== 1) throw new CompanyVerificationConflictError();
      const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
      await audit.append(input.actor, {
        action: "company_verification.status.changed",
        outcome: "succeeded",
        target: { type: "company_verification", reference: caseRow.case_id },
        metadata: { from: "submitted", to: "under_review" }
      });
    });
  }

  async decide(input: {
    decider: CompanyVerificationDecider;
    actor: TrustedAuditActor;
    caseId: string;
    outcome: "verified" | "changes_requested" | "rejected";
  }): Promise<void> {
    const database = await this.client();
    await database.transaction(async (transaction) => {
      await assertLiveDecider(transaction, input.decider);
      const caseRow = await lockCaseById(transaction, input.caseId);
      const versionRow = await lockVersion(transaction, caseRow.current_version_id!);
      if (caseRow.case_status !== "under_review" || versionRow.version_status !== "submitted") {
        throw new CompanyVerificationConflictError();
      }
      const nowResult = await transaction.query<{ now: DatabaseTimestamp }>(`SELECT CURRENT_TIMESTAMP AS now`);
      const now = timestamp(nowResult.rows[0]!.now);
      const versionUpdate = await transaction.query(
        `UPDATE company_verification_versions
         SET version_status = $2, terminal_at = $3, updated_at = $3
         WHERE version_id = $1
           AND version_status = 'submitted'`,
        [versionRow.version_id, input.outcome, now]
      );
      if (versionUpdate.affectedRows !== 1) throw new CompanyVerificationConflictError();
      const caseUpdate = await transaction.query(
        `UPDATE company_verification_cases
         SET case_status = $2,
             lock_version = lock_version + 1,
             verified_at = CASE WHEN $2 = 'verified' THEN $3::timestamptz ELSE verified_at END,
             rejected_at = CASE WHEN $2 = 'rejected' THEN $3::timestamptz ELSE rejected_at END,
             updated_at = $3
         WHERE case_id = $1
           AND case_status = 'under_review'`,
        [caseRow.case_id, input.outcome, now]
      );
      if (caseUpdate.affectedRows !== 1) throw new CompanyVerificationConflictError();
      if (input.outcome === "verified") {
        const tenant = await transaction.query(
          `UPDATE platform_tenants
           SET tenant_status = 'active',
               activated_at = $2,
               updated_at = $2
           WHERE tenant_id = $1
             AND tenant_status = 'pending'
             AND activated_at IS NULL`,
          [caseRow.tenant_id, now]
        );
        if (tenant.affectedRows !== 1) throw new CompanyVerificationConflictError();
      }
      const audit = new DatabaseAuditRepository(Promise.resolve(transaction));
      await audit.append(input.actor, {
        action: "company_verification.status.changed",
        outcome: "succeeded",
        target: { type: "company_verification", reference: caseRow.case_id },
        metadata: { from: "under_review", to: input.outcome, versionNumber: Number(versionRow.version_number) }
      });
    });
  }
}

let repository: CompanyVerificationRepository | null = null;

export function getCompanyVerificationRepository(): CompanyVerificationRepository {
  repository ??= new CompanyVerificationRepository();
  return repository;
}
