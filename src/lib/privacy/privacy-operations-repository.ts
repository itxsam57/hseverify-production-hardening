import "server-only";

import { getDatabaseClient, type DatabaseClient } from "../database/database";

function changedRows(result: { affectedRows?: number; rowCount?: number }) {
  return result.affectedRows ?? result.rowCount ?? 0;
}

export type AccommodationReviewRow = {
  accommodation_id: string;
  tenant_id: string | null;
  worker_id: string;
  accommodation_type: string;
  details: unknown;
  status: "REQUESTED" | "APPROVED" | "DECLINED";
  case_id: string | null;
  review_reason: string | null;
  reviewed_by_account_id: string | null;
  reviewed_at: string | Date | null;
  approved_adjustment: unknown;
  created_at: string | Date;
};

export class PrivacyOperationsRepository {
  constructor(private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async createRequest(input: { requestId: string; tenantId: string | null; workerId: string; type: string; details?: Record<string, unknown> }) {
    const client = await this.clientPromise;
    await client.query(
      `INSERT INTO privacy_requests(request_id, tenant_id, worker_id, request_type, details) VALUES($1,$2,$3,$4,$5)`,
      [input.requestId, input.tenantId, input.workerId, input.type, JSON.stringify(input.details ?? {})]
    );
  }

  async addAccommodation(input: { id: string; tenantId: string | null; workerId: string; type: string; details?: Record<string, unknown> }) {
    const client = await this.clientPromise;
    await client.query(
      `INSERT INTO accessibility_accommodations(accommodation_id, tenant_id, worker_id, accommodation_type, details) VALUES($1,$2,$3,$4,$5)`,
      [input.id, input.tenantId, input.workerId, input.type, JSON.stringify(input.details ?? {})]
    );
  }

  async completeRequest(input: { requestId:string; workerId:string; tenantId:string | null; status:string }) {
    const client = await this.clientPromise;
    const result = await client.query(
      `UPDATE privacy_requests SET status=$4 WHERE request_id=$1 AND worker_id=$2 AND tenant_id IS NOT DISTINCT FROM $3 AND status='OPEN'`,
      [input.requestId, input.workerId, input.tenantId, input.status]
    );
    if (changedRows(result) !== 1) throw new Error("privacy request not found or already closed");
  }

  async transitionRequest(input: { requestId:string; workerId:string; tenantId:string | null; to:string }) {
    const client = await this.clientPromise;
    const result = await client.query(
      `UPDATE privacy_requests SET status=$4 WHERE request_id=$1 AND worker_id=$2 AND tenant_id IS NOT DISTINCT FROM $3 AND status='OPEN'`,
      [input.requestId, input.workerId, input.tenantId, input.to]
    );
    if (changedRows(result) !== 1) throw new Error("privacy request transition failed");
  }

  async listRequests(tenantId: string | null, workerId: string): Promise<Array<{ request_id: string; request_type: string; status: string }>> {
    const client = await this.clientPromise;
    const result = await client.query(
      `SELECT request_id, request_type, status, created_at FROM privacy_requests WHERE tenant_id IS NOT DISTINCT FROM $1 AND worker_id=$2 ORDER BY created_at DESC`,
      [tenantId, workerId]
    );
    return result.rows as Array<{ request_id: string; request_type: string; status: string }>;
  }

  async listAccommodations(tenantId: string | null, workerId: string): Promise<AccommodationReviewRow[]> {
    const client = await this.clientPromise;
    const result = await client.query(
      `SELECT accommodation_id,tenant_id,worker_id,accommodation_type,details,status,case_id,
              review_reason,reviewed_by_account_id,reviewed_at,approved_adjustment,created_at
         FROM accessibility_accommodations
        WHERE tenant_id IS NOT DISTINCT FROM $1 AND worker_id=$2
        ORDER BY created_at DESC`,
      [tenantId, workerId]
    );
    return result.rows as AccommodationReviewRow[];
  }

  async listAccommodationReviewQueue(): Promise<AccommodationReviewRow[]> {
    const client = await this.clientPromise;
    const result = await client.query(
      `SELECT accommodation_id,tenant_id,worker_id,accommodation_type,details,status,case_id,
              review_reason,reviewed_by_account_id,reviewed_at,approved_adjustment,created_at
         FROM accessibility_accommodations
        ORDER BY CASE status WHEN 'REQUESTED' THEN 0 ELSE 1 END, created_at, accommodation_id`
    );
    return result.rows as AccommodationReviewRow[];
  }

  async listWorkerCases(workerId: string): Promise<Array<{
    case_id: string;
    tenant_id: string;
    case_status: string;
    order_reference: string | null;
    order_name: string | null;
  }>> {
    const client = await this.clientPromise;
    const result = await client.query(
      `SELECT cases.case_id,cases.tenant_id,cases.case_status,orders.order_reference,orders.order_name
         FROM assurance_cases cases
         JOIN assurance_orders orders ON orders.order_id=cases.order_id AND orders.tenant_id=cases.tenant_id
        WHERE cases.worker_account_id=$1
        ORDER BY cases.created_at DESC`,
      [workerId]
    );
    return result.rows as Array<{
      case_id: string;
      tenant_id: string;
      case_status: string;
      order_reference: string | null;
      order_name: string | null;
    }>;
  }

  async reviewAccommodation(input: {
    accommodationId: string;
    reviewerAccountId: string;
    decision: "APPROVED" | "DECLINED";
    reason: string;
    caseId?: string | null;
    adjustment?: Record<string, unknown> | null;
    overlayId?: string | null;
    now: string;
  }): Promise<AccommodationReviewRow> {
    const client = await this.clientPromise;
    return client.transaction(async (tx) => {
      const found = await tx.query<AccommodationReviewRow>(
        `SELECT accommodation_id,tenant_id,worker_id,accommodation_type,details,status,case_id,
                review_reason,reviewed_by_account_id,reviewed_at,approved_adjustment,created_at
           FROM accessibility_accommodations
          WHERE accommodation_id=$1
          FOR UPDATE`,
        [input.accommodationId]
      );
      const accommodation = found.rows[0];
      if (!accommodation || accommodation.status !== "REQUESTED") {
        throw new Error("Accommodation is unavailable for review.");
      }

      if (input.decision === "APPROVED") {
        if (!input.caseId || !input.adjustment || !input.overlayId) {
          throw new Error("Approved accommodations require a case and delivery adjustment.");
        }
        const caseResult = await tx.query<{ case_id:string; tenant_id:string; worker_account_id:string }>(
          `SELECT case_id,tenant_id,worker_account_id FROM assurance_cases WHERE case_id=$1 FOR UPDATE`,
          [input.caseId]
        );
        const assuranceCase = caseResult.rows[0];
        if (!assuranceCase || assuranceCase.worker_account_id !== accommodation.worker_id) {
          throw new Error("Accommodation case does not belong to this Worker.");
        }
        if (accommodation.tenant_id && assuranceCase.tenant_id !== accommodation.tenant_id) {
          throw new Error("Accommodation case tenant does not match the request.");
        }
        const updated = await tx.query<AccommodationReviewRow>(
          `UPDATE accessibility_accommodations
              SET status='APPROVED',case_id=$2,review_reason=$3,reviewed_by_account_id=$4,
                  reviewed_at=$5,approved_adjustment=$6::jsonb
            WHERE accommodation_id=$1 AND status='REQUESTED'
            RETURNING *`,
          [
            input.accommodationId,
            input.caseId,
            input.reason,
            input.reviewerAccountId,
            input.now,
            JSON.stringify(input.adjustment)
          ]
        );
        if (!updated.rows[0]) throw new Error("Accommodation approval conflicted with another review.");
        await tx.query(
          `INSERT INTO assurance_case_accommodation_overlays(
             overlay_id,accommodation_id,case_id,worker_id,adjustment,approved_by_account_id,approved_at
           ) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)`,
          [
            input.overlayId,
            input.accommodationId,
            input.caseId,
            accommodation.worker_id,
            JSON.stringify(input.adjustment),
            input.reviewerAccountId,
            input.now
          ]
        );
        return updated.rows[0];
      }

      const updated = await tx.query<AccommodationReviewRow>(
        `UPDATE accessibility_accommodations
            SET status='DECLINED',review_reason=$2,reviewed_by_account_id=$3,reviewed_at=$4
          WHERE accommodation_id=$1 AND status='REQUESTED'
          RETURNING *`,
        [input.accommodationId, input.reason, input.reviewerAccountId, input.now]
      );
      if (!updated.rows[0]) throw new Error("Accommodation decline conflicted with another review.");
      return updated.rows[0];
    });
  }

  async listCaseAccommodationOverlays(caseId: string): Promise<Array<{
    overlay_id:string;
    accommodation_id:string;
    worker_id:string;
    adjustment:unknown;
    approved_by_account_id:string;
    approved_at:string | Date;
  }>> {
    const client = await this.clientPromise;
    const result = await client.query(
      `SELECT overlay_id,accommodation_id,worker_id,adjustment,approved_by_account_id,approved_at
         FROM assurance_case_accommodation_overlays
        WHERE case_id=$1
        ORDER BY approved_at,overlay_id`,
      [caseId]
    );
    return result.rows as Array<{
      overlay_id:string;
      accommodation_id:string;
      worker_id:string;
      adjustment:unknown;
      approved_by_account_id:string;
      approved_at:string | Date;
    }>;
  }

  async queueRetentionJob(input: { id: string; tenantId: string; resourceType: string; before: string }) {
    const client = await this.clientPromise;
    await client.query(
      `INSERT INTO retention_jobs(job_id, tenant_id, resource_type, retention_before) VALUES($1,$2,$3,$4)`,
      [input.id, input.tenantId, input.resourceType, input.before]
    );
  }

  async completeRetentionJob(input: { id: string; tenantId: string; status: string }) {
    const client = await this.clientPromise;
    const result = await client.query(
      `UPDATE retention_jobs SET status=$3 WHERE job_id=$1 AND tenant_id=$2 AND status='PENDING'`,
      [input.id, input.tenantId, input.status]
    );
    if (changedRows(result) !== 1) throw new Error("retention job not found or already closed");
  }
}
