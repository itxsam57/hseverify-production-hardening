import "server-only";

import { getDatabaseClient } from "../database/database";

export class PrivacyOperationsRepository {
  constructor(private readonly clientPromise = getDatabaseClient()) {}

  async createRequest(input: { requestId: string; workerId: string; type: string; details?: Record<string, unknown> }) {
    const client = await this.clientPromise;
    await client.query(
      `INSERT INTO privacy_requests(request_id, worker_id, request_type, details) VALUES($1,$2,$3,$4)`,
      [input.requestId, input.workerId, input.type, JSON.stringify(input.details ?? {})]
    );
  }

  async addAccommodation(input: { id: string; workerId: string; type: string; details?: Record<string, unknown> }) {
    const client = await this.clientPromise;
    await client.query(
      `INSERT INTO accessibility_accommodations(accommodation_id, worker_id, accommodation_type, details) VALUES($1,$2,$3,$4)`,
      [input.id, input.workerId, input.type, JSON.stringify(input.details ?? {})]
    );
  }

  async completeRequest(input: { requestId:string; workerId:string; status:string }) {
    const client = await this.clientPromise;
    await client.query(
      `UPDATE privacy_requests SET status=$3 WHERE request_id=$1 AND worker_id=$2`,
      [input.requestId, input.workerId, input.status]
    );
  }

  async transitionRequest(input: { requestId:string; workerId:string; to:string }) {
    const client = await this.clientPromise;
    await client.query(
      `UPDATE privacy_requests SET status=$3 WHERE request_id=$1 AND worker_id=$2 AND status='OPEN'`,
      [input.requestId, input.workerId, input.to]
    );
  }

  async listRequests(workerId: string): Promise<Array<{ request_id: string; request_type: string; status: string }>> {
    const client = await this.clientPromise;
    const result = await client.query(
      `SELECT request_id, request_type, status, created_at FROM privacy_requests WHERE worker_id=$1 ORDER BY created_at DESC`,
      [workerId]
    );
    return result.rows as Array<{ request_id: string; request_type: string; status: string }>;
  }

  async listAccommodations(workerId: string): Promise<Array<{ accommodation_id: string; accommodation_type: string; status: string }>> {
    const client = await this.clientPromise;
    const result = await client.query(
      `SELECT accommodation_id, accommodation_type, status, created_at FROM accessibility_accommodations WHERE worker_id=$1 ORDER BY created_at DESC`,
      [workerId]
    );
    return result.rows as Array<{ accommodation_id: string; accommodation_type: string; status: string }>;
  }

  async queueRetentionJob(input: { id: string; resourceType: string; before: string }) {
    const client = await this.clientPromise;
    await client.query(
      `INSERT INTO retention_jobs(job_id, resource_type, retention_before) VALUES($1,$2,$3)`,
      [input.id, input.resourceType, input.before]
    );
  }

  async completeRetentionJob(input: { id: string; status: string }) {
    const client = await this.clientPromise;
    await client.query(
      `UPDATE retention_jobs SET status=$2 WHERE job_id=$1 AND status='PENDING'`,
      [input.id, input.status]
    );
  }
}
