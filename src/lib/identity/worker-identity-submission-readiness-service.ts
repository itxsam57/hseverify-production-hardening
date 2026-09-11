import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import type { DatabaseClient } from "../database/database";
import {
  WorkerIdentityAccessDeniedError,
  WorkerIdentityConflictError,
  WorkerIdentityContractError,
  WorkerIdentityNotFoundError,
  assertWorkerIdentityPrincipal,
  normalizeWorkerIdentityLockVersion
} from "./worker-identity-domain";
import { WORKER_IDENTITY_LIVE_SESSION_GUARD_SQL } from "./worker-identity-repository";

export type WorkerIdentitySubmissionRequirement =
  | "legal_first_name"
  | "legal_last_name"
  | "date_of_birth"
  | "nationality"
  | "country_of_residence"
  | "verified_contacts"
  | "identity_document"
  | "profile_photo"
  | "selfie";

const REQUIREMENT_LABELS: Readonly<Record<WorkerIdentitySubmissionRequirement, string>> = {
  legal_first_name: "Legal first name",
  legal_last_name: "Legal last name",
  date_of_birth: "Date of birth",
  nationality: "Nationality",
  country_of_residence: "Country of residence",
  verified_contacts: "verified account contacts",
  identity_document: "identity document",
  profile_photo: "profile photo",
  selfie: "selfie"
};

function readinessMessage(requirements: readonly WorkerIdentitySubmissionRequirement[]): string {
  const labels = requirements.map((requirement) => REQUIREMENT_LABELS[requirement]);
  if (labels.length === 1) return `Complete ${labels[0]} before submitting.`;
  return `Complete these identity requirements before submitting: ${labels.join(", ")}.`;
}

export class WorkerIdentitySubmissionNotReadyError extends WorkerIdentityContractError {
  readonly requirements: readonly WorkerIdentitySubmissionRequirement[];

  constructor(requirements: readonly WorkerIdentitySubmissionRequirement[]) {
    const stable = Object.freeze([...new Set(requirements)]);
    super(readinessMessage(stable));
    this.name = "WorkerIdentitySubmissionNotReadyError";
    this.requirements = stable;
  }
}

type SubmissionVersionKind = "initial" | "correction";

type SubmissionContextRow = {
  identity_id: string;
  identity_version_id: string;
};

type ReadinessRow = {
  lock_version: number | string;
  version_kind: string;
  version_status: string;
  legal_first_name_ready: boolean | null;
  legal_last_name_ready: boolean | null;
  date_of_birth_ready: boolean | null;
  nationality_ready: boolean | null;
  country_of_residence_ready: boolean | null;
  verified_contacts_ready: boolean | null;
  identity_document_ready: boolean;
  profile_photo_ready: boolean;
  selfie_ready: boolean;
};

const CURRENT_SUBMISSION_CONTEXT_FOR_UPDATE_SQL = `
SELECT
  identities.identity_id,
  versions.identity_version_id
FROM worker_identities AS identities
JOIN worker_identity_versions AS versions
  ON versions.identity_id = identities.identity_id
 AND versions.version_number = identities.current_version_number
WHERE identities.worker_account_id = $1
FOR UPDATE OF identities, versions`;

const CURRENT_SUBMISSION_FILE_LOCK_SQL = `
SELECT files.file_id
FROM worker_identity_evidence_bindings AS evidence
JOIN platform_secure_files AS files
  ON files.file_id = evidence.secure_file_id
WHERE evidence.identity_version_id = $1
  AND evidence.worker_account_id = $2
  AND evidence.binding_status = 'active'
FOR UPDATE OF files`;

