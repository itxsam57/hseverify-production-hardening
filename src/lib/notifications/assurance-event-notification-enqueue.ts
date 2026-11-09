import "server-only";
import type { DatabaseClient } from "../database/database";
import type { AssuranceEventType, AssuranceFundingEventType } from "../outbox/outbox-domain";

// The caller's existing business transaction owns this immutable source and all resulting jobs.
export async function enqueueAssuranceEventNotifications(
  database: DatabaseClient, eventType: AssuranceEventType | AssuranceFundingEventType, eventRef: string
): Promise<void> {
  const result = await database.query<{ queued: number }>(
    "SELECT platform_enqueue_assurance_event_notifications($1,$2) AS queued", [eventType,eventRef]
  );
  if (!Number.isInteger(result.rows[0]?.queued) || result.rows[0].queued < 0) {
    throw new Error("Required assurance notification intent was not retained.");
  }
}
