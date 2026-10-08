import "server-only";
import type {AuthorizationPrincipal} from "../authorization/authorization-context-domain";
import type {DatabaseClient} from "../database/database";
import type {NotificationRecord} from "./notification-domain";
export async function canOpenInterviewNotification(database:DatabaseClient,principal:AuthorizationPrincipal,notification:NotificationRecord):Promise<boolean>{
 if(notification.notificationType !== "interview.scheduled" && notification.notificationType !== "interview.reminder")return true;
 if(notification.target === "interview.record" && ["worker","assessor"].includes(principal.activeRole)){
  const result=await database.query<{interview_request_id:string}>(
   `SELECT interview_request_id FROM interview_requests WHERE interview_request_id=$1
    AND (($2='worker' AND worker_account_id=$3) OR ($2='assessor' AND assessor_account_id=$3))`,
   [notification.targetReference,principal.activeRole,principal.accountId]);
  return !!result.rows[0];
 }
 if(notification.target === "company.assurance.case" && principal.activeRole === "company" && principal.tenantMembership){
  const references=notification.targetReference?.split("#");if(references?.length!==2)return false;
  const membership=principal.tenantMembership;
  const result=await database.query<{case_id:string}>(
   `SELECT cases.case_id FROM assurance_cases cases
    JOIN auth_tenant_memberships memberships ON memberships.tenant_id=cases.tenant_id
    JOIN platform_tenants tenants ON tenants.tenant_id=memberships.tenant_id
    JOIN auth_tenant_role_permission_ceiling ceiling ON ceiling.membership_role=memberships.membership_role
     AND ceiling.permission_key='company.orders.read'
    WHERE cases.order_id=$1 AND cases.case_id=$2 AND cases.tenant_id=$3
     AND memberships.membership_id=$4 AND memberships.account_id=$5 AND memberships.portal_role='company'
     AND memberships.membership_status='active' AND tenants.tenant_status='active'
     AND NOT EXISTS(SELECT 1 FROM auth_tenant_permission_overrides denied
      WHERE denied.membership_id=memberships.membership_id AND denied.permission_key='company.orders.read' AND denied.effect='deny')`,
   [references[0],references[1],membership.tenantId,membership.membershipId,principal.accountId]);
  return !!result.rows[0];
 }
 return false;
}
