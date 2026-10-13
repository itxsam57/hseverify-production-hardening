import "server-only";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import type { DatabaseClient } from "../database/database";
import { EvidenceReviewAccessError } from "./evidence-review-domain";

export async function requireLiveReviewActor(database: DatabaseClient, principal: AuthorizationPrincipal, role: "admin" | "root" | "verifier" | "assessor", lock = false): Promise<void> {
  if (principal.activeRole !== role || principal.accountStatus !== "active" || principal.tenantMembership !== null) throw new EvidenceReviewAccessError();
  const result = await database.query(`SELECT 1 FROM auth_sessions sessions
    JOIN auth_accounts accounts ON accounts.account_id=sessions.account_id
    JOIN auth_account_roles roles ON roles.account_id=accounts.account_id AND roles.role=$3
    WHERE sessions.session_id=$1 AND sessions.account_id=$2 AND sessions.active_role=$3
      AND sessions.revoked_at IS NULL AND sessions.expires_at>CURRENT_TIMESTAMP AND accounts.account_status='active'
    ${lock ? "FOR UPDATE OF sessions,accounts,roles" : ""}`, [principal.sessionId,principal.accountId,role]);
  if (!result.rows[0]) throw new EvidenceReviewAccessError();
}

export type FrameworkRevision = Readonly<{ frameworkId: string; frameworkVersionId: string; frameworkReference: string; title: string; versionNo: number; effectiveFrom: string }>;
export async function listReviewFrameworkRevisions(database: DatabaseClient): Promise<readonly FrameworkRevision[]> {
  const result = await database.query<{framework_id:string;framework_version_id:string;framework_reference:string;title:string;version_no:number;effective_from:string|Date}>(
    `SELECT revisions.* FROM assurance_framework_revisions revisions JOIN assurance_frameworks frameworks USING(framework_id)
     WHERE frameworks.framework_status='ACTIVE' ORDER BY revisions.framework_reference,revisions.version_no DESC`);
  return result.rows.map(row => Object.freeze({frameworkId:row.framework_id,frameworkVersionId:row.framework_version_id,frameworkReference:row.framework_reference,title:row.title,versionNo:Number(row.version_no),effectiveFrom:new Date(row.effective_from).toISOString()}));
}

export type EffectiveCalibration = {calibration_id:string;status:string;valid_until:string|Date;framework_id:string;framework_version_id:string};
export async function latestEffectiveCalibration(database: DatabaseClient, accountId: string, role: "verifier"|"assessor", frameworkId: string, frameworkVersionId: string, at: Date): Promise<EffectiveCalibration | null> {
  const result = await database.query<EffectiveCalibration>(`SELECT calibrations.calibration_id,calibrations.status,calibrations.valid_until,calibrations.framework_id,calibrations.framework_version_id
    FROM staff_calibrations calibrations JOIN auth_accounts accounts ON accounts.account_id=calibrations.account_id
    JOIN auth_account_roles roles ON roles.account_id=accounts.account_id AND roles.role=calibrations.role
    WHERE calibrations.account_id=$1 AND calibrations.role=$2 AND calibrations.framework_id=$3 AND calibrations.framework_version_id=$4
      AND accounts.account_status='active' AND calibrations.valid_from<=$5
    ORDER BY calibrations.valid_from DESC,calibrations.calibration_sequence DESC LIMIT 1`,[accountId,role,frameworkId,frameworkVersionId,at.toISOString()]);
  return result.rows[0]??null;
}
