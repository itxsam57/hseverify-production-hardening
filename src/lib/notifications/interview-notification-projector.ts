import "server-only";
import { bindTrustedSystemAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import {getDatabaseClient,type DatabaseClient} from "../database/database";
import {normalizeInterviewScheduledNotificationPayload,OutboxContractError,type OutboxJobRecord,type OutboxHandlerResult} from "../outbox/outbox-domain";

export async function projectInterviewScheduledNotification(job: OutboxJobRecord,database?: DatabaseClient): Promise<OutboxHandlerResult> {
 if (job.jobType !== "notification.interview.scheduled") throw new OutboxContractError();
 normalizeInterviewScheduledNotificationPayload(job.payload);
 const client=database ?? await getDatabaseClient();
 return client.transaction(async transaction => {
  const result=await transaction.query<{created:boolean;suppressed:boolean}>(
   "SELECT * FROM platform_project_interview_notification($1)",[job.jobId]);
  const projection=result.rows[0];if(!projection) throw new OutboxContractError();
  if(projection.created || projection.suppressed){
   await new DatabaseAuditRepository(Promise.resolve(transaction)).append(bindTrustedSystemAuditActor("outbox-worker"),{
    action: projection.suppressed ? "notification.interview.suppressed" : "notification.projected",
    outcome: "succeeded",target: {type:"job",reference:job.jobId},
    metadata:{notificationType:"interview.scheduled",reason:projection.suppressed ? "schedule_or_recipient_no_longer_eligible" : "projection_created"}
   });
  }
  return {kind:"succeeded" as const};
 });
}

// Called by the actual worker entry, not the generic/mock handler boundary.
export async function reconcileInterviewScheduledNotifications(database: DatabaseClient): Promise<Readonly<{examined:number;deferred:number}>> {
 const pending=await database.query<{audit_event_id:string}>(
  `SELECT source.audit_event_id FROM platform_audit_events source
   WHERE source.action_key='interview.scheduled' AND source.outcome='succeeded'
    AND NOT EXISTS(SELECT 1 FROM platform_audit_events intents
     WHERE intents.action_key='notification.interview.intent.recorded' AND intents.target_reference=source.audit_event_id)
    AND NOT EXISTS(SELECT 1 FROM platform_audit_events deferred
     WHERE deferred.action_key='notification.interview.enqueue.deferred' AND deferred.target_reference=source.audit_event_id
      AND deferred.recorded_at>CURRENT_TIMESTAMP-INTERVAL '30 seconds')
   ORDER BY source.audit_sequence ASC LIMIT 50`);
 let deferred=0;
 for(const event of pending.rows){
  const result=await database.query<{queued:number}>("SELECT platform_enqueue_interview_notifications($1) AS queued",[event.audit_event_id]);
  if(result.rows[0]?.queued===-1) deferred++;
 }
 return Object.freeze({examined:pending.rows.length,deferred});
}
