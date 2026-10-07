import "server-only";
import { lockSharingAccount, OPTIONAL_SHARING_RESTRICTION } from "./optional-sharing-restriction";
import { ConsentRecordService } from "./consent-record-service";
import { collectWorkerPrivacyData } from "./worker-privacy-data";

import { getDatabaseClient, type DatabaseClient } from "../database/database";

function changedRows(result: { affectedRows?: number; rowCount?: number }) {
  return result.affectedRows ?? result.rowCount ?? 0;
}

async function ownedShareLink(client: DatabaseClient, workerId: string, target: unknown) {
  if (typeof target !== "string" || !target.trim() || target.length > 200) {
    throw new Error("A valid requested share link is required for this Worker.");
  }
  const result = await client.query<{ share_link_id: string; created_at: string | Date; purpose: string }>(
    `SELECT links.share_link_id,links.created_at,links.purpose FROM scoped_share_links links
     JOIN auth_accounts accounts ON accounts.account_id=$2
     WHERE links.share_link_id=$1 AND (
       links.owner_worker_id=accounts.worker_reference OR EXISTS (
         SELECT 1 FROM worker_identity_worker_ids ids WHERE ids.worker_account_id=accounts.account_id
         AND ids.permanent_worker_id=links.owner_worker_id
       )
     ) FOR UPDATE OF links`, [target,workerId]
  );
  const link = result.rows[0];
  if (!link) throw new Error("Requested share link was not found for this Worker.");
  return link;
}

