import {
  WorkerEvidenceWorkspace,
  type WorkerEvidenceWorkspaceRecord
} from "@/components/worker/worker-evidence-workspace";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { settleLocalWorkerIdentityFileScan } from "@/lib/identity/worker-identity-local-processing-service";
import { getSecureFileScanService } from "@/lib/secure-files/secure-file-scan-service";
import { getSecureFileService } from "@/lib/secure-files/secure-file-service";
import { getSecureFileUploadService } from "@/lib/secure-files/secure-file-upload-service";
import { WorkerEvidenceAttachmentService } from "@/lib/worker-evidence/worker-evidence-attachment-service";
import { WorkerEvidenceService } from "@/lib/worker-evidence/worker-evidence-service";

export const dynamic = "force-dynamic";

export default async function WorkerEvidencePage(): Promise<React.JSX.Element> {
  const principal = await requirePortalAuthorization("worker");
  const database = getDatabaseClient();
  const evidence = new WorkerEvidenceService(database);
  const fileEvidence = new WorkerEvidenceAttachmentService(
    database,
    getSecureFileService(),
    getSecureFileUploadService(),
    getSecureFileScanService(),
    settleLocalWorkerIdentityFileScan
  );

  const databaseClient = await database;
  const currentRecords = await evidence.listCurrent(principal);
  const records = await Promise.all(
    currentRecords.map(async (record): Promise<WorkerEvidenceWorkspaceRecord> => {
      const [attachments, pendingCandidates, versions, leavingLetters, reviewResult] = await Promise.all([
        fileEvidence.listForRecord(principal, record.recordId),
        fileEvidence.listPendingForRecord(principal, record.recordId),
        evidence.listVersions(principal, record.recordId),
        record.kind === "employment"
          ? fileEvidence.listLeavingLetters(principal, record.recordId)
          : Promise.resolve([]),
        databaseClient.query<{
          task_status: string;
          reason: string | null;
          decided_at: string | Date | null;
        }>(
          `SELECT tasks.task_status,
                  decisions.reason,
                  decisions.decided_at
             FROM evidence_review_tasks AS tasks
             LEFT JOIN evidence_review_decisions AS decisions
               ON decisions.task_id=tasks.task_id
            WHERE tasks.worker_account_id=$1
              AND tasks.source_version_id=$2
            ORDER BY tasks.updated_at DESC, tasks.task_id DESC
            LIMIT 1`,
          [record.workerAccountId, record.currentVersion.versionId]
        )
      ]);
      const { workerAccountId, ...workerSafeRecord } = record;
      void workerAccountId;
      return Object.freeze({
        ...workerSafeRecord,
        attachments,
        pendingCandidates,
        versions,
        leavingLetters,
        verificationStatus: reviewResult.rows[0]?.task_status ?? null,
        verificationReason: reviewResult.rows[0]?.reason ?? null,
        verificationDecidedAt: reviewResult.rows[0]?.decided_at
          ? new Date(reviewResult.rows[0].decided_at).toISOString()
          : null
      });
    })
  );

  return (
    <section className="profile-page" aria-labelledby="worker-evidence-heading">
      <div className="profile-page-heading">
        <div>
          <p className="section-kicker">Worker evidence</p>
          <h1 id="worker-evidence-heading">Qualifications, experience, employment and skills</h1>
          <p className="profile-page-intro">
            Keep each evidence record and its files together. Submitted versions remain immutable,
            later changes create new history, skill assurance states stay distinct, and a leaving
            letter is bound to the exact ended employment it belongs to.
          </p>
        </div>
      </div>

      <WorkerEvidenceWorkspace records={records} />
    </section>
  );
}
