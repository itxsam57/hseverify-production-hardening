import type { IntegrityEvidenceEvent } from "./integrity-domain";

/**
 * Persistence boundary for assessment integrity events.
 *
 * The local implementation is deterministic and in-memory so the runtime can
 * exercise the application boundary before a production database adapter is
 * selected.
 */
export class IntegrityCaptureRepository {
  private readonly events: IntegrityEvidenceEvent[] = [];

  save(event: IntegrityEvidenceEvent): IntegrityEvidenceEvent {
    this.events.push(event);
    return Object.freeze({ ...event, details: Object.freeze({ ...event.details }) });
  }

  list(): readonly IntegrityEvidenceEvent[] {
    return Object.freeze([...this.events]);
  }
}
