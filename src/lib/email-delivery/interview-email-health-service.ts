import "server-only";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import { getServerEnvironment } from "../config/server-environment";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";

export class InterviewEmailHealthAccessError extends Error {
  constructor() { super("Interview email operational health access is denied."); this.name = "InterviewEmailHealthAccessError"; }
}

type HealthRow = {
  queued: number; processing: number; retrying: number; sent: number; failed: number; suppressed: number;
  completed_attempts: number; failed_attempts: number; eligible_retries: number;
  last_accepted_at: string | Date | null; next_retry_at: string | Date | null; generated_at: string | Date;
};
export type InterviewEmailHealth = Readonly<{
  queued: number; processing: number; retrying: number; sent: number; failed: number; suppressed: number;
  queueDepth: number; eligibleRetries: number; completedAttempts24h: number; failedAttempts24h: number; failureRate24h: number | null;
  lastAcceptedAt: string | null; nextRetryAt: string | null; generatedAt: string;
}>;

// Reuse the existing retry job and provider key. Neither this query nor the action resets attempts or terminal states.
const ELIGIBLE_RETRIES_SQL = `
 SELECT jobs.job_id FROM platform_outbox_jobs jobs
 JOIN platform_email_deliveries deliveries ON deliveries.source_job_id=jobs.job_id
 WHERE jobs.job_type='email.interview.scheduled' AND jobs.status='retry_wait'
  AND deliveries.delivery_type='interview.scheduled' AND deliveries.status IN ('retry_wait','processing')
  AND jobs.attempt_count<jobs.max_attempts AND jobs.next_attempt_at>clock_timestamp()
  AND NOT EXISTS (
   SELECT 1 FROM platform_email_delivery_attempts attempt
   WHERE attempt.source_job_id=jobs.job_id AND attempt.adapter_key='resend'
    AND attempt.started_at<=clock_timestamp()-INTERVAL '23 hours'
  )
`;
const HEALTH_SQL = `
WITH authorized AS (
 SELECT sessions.session_id FROM auth_sessions sessions
 JOIN auth_accounts accounts ON accounts.account_id=sessions.account_id
 JOIN auth_account_roles roles ON roles.account_id=accounts.account_id AND roles.role='admin'
 WHERE sessions.session_id=$1 AND sessions.account_id=$2 AND sessions.active_role='admin'
  AND sessions.revoked_at IS NULL AND sessions.expires_at>clock_timestamp()
  AND accounts.account_status='active'
), deliveries AS (
 SELECT * FROM platform_email_deliveries WHERE delivery_type='interview.scheduled'
), counts AS (
 SELECT count(*) FILTER (WHERE status='queued')::int AS queued,
  count(*) FILTER (WHERE status='processing')::int AS processing,
  count(*) FILTER (WHERE status='retry_wait')::int AS retrying,
  count(*) FILTER (WHERE status='sent')::int AS sent,
  count(*) FILTER (WHERE status='terminal_failed')::int AS failed,
  count(*) FILTER (WHERE status='suppressed')::int AS suppressed
 FROM deliveries
), attempts AS (
 SELECT max(attempt.finished_at) FILTER (WHERE attempt.outcome='accepted') AS last_accepted_at,
  count(*) FILTER (WHERE attempt.finished_at>clock_timestamp()-INTERVAL '24 hours'
   AND attempt.outcome IN ('accepted','retryable_failure','terminal_failure'))::int AS completed_attempts,
  count(*) FILTER (WHERE attempt.finished_at>clock_timestamp()-INTERVAL '24 hours'
   AND attempt.outcome IN ('retryable_failure','terminal_failure'))::int AS failed_attempts
 FROM platform_email_delivery_attempts attempt JOIN deliveries ON deliveries.delivery_id=attempt.delivery_id
 WHERE attempt.adapter_key='resend'
), retries AS (
 SELECT min(jobs.next_attempt_at) AS next_retry_at FROM platform_outbox_jobs jobs
 JOIN deliveries ON deliveries.source_job_id=jobs.job_id
 WHERE jobs.job_type='email.interview.scheduled' AND jobs.status='retry_wait'
)
SELECT counts.*,attempts.*,retries.*,(SELECT count(*)::int FROM (${ELIGIBLE_RETRIES_SQL}) eligible) AS eligible_retries,clock_timestamp() AS generated_at
FROM authorized CROSS JOIN counts CROSS JOIN attempts CROSS JOIN retries
`;
const timestamp = (value: string | Date): string => new Date(value).toISOString();
export async function getInterviewEmailHealth(principal: AuthorizationPrincipal, database?: DatabaseClient): Promise<InterviewEmailHealth> {
  if (principal.activeRole !== "admin" || principal.accountStatus !== "active" || principal.tenantMembership !== null) {
    throw new InterviewEmailHealthAccessError();
  }
  const db = database ?? await getDatabaseClient();
  const row = (await db.query<HealthRow>(HEALTH_SQL, [principal.sessionId, principal.accountId])).rows[0];
  if (!row) throw new InterviewEmailHealthAccessError();
  return Object.freeze({
    queued: row.queued, processing: row.processing, retrying: row.retrying,
    sent: row.sent, failed: row.failed, suppressed: row.suppressed,
    queueDepth: row.queued + row.processing + row.retrying, eligibleRetries: row.eligible_retries,
    completedAttempts24h: row.completed_attempts, failedAttempts24h: row.failed_attempts,
    failureRate24h: row.completed_attempts ? row.failed_attempts / row.completed_attempts : null,
    lastAcceptedAt: row.last_accepted_at ? timestamp(row.last_accepted_at) : null,
    nextRetryAt: row.next_retry_at ? timestamp(row.next_retry_at) : null,
    generatedAt: timestamp(row.generated_at)
  });
}

