import {
  createIntegrityEvidenceEvent,
  summarizeIntegrityTimeline,
  type IntegrityEvidenceEvent,
  type IntegrityEventType
} from "./integrity-domain";
import { IntegrityCaptureRepository } from "./integrity-capture-repository";

export type IntegrityCaptureSignal = Readonly<{
  type: IntegrityEventType;
  occurredAt: string;
  details?: Record<string, string>;
}>;

export class IntegrityCaptureService {
  private readonly repository: IntegrityCaptureRepository;

  constructor(
    repository = new IntegrityCaptureRepository(),
    private readonly assessmentAttemptId = "integrity-local-attempt",
    initialEvents: readonly IntegrityEvidenceEvent[] = []
  ) {
    this.repository = repository;
    initialEvents.forEach((event) => this.repository.save(event));
  }

  record(signal: IntegrityCaptureSignal): IntegrityEvidenceEvent {
    const event = createIntegrityEvidenceEvent({
      eventId: crypto.randomUUID(),
      attemptId: this.attemptId,
      type: signal.type,
      occurredAt: signal.occurredAt,
      details: signal.details
    });
    return this.repository.save(event);
  }

  get attemptId(): string {
    return this.assessmentAttemptId;
  }

  snapshot() {
    return summarizeIntegrityTimeline(this.repository.list());
  }

  allEvents(): readonly IntegrityEvidenceEvent[] {
    return this.repository.list();
  }
}
