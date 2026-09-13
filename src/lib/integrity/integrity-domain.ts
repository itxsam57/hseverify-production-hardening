export const INTEGRITY_EVENT_TYPES = Object.freeze([
  "CAMERA_UNAVAILABLE",
  "MIC_UNAVAILABLE",
  "SCREEN_UNAVAILABLE",
  "BROWSER_FOCUS_LOST",
  "BROWSER_RESUMED"
] as const);

export type IntegrityEventType = (typeof INTEGRITY_EVENT_TYPES)[number];

export const INTEGRITY_CLASSIFICATIONS = Object.freeze([
  "GREEN",
  "YELLOW",
  "RED"
] as const);

export type IntegrityClassification = (typeof INTEGRITY_CLASSIFICATIONS)[number];

export const INTEGRITY_STATES = Object.freeze([
  "ACTIVE",
  "DEGRADED",
  "RECOVERED"
] as const);

export type IntegrityState = (typeof INTEGRITY_STATES)[number];

export type IntegrityEvidenceEvent = Readonly<{
  eventId: string;
  attemptId: string;
  type: IntegrityEventType;
  classification: IntegrityClassification;
  occurredAt: string;
  details: Readonly<Record<string, string>>;
  state: IntegrityState;
}>;

export class IntegrityEventInputError extends Error {
  constructor(message = "Integrity event input is invalid.") {
    super(message);
    this.name = "IntegrityEventInputError";
  }
}

export function classifyIntegrityEvent(type: IntegrityEventType): IntegrityClassification {
  if (type === "BROWSER_RESUMED") return "GREEN";
  if (type === "BROWSER_FOCUS_LOST") return "YELLOW";
  return "YELLOW";
}

export function stateForIntegrityEvent(type: IntegrityEventType): IntegrityState {
  if (type === "BROWSER_RESUMED") return "RECOVERED";
  if (type === "CAMERA_UNAVAILABLE" || type === "MIC_UNAVAILABLE" || type === "SCREEN_UNAVAILABLE") {
    return "DEGRADED";
  }
  return "ACTIVE";
}

export function summarizeIntegrityTimeline(events: readonly IntegrityEvidenceEvent[]): Readonly<{
  state: IntegrityState;
  classification: IntegrityClassification;
  eventCount: number;
}> {
  const latest = events.at(-1);
  if (!latest) {
    return Object.freeze({ state: "ACTIVE", classification: "GREEN", eventCount: 0 });
  }
  return Object.freeze({
    state: latest.state,
    classification: latest.classification,
    eventCount: events.length
  });
}

export function createIntegrityEvidenceEvent(input: {
  eventId: string;
  attemptId: string;
  type: string;
  occurredAt: string;
  details?: Record<string, string>;
}): IntegrityEvidenceEvent {
  if (!INTEGRITY_EVENT_TYPES.includes(input.type as IntegrityEventType)) {
    throw new IntegrityEventInputError();
  }

  if (!input.attemptId.trim() || !input.eventId.trim()) {
    throw new IntegrityEventInputError();
  }

  if (!input.occurredAt || Number.isNaN(Date.parse(input.occurredAt))) {
    throw new IntegrityEventInputError("Integrity event timestamp is invalid.");
  }

  return Object.freeze({
    eventId: input.eventId,
    attemptId: input.attemptId,
    type: input.type as IntegrityEventType,
    classification: classifyIntegrityEvent(input.type as IntegrityEventType),
    occurredAt: input.occurredAt,
    details: Object.freeze({ ...(input.details ?? {}) }),
    state: stateForIntegrityEvent(input.type as IntegrityEventType)
  });
}
