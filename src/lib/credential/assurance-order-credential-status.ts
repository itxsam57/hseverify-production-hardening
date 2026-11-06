import "server-only";

import type { DatabaseClient } from "@/lib/database/database";
import { CURRENT_CREDENTIAL_STATUS_SQL } from "@/lib/credential/current-credential-status-sql";

/**
 * Read-only M3 credential projection for a Company-owned assurance order.
 * Call only after the Company read permission and tenant-owned order are verified.
 * Historical case decisions are deliberately not changed by credential lifecycle.
 */
export async function readAssuranceOrderCredentialStatuses(
  database: DatabaseClient,
  tenantId: string,
  orderId: string
): Promise<Record<string, string | null>> {
  const result = await database.query<{ case_id: string; credential_status: string | null }>(
    `SELECT cases.case_id,${CURRENT_CREDENTIAL_STATUS_SQL} AS credential_status
       FROM assurance_cases AS cases
       LEFT JOIN credential_issuances AS credentials
         ON credentials.credential_id=cases.credential_reference
        AND credentials.worker_id=cases.permanent_worker_id
      WHERE cases.tenant_id=$1 AND cases.order_id=$2`,
    [tenantId, orderId]
  );
  return Object.fromEntries(result.rows.map((row) => [row.case_id, row.credential_status]));
}