export class InterviewEmailRetryUnavailableError extends Error {
  constructor() { super("Configure interview email delivery before requesting a retry."); this.name = "InterviewEmailRetryUnavailableError"; }
}
const ADMIN_RETRY_ACCESS_SQL = `
 SELECT sessions.session_id FROM auth_sessions sessions
 JOIN auth_accounts accounts ON accounts.account_id=sessions.account_id
 JOIN auth_account_roles roles ON roles.account_id=accounts.account_id AND roles.role='admin'
 WHERE sessions.session_id=$1 AND sessions.account_id=$2 AND sessions.active_role='admin'
  AND sessions.revoked_at IS NULL AND sessions.expires_at>clock_timestamp() AND accounts.account_status='active'
 FOR UPDATE OF sessions,accounts,roles
`;
export async function requestInterviewEmailRetries(principal: AuthorizationPrincipal, database?: DatabaseClient): Promise<number> {
  if (principal.activeRole !== "admin" || principal.accountStatus !== "active" || principal.tenantMembership !== null) {
    throw new InterviewEmailHealthAccessError();
  }
  const db = database ?? await getDatabaseClient();
  return db.transaction(async (transaction) => {
    const requireLiveAdmin = async () => {
      if (!(await transaction.query(ADMIN_RETRY_ACCESS_SQL, [principal.sessionId,principal.accountId])).rows[0]) {
        throw new InterviewEmailHealthAccessError();
      }
    };
    await requireLiveAdmin();
    const environment = getServerEnvironment(), providers = environment.registrationOtpProviders;
    if (!providers?.emailApiKey || !providers.emailFrom || !environment.publicBaseUrl) throw new InterviewEmailRetryUnavailableError();
    const candidates = await transaction.query<{job_id:string}>(
      ELIGIBLE_RETRIES_SQL + " ORDER BY jobs.next_attempt_at,jobs.job_id LIMIT 50 FOR UPDATE OF jobs SKIP LOCKED"
    );
    // A lock wait must not extend the authorization lifetime.
    await requireLiveAdmin();
    let count = 0;
    for (const candidate of candidates.rows) {
      const updated = await transaction.query<{job_id:string}>(
        "UPDATE platform_outbox_jobs SET next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() " +
        "WHERE job_id=$1 AND job_id IN (" + ELIGIBLE_RETRIES_SQL + ") RETURNING job_id", [candidate.job_id]
      );
      if (!updated.rows[0]) continue;
      await new DatabaseAuditRepository(Promise.resolve(transaction)).append(bindTrustedAuditActor(principal), {
        action: "email.delivery.retry_scheduled", outcome: "succeeded", reason: "manual_retry",
        target: {type:"job",reference:candidate.job_id},
        metadata: {deliveryType:"interview.scheduled",adapterKey:"resend",manual:true}
      });
      count++;
    }
    // Audit work must not allow an expired session to commit the retry request.
    await requireLiveAdmin();
    return count;
  });
}
