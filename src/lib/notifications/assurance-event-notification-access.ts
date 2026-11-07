import "server-only";
import type {AuthorizationPrincipal} from "../authorization/authorization-context-domain";
import type {DatabaseClient} from "../database/database";
import {ASSURANCE_EVENT_TYPES} from "../outbox/outbox-domain";
import type {NotificationRecord} from "./notification-domain";

export async function canOpenAssuranceEventNotification(
 database:DatabaseClient,principal:AuthorizationPrincipal,notification:NotificationRecord
):Promise<boolean>{
 if(!ASSURANCE_EVENT_TYPES.some(type=>type===notification.notificationType))return true;
 if(!("eventRef" in notification.metadata) || notification.recipientAccountId!==principal.accountId || notification.recipientRole!==principal.activeRole)return false;
 const membership=principal.tenantMembership;
 const result=await database.query(
  "SELECT 1 FROM platform_assurance_event_recipients($1,$2) eligible "+
  "JOIN platform_outbox_jobs source ON source.job_id=$3 AND source.job_type='notification.assurance.event' "+
   "AND source.payload=jsonb_build_object('eventType',$1::text,'eventRef',$2::text) "+
  "WHERE eligible.account_id=$4 AND eligible.role=$5 AND eligible.tenant_id IS NOT DISTINCT FROM $6::text "+
   "AND eligible.membership_id IS NOT DISTINCT FROM $7::text AND eligible.notification_type=$1 "+
   "AND eligible.target_key=$8 AND eligible.target_reference=$9",
  [notification.notificationType,notification.metadata.eventRef,notification.sourceJobId,principal.accountId,
   principal.activeRole,membership?.tenantId??null,membership?.membershipId??null,notification.target,notification.targetReference]);
 return !!result.rows[0];
}