const CURRENT_SUBMISSION_READINESS_SQL = `
SELECT
  identities.lock_version,
  versions.version_kind,
  versions.version_status,
  drafts.legal_first_name IS NOT NULL AS legal_first_name_ready,
  drafts.legal_last_name IS NOT NULL AS legal_last_name_ready,
  (drafts.date_of_birth IS NOT NULL AND drafts.date_of_birth <= CURRENT_DATE) AS date_of_birth_ready,
  drafts.nationality IS NOT NULL AS nationality_ready,
  drafts.country_of_residence IS NOT NULL AS country_of_residence_ready,
  (
    accounts.email_verified_at IS NOT NULL
    AND accounts.phone_e164 IS NOT NULL
    AND accounts.phone_verified_at IS NOT NULL
    AND drafts.verified_email_normalized = accounts.email_normalized
    AND drafts.email_verified_at = accounts.email_verified_at
    AND drafts.verified_phone_e164 = accounts.phone_e164
    AND drafts.phone_verified_at = accounts.phone_verified_at
  ) AS verified_contacts_ready,
  EXISTS (
    SELECT 1
    FROM worker_identity_evidence_bindings AS evidence
    JOIN platform_secure_files AS files
      ON files.file_id = evidence.secure_file_id
     AND files.owner_account_id = identities.worker_account_id
     AND files.owner_role = 'worker'
     AND files.tenant_id IS NULL
     AND files.membership_id IS NULL
     AND files.lifecycle_status = 'available'
    WHERE evidence.identity_version_id = versions.identity_version_id
      AND evidence.worker_account_id = identities.worker_account_id
      AND evidence.binding_status = 'active'
      AND evidence.purpose = 'identity_document'
      AND (evidence.expiry_date IS NULL OR evidence.expiry_date >= CURRENT_DATE)
  ) AS identity_document_ready,
  EXISTS (
    SELECT 1
    FROM worker_identity_evidence_bindings AS evidence
    JOIN platform_secure_files AS files
      ON files.file_id = evidence.secure_file_id
     AND files.owner_account_id = identities.worker_account_id
     AND files.owner_role = 'worker'
     AND files.tenant_id IS NULL
     AND files.membership_id IS NULL
     AND files.lifecycle_status = 'available'
     AND files.detected_mime IN ('image/png', 'image/jpeg')
    WHERE evidence.identity_version_id = versions.identity_version_id
      AND evidence.worker_account_id = identities.worker_account_id
      AND evidence.binding_status = 'active'
      AND evidence.purpose = 'profile_photo'
  ) AS profile_photo_ready,
  EXISTS (
    SELECT 1
    FROM worker_identity_evidence_bindings AS evidence
    JOIN platform_secure_files AS files
      ON files.file_id = evidence.secure_file_id
     AND files.owner_account_id = identities.worker_account_id
     AND files.owner_role = 'worker'
     AND files.tenant_id IS NULL
     AND files.membership_id IS NULL
     AND files.lifecycle_status = 'available'
     AND files.detected_mime IN ('image/png', 'image/jpeg')
    WHERE evidence.identity_version_id = versions.identity_version_id
      AND evidence.worker_account_id = identities.worker_account_id
      AND evidence.binding_status = 'active'
      AND evidence.purpose = 'selfie'
  ) AS selfie_ready
FROM worker_identities AS identities
JOIN worker_identity_versions AS versions
  ON versions.identity_id = identities.identity_id
 AND versions.version_number = identities.current_version_number
LEFT JOIN worker_identity_version_drafts AS drafts
  ON drafts.identity_version_id = versions.identity_version_id
JOIN auth_accounts AS accounts
  ON accounts.account_id = identities.worker_account_id
WHERE identities.worker_account_id = $1`;

function storedLockVersion(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("Stored Worker identity lock version is invalid.");
  }
  return parsed;
}

function missingRequirements(row: ReadinessRow): WorkerIdentitySubmissionRequirement[] {
  const missing: WorkerIdentitySubmissionRequirement[] = [];
  if (row.legal_first_name_ready !== true) missing.push("legal_first_name");
  if (row.legal_last_name_ready !== true) missing.push("legal_last_name");
  if (row.date_of_birth_ready !== true) missing.push("date_of_birth");
  if (row.nationality_ready !== true) missing.push("nationality");
  if (row.country_of_residence_ready !== true) missing.push("country_of_residence");
  if (row.verified_contacts_ready !== true) missing.push("verified_contacts");
  if (row.identity_document_ready !== true) missing.push("identity_document");
  if (row.profile_photo_ready !== true) missing.push("profile_photo");
  if (row.selfie_ready !== true) missing.push("selfie");
  return missing;
}

export class WorkerIdentitySubmissionReadinessService {
  constructor(private readonly clientPromise: Promise<DatabaseClient>) {}

  async assertOwnReady(
    principal: AuthorizationPrincipal,
    input: Readonly<{
      expectedLockVersion: number;
      expectedVersionKind: SubmissionVersionKind;
    }>
  ): Promise<void> {
    const worker = assertWorkerIdentityPrincipal(principal);
    const expectedLockVersion = normalizeWorkerIdentityLockVersion(input.expectedLockVersion);
    const database = await this.clientPromise;

    await database.transaction(async (transaction) => {
      const live = await transaction.query<{ session_id: string }>(
        WORKER_IDENTITY_LIVE_SESSION_GUARD_SQL,
        [worker.sessionId, worker.accountId]
      );
      if (live.rows.length !== 1) throw new WorkerIdentityAccessDeniedError();

      const context = await transaction.query<SubmissionContextRow>(
        CURRENT_SUBMISSION_CONTEXT_FOR_UPDATE_SQL,
        [worker.accountId]
      );
      if (context.rows.length !== 1) throw new WorkerIdentityNotFoundError();

      await transaction.query<{ file_id: string }>(CURRENT_SUBMISSION_FILE_LOCK_SQL, [
        context.rows[0].identity_version_id,
        worker.accountId
      ]);

      const result = await transaction.query<ReadinessRow>(CURRENT_SUBMISSION_READINESS_SQL, [
        worker.accountId
      ]);
      if (result.rows.length !== 1) throw new WorkerIdentityNotFoundError();
      const row = result.rows[0];
      if (storedLockVersion(row.lock_version) !== expectedLockVersion) {
        throw new WorkerIdentityConflictError();
      }
      if (row.version_status !== "draft" || row.version_kind !== input.expectedVersionKind) {
        throw new WorkerIdentityConflictError(
          "The current Worker identity version is not editable for this submission."
        );
      }

      const missing = missingRequirements(row);
      if (missing.length > 0) throw new WorkerIdentitySubmissionNotReadyError(missing);
    });
  }
}
