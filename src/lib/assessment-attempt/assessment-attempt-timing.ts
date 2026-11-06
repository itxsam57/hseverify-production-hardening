import "server-only";

import type { TrustedUserAuditActor } from "../audit/audit-domain";
import { DatabaseOutboxRepository } from "../outbox/outbox-repository";

import type { DatabaseClient } from "../database/database";
import type { AssessmentDeliverySettings } from "../assessment-generation/assessment-delivery-settings";
import type { AssessmentAttemptRecord } from "./assessment-attempt-domain";
import { AssessmentAttemptConflictError } from "./assessment-attempt-domain";
import { CaseAccommodationService } from "../privacy/case-accommodation-service";
import { snapshotAssessmentBreakAllowance,readAssessmentBreakState } from "./assessment-accommodation-break";

export type AssessmentTimingView = Readonly<{
  mode: "COMBINED" | "SEPARATE";
  phaseIndex: number;
  deadlineAt: string;
  remainingSeconds: number;
  expired: boolean;
}>;

export async function snapshotAssessmentClock(
  database: DatabaseClient,
  attempt: AssessmentAttemptRecord,
  delivery: AssessmentDeliverySettings,
  now: Date,
  actor: TrustedUserAuditActor
): Promise<void> {
  const approved=await snapshotAssessmentBreakAllowance(database,attempt,now);
  if (!delivery.timing) return;
  const { adjustment } = approved ?? await new CaseAccommodationService(Promise.resolve(database))
    .resolveForWorker(attempt.caseId, attempt.workerAccountId);
  const durations = delivery.timing.mode === "COMBINED"
    ? [delivery.timing.durationSeconds]
    : delivery.sections.map(section => section.durationSeconds!);
  const adjusted = durations.map(duration => Math.ceil(duration * adjustment.timeMultiplier));
  await database.query(
    "INSERT INTO assessment_attempt_time_policies(attempt_id,blueprint_version_id,timing_mode,time_multiplier,phase_durations_json,snapshotted_at) VALUES($1,$2,$3,$4,$5::jsonb,$6)",
    [attempt.attemptId,attempt.blueprintVersionId,delivery.timing.mode,adjustment.timeMultiplier,JSON.stringify(adjusted),now.toISOString()]
  );
  await startAssessmentPhaseClock(database, attempt.attemptId, delivery.timing.mode === "COMBINED" ? 0 : 1, now, actor);
}

export async function startAssessmentPhaseClock(
  database: DatabaseClient, attemptId: string, phaseIndex: number, now: Date, actor?: TrustedUserAuditActor
): Promise<void> {
  const result = await database.query<{ timing_mode: string; phase_durations_json: unknown }>(
    "SELECT timing_mode,phase_durations_json FROM assessment_attempt_time_policies WHERE attempt_id=$1", [attemptId]
  );
  const policy = result.rows[0];
  if (!policy) throw new AssessmentAttemptConflictError("Assessment timing policy is unavailable.");
  const durations = (typeof policy.phase_durations_json === "string" ? JSON.parse(policy.phase_durations_json) : policy.phase_durations_json) as number[];
  const duration = durations[policy.timing_mode === "COMBINED" ? 0 : phaseIndex - 1];
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > 172800) {
    throw new AssessmentAttemptConflictError("Assessment time allowance is invalid.");
  }
  await database.query(
    "INSERT INTO assessment_attempt_clocks(attempt_id,phase_index,started_at,deadline_at) VALUES($1,$2,$3,$4) ON CONFLICT(attempt_id,phase_index) DO NOTHING",
    [attemptId,phaseIndex,now.toISOString(),new Date(now.getTime() + duration * 1000).toISOString()]
  );
  const clock = await database.query<{ deadline_at: string | Date }>(
    "SELECT deadline_at FROM assessment_attempt_clocks WHERE attempt_id=$1 AND phase_index=$2",
    [attemptId,phaseIndex]
  );
  await scheduleAssessmentExpiryFromDeadline(database,attemptId,phaseIndex,new Date(clock.rows[0].deadline_at).toISOString(),actor);
}
export async function scheduleAssessmentExpiryFromDeadline(database:DatabaseClient,attemptId:string,phaseIndex:number,deadlineAtInput:string,actor?:TrustedUserAuditActor):Promise<void>{
 const policy=(await database.query<{timing_mode:string;phase_durations_json:unknown}>("SELECT timing_mode,phase_durations_json FROM assessment_attempt_time_policies WHERE attempt_id=$1",[attemptId])).rows[0];
 if(!policy)throw new AssessmentAttemptConflictError("Assessment timing policy is unavailable.");
 const durations=(typeof policy.phase_durations_json==="string"?JSON.parse(policy.phase_durations_json):policy.phase_durations_json) as number[];
  let deadline = new Date(deadlineAtInput);
  // Begin/manual advance schedules all remaining phases. System catch-up uses those
  // durable intents and starts the next clock at the preceding immutable deadline.
  const phases = policy.timing_mode === "COMBINED" ? [0] :
    Array.from({length:durations.length-phaseIndex+1}, (_, index) => phaseIndex+index);
  for (const phase of phases) {
    if (phase !== phaseIndex) deadline = new Date(deadline.getTime()+durations[phase-1]*1000);
    const deadlineAt = deadline.toISOString();
    if (actor) {
      await new DatabaseOutboxRepository(Promise.resolve(database)).enqueueInTransaction(database,actor,{
        jobType:"assessment.attempt.expiry",
        businessKey:`${attemptId}:${phase}:${deadlineAt}`,
        availableAt:deadlineAt,
        payload:{attemptRef:attemptId,phaseIndex:phase,deadlineAt}
      });
    } else {
      const intent = await database.query(
        "SELECT job_id FROM platform_outbox_jobs WHERE job_type='assessment.attempt.expiry' AND payload->>'attemptRef'=$1 AND payload->>'phaseIndex'=$2 AND payload->>'deadlineAt'=$3",
        [attemptId,String(phase),deadlineAt]
      );
      if (!intent.rows[0]) throw new AssessmentAttemptConflictError("Assessment expiry intent is unavailable.");
    }
  }
}

