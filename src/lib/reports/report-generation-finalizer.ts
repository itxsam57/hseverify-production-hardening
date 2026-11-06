import type { DatabaseClient } from "../database/database";
import type { OutboxJobRecord } from "../outbox/outbox-domain";

// Called in the outbox transaction when the final worker lease expires.
export async function finalizeReportGenerationFailure(database: DatabaseClient, job: OutboxJobRecord): Promise<void> {
  if (job.jobType !== "report.generation" || job.status !== "terminal_failed") return;
  const code = job.lastErrorCode === "report_generation_denied" ? "report_generation_denied" : "report_generation_exhausted";
  if (job.enqueuedByRole === "worker" && job.enqueuedByAccountId && !job.tenantId && !job.membershipId && !job.enqueuedBySystemComponent) {
    await database.query("UPDATE worker_report_deliveries SET status='failed',last_error_code=$3 WHERE generation_job_id=$1 AND requested_by=$2 AND status<>'delivered'",[job.jobId,job.enqueuedByAccountId,code]);
    return;
  }
  if (!job.tenantId || !job.membershipId) return;
  await database.query(
    "UPDATE report_deliveries SET status='failed',last_error_code=$4 WHERE tenant_id=$1 AND generation_job_id=$2 AND requested_by_membership_id=$3 AND status<>'delivered'",
    [job.tenantId, job.jobId, job.membershipId, code]
  );
}
