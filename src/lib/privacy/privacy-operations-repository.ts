import "server-only";

import { getDatabaseClient } from "../database/database";

function changedRows(result: { affectedRows?: number; rowCount?: number }) {
  return result.affectedRows ?? result.rowCount ?? 0;
}

export class PrivacyOperationsRepository {
  constructor(private readonly clientPromise = getDatabaseClient()) {}

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

  async listAccommodations(tenantId: string | null, workerId: string): Promise<Array<{ accommodation_id: string; accommodation_type: string; status: string }>> {
    const client = await this.clientPromise;
    const result = await client.query(
      `SELECT accommodation_id, accommodation_type, status, created_at FROM accessibility_accommodations WHERE tenant_id IS NOT DISTINCT FROM $1 AND worker_id=$2 ORDER BY created_at DESC`,
      [tenantId, workerId]
    );
    return result.rows as Array<{ accommodation_id: string; accommodation_type: string; status: string }>;
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
