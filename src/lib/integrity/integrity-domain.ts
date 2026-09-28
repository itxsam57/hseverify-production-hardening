export const INTEGRITY_EVENT_TYPES = Object.freeze([
  "CAMERA_UNAVAILABLE",
  "MIC_UNAVAILABLE",
  "SCREEN_UNAVAILABLE",
  "BROWSER_FOCUS_LOST",
  "BROWSER_RESUMED",
  "TAB_SWITCHED",
  "FULLSCREEN_EXITED",
  "IDENTITY_RECONFIRMATION_REQUIRED",
  "ADDITIONAL_VOICE_DETECTED",
  "COPY_PASTE_DETECTED",
  "DEVICE_CHANGED",
  "CONNECTION_INTERRUPTED",
  "NO_FACE_DETECTED",
  "MULTIPLE_FACE_DETECTED",
  "RECORDING_STARTED",
  "RECORDING_STOPPED",
  "RECORDING_FAILED",
  "MONITORING_PROVIDER_DEGRADED",
  "SESSION_TIMING_ANOMALY"
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

export function normalizeIntegrityAttemptReference(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) {
    throw new IntegrityEventInputError("Integrity attempt reference is invalid.");
  }
  return normalized;
}

export function classifyIntegrityEvent(type: IntegrityEventType): IntegrityClassification {
  if (type === "BROWSER_RESUMED" || type === "RECORDING_STARTED" || type === "RECORDING_STOPPED") return "GREEN";
  if (
    type === "BROWSER_FOCUS_LOST" ||
    type === "TAB_SWITCHED" ||
    type === "FULLSCREEN_EXITED" ||
    type === "NO_FACE_DETECTED" ||
    type === "RECORDING_FAILED" ||
    type === "MONITORING_PROVIDER_DEGRADED" ||
    type === "SESSION_TIMING_ANOMALY"
  ) return "YELLOW";
  if (type === "CONNECTION_INTERRUPTED") return "YELLOW";
  if (
    type === "COPY_PASTE_DETECTED" ||
    type === "DEVICE_CHANGED" ||
    type === "IDENTITY_RECONFIRMATION_REQUIRED" ||
    type === "ADDITIONAL_VOICE_DETECTED" ||
    type === "MULTIPLE_FACE_DETECTED"
  ) return "RED";
  return "YELLOW";
}

export function stateForIntegrityEvent(type: IntegrityEventType): IntegrityState {
  if (type === "BROWSER_RESUMED") return "RECOVERED";
  if (
    type === "CAMERA_UNAVAILABLE" ||
    type === "MIC_UNAVAILABLE" ||
    type === "SCREEN_UNAVAILABLE" ||
    type === "CONNECTION_INTERRUPTED" ||
    type === "RECORDING_FAILED" ||
    type === "MONITORING_PROVIDER_DEGRADED"
  ) {
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

  if (!normalizeIntegrityAttemptReference(input.attemptId) || !input.eventId.trim()) {
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