async function ownedScopedConsent(client: DatabaseClient, workerId: string, target: unknown) {
  if (typeof target !== "string" || !target.trim() || target.length > 200) {
    throw new Error("A valid optional sharing consent is required for this Worker.");
  }
  const result = await client.query<{
    consent_id: string; purpose: string; consent_type: string;
    withdrawal_rule: string; metadata: { shareLinkId?: string };
  }>(
    `SELECT consent_id,purpose,consent_type,withdrawal_rule,metadata FROM privacy_consent_records
     WHERE consent_id=$1 AND worker_id=$2 ORDER BY version DESC LIMIT 1 FOR UPDATE`,[target,workerId]
  );
  const consent = result.rows[0];
  if (!consent || consent.consent_type !== "scoped_share_links" || consent.withdrawal_rule !== "FUTURE_PROCESSING_ONLY") {
    throw new Error("Requested optional sharing consent was not found for this Worker.");
  }
  const link = await ownedShareLink(client,workerId,consent.metadata?.shareLinkId);
  return { ...consent, sharePurpose: link.purpose };
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

export type PrivacyRequestReviewRow = {
  request_id: string;
  tenant_id: string | null;
  worker_id: string;
  request_type: string;
  details: Record<string, unknown>;
  status: string;
  created_at: string | Date;
  review_reason: string | null;
};

export class PrivacyOperationsRepository {
  constructor(private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async listOwnedShareLinks(workerId: string): Promise<Array<{ share_link_id: string; purpose: string }>> {
    const client = await this.clientPromise;
    const result = await client.query<{ share_link_id: string; purpose: string }>(
      `SELECT links.share_link_id,links.purpose FROM scoped_share_links links
       JOIN auth_accounts accounts ON accounts.account_id=$1
       WHERE links.revoked_at IS NULL AND (
         links.owner_worker_id=accounts.worker_reference OR EXISTS (
           SELECT 1 FROM worker_identity_worker_ids ids WHERE ids.worker_account_id=accounts.account_id
           AND ids.permanent_worker_id=links.owner_worker_id
         )
       ) ORDER BY links.created_at DESC,links.share_link_id`, [workerId]
    );
    return result.rows;
  }

  async createRequest(input: { requestId: string; tenantId: string | null; workerId: string; type: string; details?: Record<string, unknown> }) {
    const client = await this.clientPromise;
    await client.transaction(async (tx) => {
      let details = input.details ?? {};
      if (input.type === "restriction") {
        if (details.purpose !== "optional_sharing" || Object.keys(details).some(key => key !== "purpose")) {
          throw new Error("Choose the supported optional sharing restriction scope.");
        }
        details = { purpose: "optional_sharing" };
      }
      if (input.type === "share_link_revocation" && details.shareLinkId !== undefined) {
        const link = await ownedShareLink(tx,input.workerId,details.shareLinkId);
        details = { shareLinkId: link.share_link_id, sharePurpose: link.purpose };
      }
      if (input.type === "consent_withdrawal" && details.consentId !== undefined) {
        const consent = await ownedScopedConsent(tx,input.workerId,details.consentId);
        details = { consentId: consent.consent_id, consentPurpose: consent.purpose, sharePurpose: consent.sharePurpose };
      }
      await tx.query(
        `INSERT INTO privacy_requests(request_id, tenant_id, worker_id, request_type, details) VALUES($1,$2,$3,$4,$5)`,
        [input.requestId, input.tenantId, input.workerId, input.type, JSON.stringify(details)]
      );
    });
  }

  async listRequestReviewQueue(): Promise<PrivacyRequestReviewRow[]> {
    const client = await this.clientPromise;
    const result = await client.query<PrivacyRequestReviewRow>(
      `SELECT requests.*, latest.reason AS review_reason
       FROM privacy_requests requests
       LEFT JOIN LATERAL (
         SELECT reason FROM privacy_request_reviews
         WHERE request_id=requests.request_id ORDER BY review_sequence DESC LIMIT 1
       ) latest ON true
       ORDER BY CASE requests.status WHEN 'OPEN' THEN 0 WHEN 'PROCESSING' THEN 1 ELSE 2 END,
                requests.created_at,requests.request_id`
    );
    return result.rows;
  }

  async reviewRequest(input: {
    requestId: string; reviewerAccountId: string; reviewId: string;
    expectedStatus: string; decision: "PROCESSING" | "REJECTED" | "COMPLETED"; reason: string; now: string;
  }) {
    const client = await this.clientPromise;
    return client.transaction(async (tx) => {
      const found = await tx.query<PrivacyRequestReviewRow>(
        `SELECT * FROM privacy_requests WHERE request_id=$1 FOR UPDATE`, [input.requestId]
      );
      const request = found.rows[0];
      if (!request || request.status !== input.expectedStatus ||
          !["OPEN", "PROCESSING"].includes(request.status) || request.status === input.decision) {
        throw new Error("Privacy request changed or is unavailable for this decision.");
      }
      let details = request.details;
      if (input.decision === "COMPLETED" && request.request_type === "restriction") {
        if (request.details?.purpose !== "optional_sharing") throw new Error("This restriction requires its supported fulfilment scope.");
        await lockSharingAccount(tx, request.worker_id, true);
      }
      if (input.decision === "COMPLETED") {
        if (request.request_type === "restriction") {
          await tx.query(
            `UPDATE scoped_share_links links SET revoked_at=COALESCE(links.revoked_at,$2::timestamptz)
             WHERE links.revoked_at IS NULL AND EXISTS (
               SELECT 1 FROM auth_accounts accounts WHERE accounts.account_id=$1 AND (
                 links.owner_worker_id=accounts.worker_reference OR EXISTS (
                   SELECT 1 FROM worker_identity_worker_ids ids WHERE ids.worker_account_id=accounts.account_id
                   AND ids.permanent_worker_id=links.owner_worker_id
                 )
               )
             )`, [request.worker_id,input.now]);
          details = { purpose: "optional_sharing", fulfilment: { method: OPTIONAL_SHARING_RESTRICTION, restrictedAt: input.now } };
        } else if (request.request_type === "consent_withdrawal" && request.details?.consentId !== undefined) {
          const consent = await ownedScopedConsent(tx,request.worker_id,request.details.consentId);
          await new ConsentRecordService(Promise.resolve(tx)).withdraw({
            workerId: request.worker_id, actorAccountId: input.reviewerAccountId,
            consentId: consent.consent_id, reason: input.reason.slice(0,1000), now: new Date(input.now)
          });
        } else if (["access","export"].includes(request.request_type)) {
          await collectWorkerPrivacyData(tx,request.worker_id,input.now);
          details = { ...request.details, fulfilment: {
            method: "owned_current_data_download", availableAt: input.now, formatVersion: 1
          } };
        } else {
          const target = request.details?.shareLinkId;
          if (request.request_type !== "share_link_revocation" || typeof target !== "string" || !target.trim()) {
            throw new Error("This request requires its specific fulfilment operation before completion.");
          }
          await ownedShareLink(tx,request.worker_id,target);
          await tx.query(
            "UPDATE scoped_share_links SET revoked_at=COALESCE(revoked_at,$2::timestamptz) WHERE share_link_id=$1",
            [target,input.now]
          );
        }
      }
      const updated = await tx.query<PrivacyRequestReviewRow>(
        `UPDATE privacy_requests SET status=$2,details=$5::jsonb,completed_at=CASE WHEN $2 IN ('REJECTED','COMPLETED') THEN $3::timestamptz ELSE NULL END
         WHERE request_id=$1 AND status=$4 RETURNING *`,
        [input.requestId,input.decision,input.now,input.expectedStatus,JSON.stringify(details)]
      );
      if (!updated.rows[0]) throw new Error("Privacy request review conflicted with another decision.");
      await tx.query(
        `INSERT INTO privacy_request_reviews(review_id,request_id,reviewer_account_id,from_status,to_status,reason,reviewed_at)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [input.reviewId,input.requestId,input.reviewerAccountId,request.status,input.decision,input.reason,input.now]
      );
      return updated.rows[0];
    });
  }

  async downloadWorkerData(requestId: string, workerId: string, now: string) {
    const client = await this.clientPromise;
    const found = await client.query<{ details: { fulfilment?: { method?: string } } }>(
      `SELECT details FROM privacy_requests WHERE request_id=$1 AND worker_id=$2
       AND request_type IN ('access','export') AND status='COMPLETED'`, [requestId,workerId]
    );
    if (found.rows[0]?.details?.fulfilment?.method !== "owned_current_data_download") {
      throw new Error("Worker data is unavailable.");
    }
    return collectWorkerPrivacyData(client,workerId,now);
  }

  async addAccommodation(input: { id: string; tenantId: string | null; workerId: string; type: string; details?: Record<string, unknown> }) {
    const client = await this.clientPromise;
    await client.query(
      `INSERT INTO accessibility_accommodations(accommodation_id, tenant_id, worker_id, accommodation_type, details) VALUES($1,$2,$3,$4,$5)`,
      [input.id, input.tenantId, input.workerId, input.type, JSON.stringify(input.details ?? {})]
    );
  }

  async completeRequest(input: { requestId:string; workerId:string; tenantId:string | null; status:string }) {
    if (!input.requestId || !input.workerId) throw new Error("Privacy request boundary is required.");
    throw new Error("Privacy completion requires an authorized fulfilment review.");
  }

  async transitionRequest(input: { requestId:string; workerId:string; tenantId:string | null; to:string }) {
    if (input.to === "COMPLETED") throw new Error("Privacy completion requires an authorized fulfilment review.");
    const client = await this.clientPromise;
    const result = await client.query(
      `UPDATE privacy_requests SET status=$4 WHERE request_id=$1 AND worker_id=$2 AND tenant_id IS NOT DISTINCT FROM $3 AND status='OPEN'`,
      [input.requestId, input.workerId, input.tenantId, input.to]
    );
    if (changedRows(result) !== 1) throw new Error("privacy request transition failed");
  }

  async listRequests(tenantId: string | null, workerId: string): Promise<PrivacyRequestReviewRow[]> {
    const client = await this.clientPromise;
    const result = await client.query(
      `SELECT requests.*, latest.reason AS review_reason FROM privacy_requests requests
       LEFT JOIN LATERAL (SELECT reason FROM privacy_request_reviews
         WHERE request_id=requests.request_id ORDER BY review_sequence DESC LIMIT 1) latest ON true
       WHERE tenant_id IS NOT DISTINCT FROM $1 AND worker_id=$2 ORDER BY created_at DESC`,
      [tenantId, workerId]
    );
    return result.rows as PrivacyRequestReviewRow[];
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
