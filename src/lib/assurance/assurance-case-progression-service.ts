import "server-only";

import type { DatabaseClient } from "../database/database";
import { InterviewSchedulingService } from "../interview/interview-scheduling-service";
import { InterviewAssignmentService } from "../interview/interview-assignment-service";
import {
  createAssuranceActionId,
  createAssuranceTimelineEventId,
  type AssuranceCaseStatus,
  type AssurancePendingOwner
} from "./assurance-order-domain";
import { AssuranceOrderRepository } from "./assurance-order-repository";

type CaseRow = {
  case_id: string;
  order_id: string;
  tenant_id: string;
  worker_account_id: string;
  case_status: AssuranceCaseStatus;
};

type ProgressionActor = Readonly<{
  accountId: string;
  role: string;
}>;

type TransitionInput = Readonly<{
  caseId: string;
  tenantId: string;
  status: AssuranceCaseStatus;
  owner: AssurancePendingOwner | null;
  nextAction: string | null;
  eventType: string;
  actor: ProgressionActor;
  now: Date;
}>;

async function loadCase(
  database: DatabaseClient,
  caseId: string,
  tenantId?: string
): Promise<CaseRow> {
  const result = await database.query<CaseRow>(
    `SELECT case_id,order_id,tenant_id,worker_account_id,case_status
       FROM assurance_cases
      WHERE case_id=$1
        AND ($2::text IS NULL OR tenant_id=$2)
      FOR UPDATE`,
    [caseId, tenantId ?? null]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Assurance Case was not found for workflow progression.");
  return row;
}

async function replaceCaseAction(
  database: DatabaseClient,
  row: CaseRow,
  owner: AssurancePendingOwner | null,
  nextAction: string | null,
  now: Date
): Promise<void> {
  await database.query(
    `UPDATE assurance_action_items
        SET action_status='resolved',updated_at=$2
      WHERE case_id=$1
        AND action_status<>'resolved'`,
    [row.case_id, now.toISOString()]
  );
  if (!owner || owner === "background_job" || !nextAction) return;
  const inserted = await new AssuranceOrderRepository(database).insertAction({
    actionId: createAssuranceActionId(),
    tenantId: row.tenant_id,
    orderId: row.order_id,
    caseId: row.case_id,
    workerAccountId: row.worker_account_id,
    severity: "warning",
    reason: nextAction,
    dueAt: null,
    owner,
    allowedAction: "open_case",
    deepLink: `/company/assurance-orders/${row.order_id}#${row.case_id}`,
    statutory: false,
    now: now.toISOString()
  });
  if (!inserted) throw new Error("Assurance Case action could not be persisted.");
}

async function transitionCase(
  database: DatabaseClient,
  input: TransitionInput
): Promise<void> {
  const row = await loadCase(database, input.caseId, input.tenantId);
  const updated = await database.query(
    `UPDATE assurance_cases
        SET case_status=$3,
            owner_kind=$4,
            next_action=$5,
            updated_at=$6,
            closed_at=CASE
              WHEN $3 IN ('Rejected','Closed') THEN COALESCE(closed_at,$6)
              ELSE closed_at
            END
      WHERE case_id=$1 AND tenant_id=$2`,
    [
      row.case_id,
      row.tenant_id,
      input.status,
      input.owner,
      input.nextAction,
      input.now.toISOString()
    ]
  );
  if (updated.affectedRows !== 1) {
    throw new Error("Assurance Case progression could not be persisted.");
  }
  await new AssuranceOrderRepository(database).insertTimeline({
    eventId: createAssuranceTimelineEventId(),
    tenantId: row.tenant_id,
    orderId: row.order_id,
    caseId: row.case_id,
    eventType: input.eventType,
    fromStatus: row.case_status,
    toStatus: input.status,
    owner: input.owner,
    nextAction: input.nextAction,
    actorAccountId: input.actor.accountId,
    actorRole: input.actor.role,
    now: input.now.toISOString()
  });
  await replaceCaseAction(database, row, input.owner, input.nextAction, input.now);
}

async function postPassProgression(
  database: DatabaseClient,
  row: CaseRow,
  actor: ProgressionActor,
  now: Date,
  eventType: string
): Promise<void> {
  const requirement = await database.query<{ interview_required: boolean }>(
    `SELECT orders.interview_required
       FROM assurance_orders AS orders
      WHERE orders.order_id=$1 AND orders.tenant_id=$2`,
    [row.order_id, row.tenant_id]
  );
  if (requirement.rows[0]?.interview_required) {
    const interviews = new InterviewSchedulingService(database);
    let request = await interviews.requestInterview({
      tenantId: row.tenant_id,
      caseId: row.case_id,
      workerAccountId: row.worker_account_id,
      requestedAt: now.toISOString(),
      timezone: "UTC"
    });
    if (!request.assessorAccountId) {
      const assignment = await new InterviewAssignmentService(database)
        .evaluateAndPersist(request.interviewRequestId, now);
      if (assignment.selectedAssessorAccountId) {
        request = await interviews.assignInterview({
          tenantId: row.tenant_id,
          request,
          assessorAccountId: assignment.selectedAssessorAccountId
        });
      }
    }
    await database.query(
      `UPDATE assurance_cases
          SET interview_reference=$3
        WHERE case_id=$1 AND tenant_id=$2`,
      [row.case_id, row.tenant_id, request.interviewRequestId]
    );
    await transitionCase(database, {
      caseId: row.case_id,
      tenantId: row.tenant_id,
      status: "Interview pending",
      owner: request.assessorAccountId ? "assessor" : "admin",
      nextAction: request.assessorAccountId
        ? "Assigned assessor must schedule and complete the required interview."
        : "Assign an active assessor to the required interview.",
      eventType,
      actor,
      now
    });
    return;
  }

  await transitionCase(database, {
    caseId: row.case_id,
    tenantId: row.tenant_id,
    status: "Decision pending",
    owner: "admin",
    nextAction: "Record the final Assurance Case decision.",
    eventType,
    actor,
    now
  });
}


export async function queueAssessmentReviewCase(
  database: DatabaseClient,
  input: Readonly<{
    caseId: string;
    reviewerAccountId: string | null;
    actor: ProgressionActor;
    now: Date;
  }>
): Promise<void> {
  const row = await loadCase(database, input.caseId);
  if (row.case_status !== "Assessment in progress") {
    throw new Error("Assessment submission no longer matches the Assurance Case state.");
  }
  await transitionCase(database, {
    caseId: row.case_id,
    tenantId: row.tenant_id,
    status: "Review pending",
    owner: input.reviewerAccountId ? "reviewer" : "admin",
    nextAction: input.reviewerAccountId
      ? "Assigned verifier must score the submitted assessment."
      : "Assign an active verifier to score the submitted assessment.",
    eventType: "assessment_submission_queued_for_review",
    actor: input.actor,
    now: input.now
  });
}

export async function advanceAfterObjectiveAssessment(
  database: DatabaseClient,
  input: Readonly<{
    caseId: string;
    decision: "PASS" | "FAIL";
    actor: ProgressionActor;
    now: Date;
  }>
): Promise<void> {
  const row = await loadCase(database, input.caseId);
  if (row.case_status !== "Assessment in progress") {
    throw new Error("Assessment result no longer matches the Assurance Case state.");
  }
  if (input.decision === "PASS") {
    await postPassProgression(
      database,
      row,
      input.actor,
      input.now,
      "assessment_auto_scored_pass"
    );
    return;
  }
  await transitionCase(database, {
    caseId: row.case_id,
    tenantId: row.tenant_id,
    status: "Reassessment required",
    owner: "worker",
    nextAction: "Complete the required reassessment before this Assurance Case can advance.",
    eventType: "assessment_auto_scored_fail",
    actor: input.actor,
    now: input.now
  });
}

export async function advanceAfterAssessmentReview(
  database: DatabaseClient,
  input: Readonly<{
    caseId: string;
    tenantId: string;
    decision: "PASS" | "FAIL" | "CHANGES_REQUESTED";
    actor: ProgressionActor;
    now: Date;
  }>
): Promise<void> {
  const row = await loadCase(database, input.caseId, input.tenantId);
  if (row.case_status !== "Review pending") {
    throw new Error("Assessment review no longer matches the Assurance Case state.");
  }
  if (input.decision === "PASS") {
    await postPassProgression(
      database,
      row,
      input.actor,
      input.now,
      "assessment_review_completed"
    );
    return;
  }
  await transitionCase(database, {
    caseId: row.case_id,
    tenantId: row.tenant_id,
    status: "Reassessment required",
    owner: "worker",
    nextAction:
      input.decision === "CHANGES_REQUESTED"
        ? "A verifier requested a new assessment attempt with corrected responses."
        : "Complete the required reassessment before this Assurance Case can advance.",
    eventType: "assessment_review_completed",
    actor: input.actor,
    now: input.now
  });
}

export async function advanceAfterInterviewRecommendation(
  database: DatabaseClient,
  input: Readonly<{
    caseId: string;
    tenantId: string;
    recommendation:
      | "PASS"
      | "CONDITIONAL_PASS"
      | "ADDITIONAL_EVIDENCE_REQUIRED"
      | "REASSESSMENT_REQUIRED"
      | "SECOND_INTERVIEW_REQUIRED"
      | "FAIL";
    actor: ProgressionActor;
    now: Date;
  }>
): Promise<void> {
  const row = await loadCase(database, input.caseId, input.tenantId);
  if (row.case_status !== "Interview pending") {
    throw new Error("Interview recommendation no longer matches the Assurance Case state.");
  }

  if (input.recommendation === "SECOND_INTERVIEW_REQUIRED") {
    const interviews = new InterviewSchedulingService(database);
    let request = await interviews.requestAdditionalInterview({
      tenantId: row.tenant_id,
      caseId: row.case_id,
      workerAccountId: row.worker_account_id,
      requestedAt: input.now.toISOString(),
      timezone: "UTC"
    });
    const assignment = await new InterviewAssignmentService(database)
      .evaluateAndPersist(request.interviewRequestId, input.now);
    if (assignment.selectedAssessorAccountId) {
      request = await interviews.assignInterview({
        tenantId: row.tenant_id,
        request,
        assessorAccountId: assignment.selectedAssessorAccountId
      });
    }
    await database.query(
      `UPDATE assurance_cases
          SET interview_reference=$3
        WHERE case_id=$1 AND tenant_id=$2`,
      [row.case_id, row.tenant_id, request.interviewRequestId]
    );
    await transitionCase(database, {
      caseId: row.case_id,
      tenantId: row.tenant_id,
      status: "Interview pending",
      owner: request.assessorAccountId ? "assessor" : "admin",
      nextAction: request.assessorAccountId
        ? "Assigned Assessor must schedule and complete the required second interview."
        : "Assign an eligible Assessor to the required second interview.",
      eventType: "interview_second_interview_required",
      actor: input.actor,
      now: input.now
    });
    return;
  }

  const transition =
    input.recommendation === "PASS" || input.recommendation === "CONDITIONAL_PASS"
      ? {
          status: "Decision pending" as const,
          owner: "admin" as const,
          nextAction:
            input.recommendation === "CONDITIONAL_PASS"
              ? "Record the final Assurance Case decision and any permitted approval conditions."
              : "Record the final Assurance Case decision."
        }
      : input.recommendation === "ADDITIONAL_EVIDENCE_REQUIRED"
        ? {
            status: "Evidence pending" as const,
            owner: "worker" as const,
            nextAction: "Submit the additional evidence required by the interview recommendation."
          }
        : {
            status: "Reassessment required" as const,
            owner: "worker" as const,
            nextAction: "Complete the required reassessment before this Assurance Case can advance."
          };

  await transitionCase(database, {
    caseId: row.case_id,
    tenantId: row.tenant_id,
    status: transition.status,
    owner: transition.owner,
    nextAction: transition.nextAction,
    eventType: "interview_recommendation_submitted",
    actor: input.actor,
    now: input.now
  });
}
