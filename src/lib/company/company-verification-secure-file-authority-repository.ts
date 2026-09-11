import "server-only";

import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import {
  SecureFileAccessDeniedError,
  assertTrustedSecureFileOwner,
  assertTrustedSecureFileReservationIntent,
  getTrustedSecureFileAuthorityMode,
  type TrustedSecureFileOwner,
  type TrustedSecureFileReservationIntent
} from "../secure-files/secure-file-domain";
import {
  DatabaseSecureFileRepository,
  type SecureFileReservationResult
} from "../secure-files/secure-file-repository";

export const COMPANY_VERIFICATION_SECURE_FILE_AUTHORITY_INSERT_SQL = `
INSERT INTO company_verification_secure_file_authorities (
  reservation_key,
  case_id,
  version_id,
  owner_account_id,
  tenant_id,
  membership_id,
  created_at
)
SELECT
  $1,
  cases.case_id,
  versions.version_id,
  $2,
  $3,
  $4,
  CURRENT_TIMESTAMP
FROM company_verification_cases AS cases
JOIN company_verification_versions AS versions
  ON versions.version_id = cases.current_version_id
 AND versions.case_id = cases.case_id
WHERE cases.tenant_id = $3
  AND cases.case_status = 'draft'
  AND versions.version_status = 'draft'
ON CONFLICT (reservation_key) DO NOTHING
RETURNING reservation_key`;

export const COMPANY_VERIFICATION_SECURE_FILE_AUTHORITY_FIND_SQL = `
SELECT reservation_key
FROM company_verification_secure_file_authorities
WHERE reservation_key = $1
  AND owner_account_id = $2
  AND tenant_id = $3
  AND membership_id = $4`;

export class CompanyVerificationSecureFileAuthorityRepository {
  constructor(
    private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()
  ) {}

  async reserve(
    ownerInput: TrustedSecureFileOwner,
    intentInput: TrustedSecureFileReservationIntent
  ): Promise<SecureFileReservationResult> {
    const owner = assertTrustedSecureFileOwner(ownerInput);
    const intent = assertTrustedSecureFileReservationIntent(intentInput);
    if (
      owner.role !== "company" ||
      !owner.tenantId ||
      !owner.membershipId ||
      getTrustedSecureFileAuthorityMode(owner) !== "company_application"
    ) {
      throw new SecureFileAccessDeniedError();
    }

    const database = await this.clientPromise;
    return database.transaction(async (transaction) => {
      const parameters = [
        intent.reservationKey,
        owner.accountId,
        owner.tenantId,
        owner.membershipId
      ] as const;
      const inserted = await transaction.query<{ reservation_key: string }>(
        COMPANY_VERIFICATION_SECURE_FILE_AUTHORITY_INSERT_SQL,
        parameters
      );
      if (!inserted.rows[0]) {
        const existing = await transaction.query<{ reservation_key: string }>(
          COMPANY_VERIFICATION_SECURE_FILE_AUTHORITY_FIND_SQL,
          parameters
        );
        if (existing.rows[0]?.reservation_key !== intent.reservationKey) {
          throw new SecureFileAccessDeniedError();
        }
      }

      const files = new DatabaseSecureFileRepository(Promise.resolve(transaction));
      return files.reserve(owner, intent);
    });
  }
}
