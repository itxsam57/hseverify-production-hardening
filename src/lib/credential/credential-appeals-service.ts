import "server-only";

import { getDatabaseClient, type DatabaseClient } from "../database/database";
import {
  appendLivingCompetencyVersion,
  currentLivingCompetencyVersion
} from "../living-record/living-record-domain";
import { LivingRecordRepository } from "../living-record/living-record-repository";
import { CredentialIssuanceRepository } from "./credential-issuance-repository";
import { CredentialLifecycleService } from "./credential-lifecycle-service";
import { issueAppealRenewal } from "./credential-renewal-service";
import {
  reviewCredentialAppeal,
  submitCredentialAppeal,
  transitionCredentialAppeal,
  type AppealOutcomeAction,
  type CredentialAppeal
} from "./credential-appeals-domain";
import { CredentialAppealsRepository } from "./credential-appeals-repository";

function livingStatusForAction(action: AppealOutcomeAction) {
  return action === "renew"
    ? "valid" as const
    : action === "suspend"
      ? "suspended" as const
      : action === "revoke"
        ? "revoked" as const
        : "reassessment_required" as const;
}

async function updateLivingRecordForOutcome(input: {
  database: DatabaseClient;
  appeal: CredentialAppeal;
  action: AppealOutcomeAction;
  reviewReason: string;
  reviewedAt: string;
  replaced?: boolean;
}): Promise<number> {
  if (input.action === "none") return 0;
  const repository = new LivingRecordRepository(Promise.resolve(input.database));
  const records = await repository.findByCredential(input.appeal.credentialId);
  let updatedCount = 0;
  for (const record of records) {
    const current = currentLivingCompetencyVersion(record);
    const reassessment = input.action === "reassessment"
      ? {
          required: true,
          dueAt: null,
          reason: `Appeal accepted: ${input.reviewReason}`
        }
      : {
          required: false,
          dueAt: null,
          reason: null
        };
    const next = appendLivingCompetencyVersion(record, {
      status: input.replaced ? "revoked" : livingStatusForAction(input.action),
      effectiveAt: input.reviewedAt,
      expiresAt: current.expiresAt,
      restrictions: input.replaced ? [...current.restrictions,"This issuance has been replaced. Verify the current credential shared by the Worker."] : current.restrictions,
      conditions: current.conditions,
      reassessment
    });
    await repository.replaceCompetencyRecord(input.appeal.workerId, next);
    updatedCount += 1;
  }
  return updatedCount;
}

export class CredentialAppealsService {
  constructor(private readonly clientPromise: Promise<DatabaseClient> = getDatabaseClient(), private readonly signingSecret?: string) {}

  async submit(
    input: {
      credentialId: string;
      workerId: string;
      reason: string;
      evidence?: readonly string[];
      createdAt: string;
    },
    sequence: string
  ): Promise<CredentialAppeal> {
    const database = await this.clientPromise;
    const repository = new CredentialAppealsRepository(Promise.resolve(database));
    const existing = await repository.findOpenForCredential(input.credentialId);
    if (existing) throw new Error("An appeal is already open for this credential.");
    const appeal = submitCredentialAppeal(input, sequence);
    return repository.save(appeal);
  }

  async review(
    appeal: CredentialAppeal,
    status: CredentialAppeal["status"],
    reviewerId = ""
  ): Promise<CredentialAppeal> {
    const database = await this.clientPromise;
    return database.transaction(async (transaction) => {
      const repository = new CredentialAppealsRepository(Promise.resolve(transaction));
      const current = await repository.find(appeal.appealId);
      if (!current) throw new Error("Appeal not found.");
      if (current.version !== appeal.version) throw new Error("Appeal update conflict.");
      if (status === "submitted" || status === "withdrawn") {
        throw new Error("Appeal review status is invalid.");
      }
      await repository.assertIndependentReviewer(current, reviewerId);
      const reviewed = reviewCredentialAppeal(current, {
        status,
        reviewerId,
        reason: "Appeal status reviewed.",
        outcomeAction: "none",
        reviewedAt: new Date().toISOString()
      });
      return repository.updateStatus(reviewed);
    });
  }

