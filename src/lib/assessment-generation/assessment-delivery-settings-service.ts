import "server-only";

import { getDatabaseClient, type DatabaseClient } from "@/lib/database/database";
import {
  DEFAULT_ASSESSMENT_DELIVERY_SETTINGS,
  normalizeAssessmentDeliverySettings,
  type AssessmentDeliverySettings
} from "@/lib/assessment-generation/assessment-delivery-settings";

type Row = {
  progression_mode: AssessmentDeliverySettings["progressionMode"];
  section_config_json: unknown;
  require_camera: boolean;
  require_microphone: boolean;
  require_screen_share: boolean;
  record_camera: boolean;
  record_microphone: boolean;
  record_screen: boolean;
  recording_retention_days: number | string;
  integrity_failure_mode: "REVIEW" | "BLOCK";
  require_fullscreen: boolean;
  require_environment_declaration: boolean;
  require_monitoring_consent: boolean;
  question_count: number | string;
};

function parseSections(value: unknown): readonly { title: string; endPosition: number }[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return Object.freeze([]); }
  }
  if (!Array.isArray(parsed)) return Object.freeze([]);
  return Object.freeze(parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.title !== "string" || !Number.isSafeInteger(Number(row.endPosition))) return [];
    return [Object.freeze({ title: row.title, endPosition: Number(row.endPosition) })];
  }));
}

export class AssessmentDeliverySettingsService {
  constructor(private readonly databasePromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async get(blueprintVersionId: string): Promise<AssessmentDeliverySettings> {
    const db = await this.databasePromise;
    const result = await db.query<Row>(
      `SELECT settings.progression_mode,settings.section_config_json,
              settings.require_camera,settings.require_microphone,settings.require_screen_share,
              settings.record_camera,settings.record_microphone,settings.record_screen,
              settings.recording_retention_days,settings.integrity_failure_mode,
              settings.require_fullscreen,settings.require_environment_declaration,
              settings.require_monitoring_consent,
              COALESCE((
                SELECT SUM((selector->>'count')::int)
                  FROM jsonb_array_elements(versions.selectors_json) AS selector
              ),0) AS question_count
         FROM assessment_blueprint_versions AS versions
         LEFT JOIN assessment_blueprint_delivery_settings AS settings
           ON settings.blueprint_version_id=versions.blueprint_version_id
        WHERE versions.blueprint_version_id=$1`,
      [blueprintVersionId]
    );
    const row = result.rows[0];
    if (!row || row.progression_mode === null || row.progression_mode === undefined) {
      return DEFAULT_ASSESSMENT_DELIVERY_SETTINGS;
    }
    return normalizeAssessmentDeliverySettings({
      progressionMode: row.progression_mode,
      sections: parseSections(row.section_config_json),
      requireCamera: Boolean(row.require_camera),
      requireMicrophone: Boolean(row.require_microphone),
      requireScreenShare: Boolean(row.require_screen_share),
      recordCamera: Boolean(row.record_camera),
      recordMicrophone: Boolean(row.record_microphone),
      recordScreen: Boolean(row.record_screen),
      recordingRetentionDays: Number(row.recording_retention_days),
      integrityFailureMode: row.integrity_failure_mode,
      requireFullscreen: Boolean(row.require_fullscreen),
      requireEnvironmentDeclaration: Boolean(row.require_environment_declaration),
      requireMonitoringConsent: Boolean(row.require_monitoring_consent)
    }, Number(row.question_count));
  }
}

let service: AssessmentDeliverySettingsService | null = null;
export function getAssessmentDeliverySettingsService(): AssessmentDeliverySettingsService {
  service ??= new AssessmentDeliverySettingsService();
  return service;
}
