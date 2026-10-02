import "server-only";

import { getDatabaseClient } from "../database/database";

export type CertificationRecord = {
  certificationId: string;
  credentialId: string;
  workerId: string;
  qualification: string;
  status: string;
  decisionReason: string;
  createdBy: string;
  createdAt: string;
};

export class CertificationRecordRepository {
  constructor(private readonly clientPromise = getDatabaseClient()) {}

  async create(record: CertificationRecord): Promise<void> {
    const client = await this.clientPromise;
    await client.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO certification_records (certification_id, credential_id, worker_id, qualification, status, decision_reason, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [record.certificationId, record.credentialId, record.workerId, record.qualification, record.status, record.decisionReason, record.createdBy, record.createdAt]
      );
      await tx.query(
        `INSERT INTO certification_record_events (event_id, certification_id, action, actor_id) VALUES ($1,$2,$3,$4)`,
        [crypto.randomUUID(), record.certificationId, "created", record.createdBy]
      );
    });
  }

  async list(): Promise<CertificationRecord[]> {
    const client = await this.clientPromise;
    const result = await client.query<Record<string, unknown>>(`SELECT records.*,
        COALESCE(lower(decisions.state),records.status) AS status,
        COALESCE((SELECT overrides.reason FROM platform_decision_overrides overrides
                   WHERE overrides.decision_id=decisions.decision_id AND overrides.tenant_id=decisions.tenant_id
                   ORDER BY overrides.created_at DESC LIMIT 1),records.decision_reason) AS decision_reason
       FROM certification_records records
       LEFT JOIN assurance_cases cases ON cases.credential_reference=records.credential_id
       LEFT JOIN platform_decisions decisions ON decisions.decision_id=cases.decision_reference AND decisions.tenant_id=cases.tenant_id
       ORDER BY records.created_at DESC`);
    return result.rows.map((row) => ({
      certificationId: String(row.certification_id),
      credentialId: String(row.credential_id),
      workerId: String(row.worker_id),
      qualification: String(row.qualification),
      status: String(row.status),
      decisionReason: String(row.decision_reason),
      createdBy: String(row.created_by),
      createdAt: String(row.created_at)
    }));
  }
}
