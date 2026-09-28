import "server-only";

import { getDatabaseClient } from "../database/database";
import type { DatabaseClient } from "../database/database";
import type { IntegrityEvidenceEvent } from "./integrity-domain";

type Row = Record<string, unknown>;

export class IntegrityCaptureRepository {
  constructor(private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async save(
    event: IntegrityEvidenceEvent,
    metadata?: {
      workerAccountId?: string | null;
      caseId?: string | null;
      source?: "browser" | "camera" | "microphone" | "screen" | "network" | "device" | "candidate_report" | "provider";
      providerState?: "BUILT_IN" | "EXTERNAL_READY" | "DEGRADED" | "UNAVAILABLE";
    }
  ): Promise<IntegrityEvidenceEvent> {
    const client = await this.clientPromise;
    await client.query(
      `INSERT INTO integrity_capture_events(
         event_id,attempt_id,event_type,classification,state,occurred_at,details,
         worker_account_id,case_id,source,provider_state
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        event.eventId,
        event.attemptId,
        event.type,
        event.classification,
        event.state,
        event.occurredAt,
        JSON.stringify(event.details),
        metadata?.workerAccountId ?? null,
        metadata?.caseId ?? null,
        metadata?.source ?? "browser",
        metadata?.providerState ?? "BUILT_IN"
      ]
    );
    return event;
  }

  async list(attemptId?: string): Promise<readonly IntegrityEvidenceEvent[]> {
    const client = await this.clientPromise;
    const result = await client.query<Row>(
      `SELECT event_id, attempt_id, event_type, classification, state, occurred_at, details
       FROM integrity_capture_events
       WHERE ($1::text IS NULL OR attempt_id = $1)
       ORDER BY occurred_at, event_id`,
      [attemptId ?? null]
    );
    return result.rows.map((row) => Object.freeze({
      eventId: String(row.event_id),
      attemptId: String(row.attempt_id),
      type: String(row.event_type) as IntegrityEvidenceEvent["type"],
      classification: String(row.classification) as IntegrityEvidenceEvent["classification"],
      state: String(row.state) as IntegrityEvidenceEvent["state"],
      occurredAt: String(row.occurred_at),
      details: Object.freeze(typeof row.details === "string" ? JSON.parse(row.details) : row.details as Record<string, string>)
    }));
  }
}
