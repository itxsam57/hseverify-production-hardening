import "server-only";

import type { DatabaseClient } from "../database/database";

// Caller MUST hold the Company tenant row with a transaction-scoped FOR UPDATE
// (runTenantScopedCommand), shared by order submission and funding approval.
// Count completed Company-funded cases as consumed; only a cancelled order
// releases its previously pending credit claim.
export async function unreservedCompanyCreditUnits(database: DatabaseClient, tenantId: string): Promise<number> {
  const result = await database.query<{ available: number | string }>(
    `SELECT
      (SELECT COALESCE(SUM(credit_delta),0)::int
         FROM billing_credit_ledger WHERE tenant_id=$1)
      - (SELECT COALESCE(SUM(reserved_credit_units),0)::int
           FROM funding_requests WHERE tenant_id=$1 AND status='APPROVED')
      - (SELECT COUNT(*)::int
           FROM assurance_order_workers AS targets
           JOIN assurance_orders AS orders
             ON orders.order_id=targets.order_id AND orders.tenant_id=targets.tenant_id
          WHERE targets.tenant_id=$1 AND targets.funding_method='company'
            AND targets.target_status='submitted'
            AND orders.order_status IN ('SUBMITTED','PARTIALLY_FUNDED','ACTIVE','COMPLETED','CLOSED')
            -- Worker-initiated Company funding already reserves the same
            -- unit in funding_requests. Never charge its generated case twice.
            AND NOT EXISTS (
              SELECT 1 FROM worker_assessment_applications AS applications
              JOIN funding_requests AS funding
                ON funding.funding_request_id=applications.funding_request_id
               AND funding.tenant_id=targets.tenant_id
               AND funding.status='APPROVED'
              WHERE applications.assurance_order_id=targets.order_id
                AND applications.worker_account_id=targets.worker_account_id
            ))
      AS available`, [tenantId]
  );
  const available = Number(result.rows[0]?.available);
  if (!Number.isSafeInteger(available)) throw new Error("Company credit availability cannot be reconciled.");
  return available;
}
