import { IntegrityCaptureService, type IntegrityCaptureSignal } from "./integrity-capture-service";

/**
 * Application boundary used by assessment runtime code to submit integrity
 * signals. The capture service remains storage/provider agnostic until the
 * production persistence adapter is selected.
 */
export class IntegrityCaptureIntegration {
  constructor(private readonly captureService: IntegrityCaptureService) {}

  recordAssessmentIntegritySignal(signal: IntegrityCaptureSignal) {
    return this.captureService.record(signal);
  }

  currentAssessmentIntegrityState() {
    return this.captureService.snapshot();
  }
}