  async reviewOutcome(
    appeal: CredentialAppeal,
    input: {
      status: "under_review" | "accepted" | "rejected";
      reviewerId: string;
      reason: string;
      outcomeAction?: AppealOutcomeAction;
      reviewedAt?: string;
    }
  ) {
    const database = await this.clientPromise;
    return database.transaction(async (transaction) => {
      const appeals = new CredentialAppealsRepository(Promise.resolve(transaction));
      const current = await appeals.find(appeal.appealId);
      if (!current) throw new Error("Appeal not found.");
      if (current.version !== appeal.version) throw new Error("Appeal update conflict.");
      await appeals.assertIndependentReviewer(current, input.reviewerId);

      const reviewedAt = input.reviewedAt ?? new Date().toISOString();
      const updated = reviewCredentialAppeal(current, {
        status: input.status,
        reviewerId: input.reviewerId,
        reason: input.reason,
        outcomeAction: input.outcomeAction,
        reviewedAt
      });
      const persisted = await appeals.updateStatus(updated);

      let credentialAction: string | null = null;
      let livingRecordVersionsAdded = 0;
      let replacement: Awaited<ReturnType<typeof issueAppealRenewal>> | null = null;
      if (persisted.status === "accepted") {
        const action = persisted.outcomeAction ?? "none";
        if (action === "renew") {
          replacement = await issueAppealRenewal(transaction,persisted,this.signingSecret);
          credentialAction = action;
        } else if (action === "suspend" || action === "revoke") {
          const credentialRepository = new CredentialIssuanceRepository(Promise.resolve(transaction));
          const credential = await credentialRepository.findPublic(persisted.credentialId);
          if (!credential || credential.workerId !== persisted.workerId) {
            throw new Error("Appealed credential ownership is invalid.");
          }
          const lifecycle = new CredentialLifecycleService(credentialRepository);
          await lifecycle.changeStatus({
            credentialId: credential.credentialId,
            action,
            currentStatus: credential.status,
            version: credential.version
          });
          credentialAction = action;
        }
        livingRecordVersionsAdded = await updateLivingRecordForOutcome({
          database: transaction,
          appeal: persisted,
          action,
          reviewReason: persisted.reviewReason ?? input.reason,
          reviewedAt,
          replaced: Boolean(replacement)
        });
      }

      return {
        appeal: persisted,
        livingRecordAction:
          persisted.status === "accepted"
            ? persisted.outcomeAction === "reassessment"
              ? "reassessment_required"
              : livingRecordVersionsAdded > 0
                ? "superseded"
                : "unchanged"
            : persisted.status === "rejected"
              ? "unchanged"
              : "pending",
        credentialAction,
        replacement,
        livingRecordVersionsAdded
      };
    });
  }

  async withdraw(appeal: CredentialAppeal, workerId: string): Promise<CredentialAppeal> {
    if (appeal.workerId !== workerId) throw new Error("Appeal withdrawal is forbidden.");
    if (appeal.status !== "submitted" && appeal.status !== "under_review") {
      throw new Error("Completed appeals cannot be withdrawn.");
    }
    const database = await this.clientPromise;
    return database.transaction(async transaction=>{
      // Match followup finalization: original case, appeal, then linked requests.
      await transaction.query("SELECT case_id FROM assurance_cases WHERE credential_reference=$1 AND permanent_worker_id=$2 FOR UPDATE",[appeal.credentialId,workerId]);
      await transaction.query("SELECT appeal_id FROM credential_appeals WHERE appeal_id=$1 FOR UPDATE",[appeal.appealId]);
      const repository = new CredentialAppealsRepository(Promise.resolve(transaction));
      const current = await repository.find(appeal.appealId);
      if (!current || current.workerId !== workerId) throw new Error("Appeal not found.");
      if(current.version!==appeal.version)throw new Error("Appeal update conflict.");
      if((await transaction.query<{relation:string|null}>("SELECT to_regclass('credential_appeal_followup_events') AS relation")).rows[0]?.relation){
        await transaction.query(`WITH RECURSIVE chain AS(
          SELECT interviews.interview_request_id FROM credential_appeal_followup_events request JOIN interview_requests interviews ON interviews.interview_request_id=request.interview_request_id
          WHERE request.appeal_id=$1 AND request.kind='interview' AND request.event_type='requested' AND NOT EXISTS(SELECT 1 FROM credential_appeal_followup_events response WHERE response.request_id=request.event_id)
          UNION SELECT successor.interview_request_id FROM interview_requests successor JOIN chain prior ON successor.replaces_interview_request_id=prior.interview_request_id
        ) UPDATE interview_requests SET status='CANCELLED' WHERE interview_request_id IN(SELECT interview_request_id FROM chain) AND status IN('REQUESTED','ASSIGNED','WAITING_ROOM')`,[appeal.appealId]);
      }
      return repository.updateStatus(transitionCredentialAppeal(current, "withdrawn"));
    });
  }
}