export async function readAssessmentClock(
  database: DatabaseClient, attempt: AssessmentAttemptRecord,
  delivery: AssessmentDeliverySettings, now: Date
): Promise<AssessmentTimingView | null> {
  // Immutable legacy blueprints have no timing policy, including historical test schemas.
  if (!delivery.timing || (attempt.status === "SUBMITTED" || attempt.status === "AUTO_SUBMITTED")) return null;
  const phaseIndex = delivery.timing.mode === "COMBINED"
    ? 0 : delivery.sections.findIndex(section => attempt.currentPosition <= section.endPosition) + 1;
  if (phaseIndex < 0 || (delivery.timing.mode === "SEPARATE" && phaseIndex === 0)) {
    throw new AssessmentAttemptConflictError("Assessment timer section is unavailable.");
  }
  const result = await database.query<{ deadline_at: string | Date; timing_mode: string }>(
    "SELECT clocks.deadline_at,policies.timing_mode FROM assessment_attempt_clocks AS clocks JOIN assessment_attempt_time_policies AS policies USING(attempt_id) WHERE clocks.attempt_id=$1 AND clocks.phase_index=$2 AND policies.blueprint_version_id=$3",
    [attempt.attemptId,phaseIndex,attempt.blueprintVersionId]
  );
  const row = result.rows[0];
  if (!row || row.timing_mode !== delivery.timing.mode) {
    throw new AssessmentAttemptConflictError("Assessment clock is unavailable; request controlled recovery.");
  }
  const breaks=await readAssessmentBreakState(database,attempt,now,phaseIndex);
  const deadline=new Date(new Date(row.deadline_at).getTime()+breaks.phaseExtensionSeconds*1000);
  if (!Number.isFinite(deadline.getTime())) throw new AssessmentAttemptConflictError("Assessment deadline is invalid.");
  return Object.freeze({
    mode: delivery.timing.mode, phaseIndex, deadlineAt: deadline.toISOString(),
    remainingSeconds: Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 1000)-breaks.activeRemainingSeconds),
    expired: now.getTime() >= deadline.getTime()
  });
}

export async function assertAssessmentTimeAvailable(
  database: DatabaseClient, attempt: AssessmentAttemptRecord, now: Date
): Promise<void> {
  const { AssessmentDeliverySettingsService } = await import("../assessment-generation/assessment-delivery-settings-service");
  const delivery = await new AssessmentDeliverySettingsService(Promise.resolve(database)).get(attempt.blueprintVersionId);
  const timing = await readAssessmentClock(database, attempt, delivery, now);
  const breaks=await readAssessmentBreakState(database,attempt,now);
  if(breaks.view?.active)throw new AssessmentAttemptConflictError("An approved break is active. Questions and answer changes resume when it ends.");
  if (timing?.expired) throw new AssessmentAttemptConflictError("Assessment time has expired. Previously saved responses are retained; use controlled recovery.");
}
