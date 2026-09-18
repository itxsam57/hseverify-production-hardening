import type { IntegrityCaptureService } from "./integrity-capture-service";
import type { IntegrityEventType } from "./integrity-domain";

/**
 * Local browser media boundary. Real providers can call the same boundary when
 * a device stream is activated. The adapter records the outcome without
 * storing media.
 */
export class IntegrityMediaAdapter {
  constructor(private readonly capture: IntegrityCaptureService) {}

  async recordAvailability(input: {
    source: "camera" | "microphone" | "screen";
    available: boolean;
    occurredAt?: string;
  }) {
    const type = input.available ? "BROWSER_RESUMED" : sourceUnavailableEvent(input.source);
    return this.capture.record({
      type,
      occurredAt: input.occurredAt ?? new Date().toISOString()
    });
  }
}

function sourceUnavailableEvent(source: "camera" | "microphone" | "screen"): IntegrityEventType {
  if (source === "camera") return "CAMERA_UNAVAILABLE";
  if (source === "microphone") return "MIC_UNAVAILABLE";
  return "SCREEN_UNAVAILABLE";
}
