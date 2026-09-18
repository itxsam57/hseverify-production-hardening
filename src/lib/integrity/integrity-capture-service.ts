import {
  createIntegrityEvidenceEvent,
  normalizeIntegrityAttemptReference,
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
    assessmentAttemptId = "integrity-local-attempt",
    initialEvents: readonly IntegrityEvidenceEvent[] = []
  ) {
    this.repository = repository;
    this.assessmentAttemptId = normalizeIntegrityAttemptReference(assessmentAttemptId);
    this.initialEvents = initialEvents;
  }

  private readonly assessmentAttemptId: string;
  private readonly initialEvents: readonly IntegrityEvidenceEvent[];

  async record(signal: IntegrityCaptureSignal): Promise<IntegrityEvidenceEvent> {
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

  async snapshot() {
    return summarizeIntegrityTimeline(await this.allEvents());
  }

  async allEvents(): Promise<readonly IntegrityEvidenceEvent[]> {
    const stored = await this.repository.list(this.attemptId);
    return [...this.initialEvents, ...stored];
  }
}
