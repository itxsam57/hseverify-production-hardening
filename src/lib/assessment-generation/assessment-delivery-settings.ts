export const ASSESSMENT_PROGRESSION_MODES = [
  "STRICT",
  "CONTROLLED_REVIEW",
  "SECTION_REVIEW"
] as const;
export type AssessmentProgressionMode = (typeof ASSESSMENT_PROGRESSION_MODES)[number];

export type AssessmentSectionDefinition = Readonly<{
  title: string;
  endPosition: number;
  durationSeconds?: number;
}>;

export type AssessmentTimingSettings = Readonly<{ mode: "COMBINED"; durationSeconds: number }> | Readonly<{ mode: "SEPARATE" }>;

export type AssessmentDeliverySettingsInput = Readonly<{
  timing?: AssessmentTimingSettings | null;
  progressionMode?: AssessmentProgressionMode;
  sections?: readonly AssessmentSectionDefinition[];
  requireCamera?: boolean;
  requireMicrophone?: boolean;
  requireScreenShare?: boolean;
  recordCamera?: boolean;
  recordMicrophone?: boolean;
  recordScreen?: boolean;
  recordingRetentionDays?: number;
  integrityFailureMode?: "REVIEW" | "BLOCK";
  requireFullscreen?: boolean;
  requireEnvironmentDeclaration?: boolean;
  requireMonitoringConsent?: boolean;
}>;

export type AssessmentDeliverySettings = Readonly<{
  timing: AssessmentTimingSettings | null;
  progressionMode: AssessmentProgressionMode;
  sections: readonly AssessmentSectionDefinition[];
  requireCamera: boolean;
  requireMicrophone: boolean;
  requireScreenShare: boolean;
  recordCamera: boolean;
  recordMicrophone: boolean;
  recordScreen: boolean;
  recordingRetentionDays: number;
  integrityFailureMode: "REVIEW" | "BLOCK";
  requireFullscreen: boolean;
  requireEnvironmentDeclaration: boolean;
  requireMonitoringConsent: boolean;
}>;

export class AssessmentDeliverySettingsInputError extends Error {
  constructor(message = "Assessment delivery settings are invalid.") {
    super(message);
    this.name = "AssessmentDeliverySettingsInputError";
  }
}

export const DEFAULT_ASSESSMENT_DELIVERY_SETTINGS: AssessmentDeliverySettings = Object.freeze({
  timing: null,
  progressionMode: "STRICT",
  sections: Object.freeze([]),
  requireCamera: false,
  requireMicrophone: false,
  requireScreenShare: false,
  recordCamera: false,
  recordMicrophone: false,
  recordScreen: false,
  recordingRetentionDays: 30,
  integrityFailureMode: "REVIEW",
  requireFullscreen: true,
  requireEnvironmentDeclaration: true,
  requireMonitoringConsent: true
});

