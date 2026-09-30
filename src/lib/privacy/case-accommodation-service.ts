import "server-only";

import { getDatabaseClient, type DatabaseClient } from "../database/database";
import type { AccommodationAdjustment } from "./privacy-operations-service";

export const DEFAULT_ACCOMMODATION_ADJUSTMENT: AccommodationAdjustment = Object.freeze({
  timeMultiplier: 1,
  extraBreakMinutes: 0,
  screenReader: false,
  captions: false,
  interpreter: false,
  reducedMotion: false
});

function parseAdjustment(value: unknown): AccommodationAdjustment {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return DEFAULT_ACCOMMODATION_ADJUSTMENT;
  }
  const input = parsed as Record<string, unknown>;
  const timeMultiplier = Number(input.timeMultiplier ?? 1);
  const extraBreakMinutes = Number(input.extraBreakMinutes ?? 0);
  return Object.freeze({
    timeMultiplier: Number.isFinite(timeMultiplier) ? Math.min(2, Math.max(1, timeMultiplier)) : 1,
    extraBreakMinutes: Number.isFinite(extraBreakMinutes)
      ? Math.min(60, Math.max(0, Math.floor(extraBreakMinutes)))
      : 0,
    screenReader: Boolean(input.screenReader),
    captions: Boolean(input.captions),
    interpreter: Boolean(input.interpreter),
    reducedMotion: Boolean(input.reducedMotion)
  });
}

function mergeAdjustments(values: readonly AccommodationAdjustment[]): AccommodationAdjustment {
  return Object.freeze(values.reduce<AccommodationAdjustment>((merged, value) => Object.freeze({
    timeMultiplier: Math.max(merged.timeMultiplier, value.timeMultiplier),
    extraBreakMinutes: Math.max(merged.extraBreakMinutes, value.extraBreakMinutes),
    screenReader: merged.screenReader || value.screenReader,
    captions: merged.captions || value.captions,
    interpreter: merged.interpreter || value.interpreter,
    reducedMotion: merged.reducedMotion || value.reducedMotion
  }), DEFAULT_ACCOMMODATION_ADJUSTMENT));
}

export type CaseAccommodationView = Readonly<{
  caseId: string;
  workerId: string;
  adjustment: AccommodationAdjustment;
  accommodationIds: readonly string[];
}>;

export class CaseAccommodationService {
  constructor(private readonly databasePromise: Promise<DatabaseClient> = getDatabaseClient()) {}

  async resolveForWorker(caseId: string, workerId: string): Promise<CaseAccommodationView> {
    const database = await this.databasePromise;
    const owned = await database.query<{ case_id: string; worker_account_id: string }>(
      "SELECT case_id,worker_account_id FROM assurance_cases WHERE case_id=$1 AND worker_account_id=$2",
      [caseId, workerId]
    );
    if (!owned.rows[0]) throw new Error("Assurance Case is unavailable for this Worker.");

    const result = await database.query<{ accommodation_id: string; adjustment: unknown }>(
      `SELECT accommodation_id,adjustment
         FROM assurance_case_accommodation_overlays
        WHERE case_id=$1 AND worker_id=$2
        ORDER BY approved_at,overlay_id`,
      [caseId, workerId]
    );
    const adjustments = result.rows.map((row) => parseAdjustment(row.adjustment));
    return Object.freeze({
      caseId,
      workerId,
      adjustment: mergeAdjustments(adjustments),
      accommodationIds: Object.freeze(result.rows.map((row) => row.accommodation_id))
    });
  }
}
