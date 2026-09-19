import "server-only";

import { getDatabaseClient } from "../database/database";
import type { DatabaseClient } from "../database/database";
import {
  type LivingCompetencyRecord,
  type LivingRecordVersion
} from "./living-record-domain";

type Row = Record<string, unknown>;

function versionFromRow(row: Row): Omit<LivingRecordVersion, "version"> {
  return {
    status: String(row.status) as LivingRecordVersion["status"],
    effectiveAt: String(row.effective_at),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    restrictions: JSON.parse(String(row.restrictions)) as string[],
    conditions: JSON.parse(String(row.conditions)) as string[],
    reassessment: JSON.parse(String(row.reassessment)) as LivingRecordVersion["reassessment"]
  };
}

export class LivingRecordRepository {
  constructor(private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async replaceCompetencyRecord(
    workerId: string,
    record: LivingCompetencyRecord
  ): Promise<void> {
    const client = await this.clientPromise;
    await client.query("BEGIN", []);
    try {
      await client.query(
        `INSERT INTO living_record_competencies
          (competency_id, worker_id, title, source_credential_id, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (competency_id) DO UPDATE SET
           title = EXCLUDED.title,
           source_credential_id = EXCLUDED.source_credential_id`,
        [record.competencyId, workerId, record.title, record.sourceCredentialId]
      );

      for (const version of record.versions) {
        await client.query(
          `INSERT INTO living_record_versions
            (competency_id, version, status, effective_at, expires_at, restrictions, conditions, reassessment)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (competency_id, version) DO NOTHING`,
          [
            record.competencyId,
            version.version,
            version.status,
            version.effectiveAt,
            version.expiresAt,
            JSON.stringify(version.restrictions),
            JSON.stringify(version.conditions),
            JSON.stringify(version.reassessment)
          ]
        );
      }
      await client.query("COMMIT", []);
    } catch (error) {
      await client.query("ROLLBACK", []);
      throw error;
    }
  }

  async findByWorker(workerId: string): Promise<LivingCompetencyRecord[]> {
    const client = await this.clientPromise;
    const result = await client.query<Row>(
      `SELECT c.competency_id, c.title, c.source_credential_id,
              v.version, v.status, v.effective_at, v.expires_at,
              v.restrictions, v.conditions, v.reassessment
       FROM living_record_competencies c
       JOIN living_record_versions v ON v.competency_id = c.competency_id
       WHERE c.worker_id = $1
       ORDER BY c.competency_id, v.version`,
      [workerId]
    );

    const grouped = new Map<string, LivingCompetencyRecord>();
    for (const row of result.rows) {
      const current = grouped.get(String(row.competency_id));
      const nextVersion = Number(row.version);
      const version = { version: nextVersion, ...versionFromRow(row) };
      if (!current) {
        grouped.set(String(row.competency_id), {
          competencyId: String(row.competency_id),
          title: String(row.title),
          sourceCredentialId: row.source_credential_id ? String(row.source_credential_id) : null,
          versions: [version]
        });
        continue;
      }
      if (nextVersion > current.versions.at(-1)!.version) {
        grouped.set(String(row.competency_id), {
          ...current,
          versions: [...current.versions, version]
        });
      }
    }
    return [...grouped.values()].map((record) => ({
      ...record,
      versions: Object.freeze([...record.versions])
    }));
  }
}
