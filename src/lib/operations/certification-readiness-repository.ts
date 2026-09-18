import "server-only";

import { getDatabaseClient } from "../database/database";

export type StoredCertificationDrill = {
  name: "concurrency" | "tenant_isolation" | "restore" | "incident";
  status: "passed" | "failed";
  evidence: string;
};

export class CertificationReadinessRepository {
  constructor(private readonly clientPromise = getDatabaseClient()) {}

  async replace(drills: readonly StoredCertificationDrill[]): Promise<void> {
    const client = await this.clientPromise;
    await client.transaction(async (tx) => {
      await tx.execute("DELETE FROM operations_certification_drills");
      for (const drill of drills) {
        await tx.query(
          "INSERT INTO operations_certification_drills (drill_id, drill_name, status, evidence) VALUES ($1,$2,$3,$4)",
          [crypto.randomUUID(), drill.name, drill.status, drill.evidence]
        );
      }
    });
  }

  async list(): Promise<StoredCertificationDrill[]> {
    const client = await this.clientPromise;
    const result = await client.query<Record<string, unknown>>(
      "SELECT drill_name, status, evidence FROM operations_certification_drills ORDER BY created_at ASC"
    );
    return result.rows.map((row) => ({
      name: String(row.drill_name) as StoredCertificationDrill["name"],
      status: String(row.status) as StoredCertificationDrill["status"],
      evidence: String(row.evidence)
    }));
  }
}