export function normalizeAssessmentDeliverySettings(
  input: AssessmentDeliverySettingsInput | undefined,
  questionCount: number
): AssessmentDeliverySettings {
  if (!Number.isSafeInteger(questionCount) || questionCount < 1 || questionCount > 500) {
    throw new AssessmentDeliverySettingsInputError("Assessment question count is invalid.");
  }
  if (!input) return DEFAULT_ASSESSMENT_DELIVERY_SETTINGS;
  const progressionMode = input.progressionMode ?? "STRICT";
  if (!ASSESSMENT_PROGRESSION_MODES.includes(progressionMode)) {
    throw new AssessmentDeliverySettingsInputError("Assessment progression mode is invalid.");
  }
  const sections = [...(input.sections ?? [])];
  if (progressionMode === "SECTION_REVIEW") {
    if (sections.length < 1 || sections.length > 50) {
      throw new AssessmentDeliverySettingsInputError("Section Review requires one or more sections.");
    }
    let previous = 0;
    for (const section of sections) {
      const title = section.title.trim().replace(/\s+/g, " ");
      if (title.length < 1 || title.length > 120) {
        throw new AssessmentDeliverySettingsInputError("Assessment section title is invalid.");
      }
      if (
        !Number.isSafeInteger(section.endPosition) ||
        section.endPosition <= previous ||
        section.endPosition > questionCount
      ) {
        throw new AssessmentDeliverySettingsInputError("Assessment section boundaries are invalid.");
      }
      previous = section.endPosition;
    }
    if (previous !== questionCount) {
      throw new AssessmentDeliverySettingsInputError("The last assessment section must end at the final question.");
    }
  } else if (sections.length > 0) {
    throw new AssessmentDeliverySettingsInputError("Assessment sections are only valid in Section Review mode.");
  }
  const timing = input.timing ?? null;
  const validDuration = (value: unknown): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 86400;
  if (timing !== null) {
    if (timing.mode === "COMBINED") {
      if (!validDuration(timing.durationSeconds)) {
        throw new AssessmentDeliverySettingsInputError("Combined time must be between 1 and 86400 seconds.");
      }
    } else if (timing.mode === "SEPARATE") {
      if (progressionMode !== "SECTION_REVIEW" || sections.some(section => !validDuration(section.durationSeconds))) {
        throw new AssessmentDeliverySettingsInputError("Separate timers require Section Review and a duration for every section.");
      }
    } else {
      throw new AssessmentDeliverySettingsInputError("Assessment timing mode is invalid.");
    }
  }
  if (timing?.mode !== "SEPARATE" && sections.some(section => section.durationSeconds !== undefined)) {
    throw new AssessmentDeliverySettingsInputError("Section durations require separate timers.");
  }
  const requireCamera = Boolean(input.requireCamera);
  const requireMicrophone = Boolean(input.requireMicrophone);
  const requireScreenShare = Boolean(input.requireScreenShare);
  const recordCamera = Boolean(input.recordCamera);
  const recordMicrophone = Boolean(input.recordMicrophone);
  const recordScreen = Boolean(input.recordScreen);
  const recordingRetentionDays = input.recordingRetentionDays ?? 30;
  if (
    !Number.isSafeInteger(recordingRetentionDays) ||
    recordingRetentionDays < 1 ||
    recordingRetentionDays > 3650
  ) {
    throw new AssessmentDeliverySettingsInputError("Recording retention must be between 1 and 3650 days.");
  }
  if (recordCamera && !requireCamera) {
    throw new AssessmentDeliverySettingsInputError("Camera recording requires the camera check.");
  }
  if (recordMicrophone && !requireMicrophone) {
    throw new AssessmentDeliverySettingsInputError("Microphone recording requires the microphone check.");
  }
  if (recordScreen && !requireScreenShare) {
    throw new AssessmentDeliverySettingsInputError("Screen recording requires the screen-share check.");
  }
  if ((recordCamera || recordMicrophone || recordScreen) && input.requireMonitoringConsent === false) {
    throw new AssessmentDeliverySettingsInputError("Assessment recording requires monitoring consent.");
  }
  return Object.freeze({
    timing: timing === null ? null : Object.freeze({ ...timing }),
    progressionMode,
    sections: Object.freeze(sections.map((section) => Object.freeze({
      title: section.title.trim().replace(/\s+/g, " "),
      endPosition: section.endPosition,
      ...(section.durationSeconds === undefined ? {} : { durationSeconds: section.durationSeconds })
    }))),
    requireCamera,
    requireMicrophone,
    requireScreenShare,
    recordCamera,
    recordMicrophone,
    recordScreen,
    recordingRetentionDays,
    integrityFailureMode: input.integrityFailureMode ?? "REVIEW",
    requireFullscreen: input.requireFullscreen ?? true,
    requireEnvironmentDeclaration: input.requireEnvironmentDeclaration ?? true,
    requireMonitoringConsent: input.requireMonitoringConsent ?? true
  });
}
