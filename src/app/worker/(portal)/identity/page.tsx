import { getDatabaseClient } from "@/lib/database/database";

import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { getWorkerIdentityCorrectionService } from "@/lib/identity/worker-identity-correction-service";
import { getWorkerIdentityDraftService } from "@/lib/identity/worker-identity-draft-service";
import { getWorkerIdentityEvidenceService } from "@/lib/identity/worker-identity-evidence-service";
import { getWorkerIdentityEligibilityService } from "@/lib/identity/worker-identity-eligibility-service";
import { getWorkerIdentityCheckService } from "@/lib/identity/worker-identity-check-service";
import { getWorkerIdentityService } from "@/lib/identity/worker-identity-service";
import { IdentityWorkspace } from "@/components/worker/identity-workspace";

export const dynamic = "force-dynamic";

export default async function WorkerIdentityPage(): Promise<React.JSX.Element> {
  const principal = await requirePortalAuthorization("worker");
  const identityService = getWorkerIdentityService();
  const draftService = getWorkerIdentityDraftService();
  const identity = await identityService.ensureDraft(principal);

  const [draft, evidence, checks, eligibility, correction] = await Promise.all([
    draftService.loadOrInitialize(principal),
    getWorkerIdentityEvidenceService().list(principal),
    getWorkerIdentityCheckService().loadOwn(principal),
    getWorkerIdentityEligibilityService().loadOwnStatus(principal),
    getWorkerIdentityCorrectionService().loadOwn(principal)
  ]);

  const review = await (await getDatabaseClient()).query<{ outcome: string; reason: string }>(
    `SELECT outcome,reason FROM(
       SELECT decisions.outcome,decisions.reason,decisions.decided_at AS occurred_at,decisions.decision_id AS event_id
       FROM evidence_review_decisions decisions JOIN evidence_review_tasks tasks ON tasks.task_id=decisions.task_id
       WHERE tasks.worker_account_id=$1 AND tasks.evidence_kind='identity'
       UNION ALL SELECT resolutions.outcome,resolutions.reason,resolutions.occurred_at,resolutions.event_id
       FROM evidence_review_resolution_events resolutions JOIN evidence_review_tasks tasks ON tasks.task_id=resolutions.task_id
       WHERE tasks.worker_account_id=$1 AND tasks.evidence_kind='identity'
      ) history ORDER BY occurred_at DESC,event_id DESC LIMIT 1`, [principal.accountId]);

  const workspaceRevision = [
    identity.currentVersion.identityVersionId,
    identity.identity.lockVersion,
    draft.draftRevision,
    ...evidence
      .filter((item) => item.status === "active")
      .map((item) => item.bindingId)
      .sort()
  ].join(":");

  return (
    <section id={identity.identity.identityId} className="profile-page" aria-labelledby="worker-identity-heading">
      <div className="profile-page-heading">
        <div>
          <p className="section-kicker">Worker assurance</p>
          <h1 id="worker-identity-heading">Identity</h1>
          <p className="profile-page-intro">
            Build one versioned identity record, attach private evidence and submit it for assurance.
            Submitted history is preserved; later verified-detail changes use a new correction version.
          </p>
        </div>
      </div>

      <IdentityWorkspace
        key={workspaceRevision}
        identity={identity}
        draft={draft}
        evidence={evidence}
        checks={checks}
        eligibility={eligibility}
        correction={correction}
        review={review.rows[0] ?? null}
      />
    </section>
  );
}
