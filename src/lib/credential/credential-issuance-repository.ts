import "server-only";

import { getDatabaseClient } from "../database/database";
import type { CredentialRecord } from "./credential-issuance-domain";
import { credentialFromRow } from "./credential-issuance-domain";

export class CredentialIssuanceRepository {
  constructor(private readonly clientPromise = getDatabaseClient()) {}

  async save(record: CredentialRecord): Promise<void> {
    const client = await this.clientPromise;
    await client.transaction(async (transaction) => {
    await transaction.query(
      `INSERT INTO credential_issuances
       (credential_id, worker_id, qualification, issued_at, expires_at, status, version, public_status_url, qr_payload, signature, pdf_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [record.credentialId, record.workerId, record.qualification, record.issuedAt, record.expiresAt, record.status, record.version, record.publicStatusUrl, record.qrPayload, record.signature, record.pdfUrl]
    );
    await transaction.query(
      `INSERT INTO credential_lifecycle_events (credential_id, status, version, changed_at) VALUES ($1,$2,$3,$4)`,
      [record.credentialId, record.status, record.version, record.issuedAt]
    );
    await transaction.query(
      `INSERT INTO credential_issuance_events (credential_id, version, status, changed_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [record.credentialId, record.version, record.status, record.issuedAt]
    );
    });
  }

  async findPublic(credentialId: string): Promise<CredentialRecord | null> {
    const client = await this.clientPromise;
    const result = await client.query(
      `SELECT credential_id, worker_id, qualification, issued_at, expires_at, status, version, public_status_url, qr_payload, signature, pdf_url
       FROM credential_issuances WHERE credential_id=$1`,
      [credentialId]
    );
    return result.rows[0] ? credentialFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async listByWorker(workerId: string): Promise<CredentialRecord[]> {
    const client = await this.clientPromise;
    const result = await client.query(
      `SELECT credential_id, worker_id, qualification, issued_at, expires_at, status, version, public_status_url, qr_payload, signature, pdf_url
       FROM credential_issuances
       WHERE worker_id=$1
       ORDER BY issued_at DESC, credential_id DESC`,
      [workerId]
    );
    return result.rows.map((row) => credentialFromRow(row as Record<string, unknown>));
  }

  async findLifecycle(credentialId: string): Promise<Pick<CredentialRecord, "status" | "version"> | null> {
    const client = await this.clientPromise;
    const result = await client.query(
      `SELECT status, version FROM credential_issuances WHERE credential_id=$1`,
      [credentialId]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? {
      status: row.status as CredentialRecord["status"],
      version: Number(row.version)
    } : null;
  }

  async updateStatus(credentialId: string, status: CredentialRecord["status"], version: number, currentStatus?: CredentialRecord["status"]): Promise<CredentialRecord | null> {
    const client = await this.clientPromise;
    return client.transaction(async (transaction) => {
      const result = await transaction.query(
        `UPDATE credential_issuances
         SET status=$2, version=$3
         WHERE credential_id=$1 AND version=$4 AND ($5::text IS NULL OR status=$5)
         RETURNING credential_id, worker_id, qualification, issued_at, expires_at, status, version, public_status_url, qr_payload, signature, pdf_url`,
        [credentialId, status, version + 1, version, currentStatus ?? null]
      );
      const updated = result.rows[0] ? credentialFromRow(result.rows[0] as Record<string, unknown>) : null;
      if (updated) {
        await transaction.query(
        `INSERT INTO credential_lifecycle_events (credential_id, status, version, changed_at) VALUES ($1,$2,$3,now())`,
        [updated.credentialId, updated.status, updated.version]
        );
        await transaction.query(
        `INSERT INTO credential_issuance_events (credential_id, version, status, changed_at) VALUES ($1,$2,$3,now()) ON CONFLICT DO NOTHING`,
        [updated.credentialId, updated.version, updated.status]
        );
      }
      return updated;
    });
  }
}