import "server-only";

import { getDatabaseClient } from "../database/database";
import type { CredentialAppeal } from "./credential-appeals-domain";

export class CredentialAppealsRepository {
  constructor(private readonly clientPromise = getDatabaseClient()) {}

  async save(appeal: CredentialAppeal) {
    const client = await this.clientPromise;
    await client.query(
      `INSERT INTO credential_appeals (appeal_id, credential_id, worker_id, reason, evidence, status, version, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
      [appeal.appealId, appeal.credentialId, appeal.workerId, appeal.reason, JSON.stringify(appeal.evidence), appeal.status, appeal.version, appeal.createdAt]
    );
    await client.query(
      `INSERT INTO credential_appeal_events (appeal_id, version, status, changed_at) VALUES ($1,$2,$3,$4)`,
      [appeal.appealId, appeal.version, appeal.status, appeal.createdAt]
    );
    return appeal;
  }

  async updateStatus(appeal: CredentialAppeal): Promise<CredentialAppeal> {
    const client = await this.clientPromise;
    const changedAt = new Date().toISOString();
    await client.transaction(async (transaction) => {
      const result = await transaction.query(
        `UPDATE credential_appeals
         SET status=$2, version=$3, updated_at=$4
         WHERE appeal_id=$1 AND version=$5`,
        [appeal.appealId, appeal.status, appeal.version, changedAt, appeal.version - 1]
      );
      if (result.rows.length !== 1) {
        throw new Error("Appeal update conflict.");
      }
      await transaction.query(
        `INSERT INTO credential_appeal_events (appeal_id, version, status, changed_at) VALUES ($1,$2,$3,$4)`,
        [appeal.appealId, appeal.version, appeal.status, changedAt]
      );
    });
    return appeal;
  }

  async find(appealId: string): Promise<CredentialAppeal | null> {
    const client = await this.clientPromise;
    const result = await client.query<{
      appeal_id: string;
      credential_id: string;
      worker_id: string;
      reason: string;
      evidence: string[];
      status: CredentialAppeal["status"];
      version: number;
      created_at: string;
    }>(
      `SELECT appeal_id, credential_id, worker_id, reason, evidence, status, version, created_at
       FROM credential_appeals WHERE appeal_id=$1`,
      [appealId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return Object.freeze({
      appealId: row.appeal_id,
      credentialId: row.credential_id,
      workerId: row.worker_id,
      reason: row.reason,
      evidence: Object.freeze(row.evidence ?? []),
      status: row.status,
      version: row.version,
      createdAt: new Date(row.created_at).toISOString()
    }) as CredentialAppeal;
  }
}
