import "server-only";

import { cache } from "react";

import type { WorkerSession } from "@/lib/auth/worker-session";
import { getDatabaseClient, type DatabaseClient } from "@/lib/database/database";
import type {
  AssuranceCaseStatus,
  DashboardTone,
  WorkerDashboardProjection
} from "@/lib/worker/dashboard-types";
import { getWorkerProfileView } from "@/lib/worker/profile-service";

type WorkerProjectionIdentity = Pick<
  WorkerSession,
  "sub" | "email" | "displayName" | "workerId"
>;

type WorkerProfileSummary = {
  displayName: string;
  completion: number;
};

type IdentityRow = { lifecycle_status: string };
type EmploymentRow = {
  link_status: string;
  company_name: string;
  site_name: string | null;
  department_name: string | null;
};
type EvidenceRow = {
  record_kind: "qualification" | "experience" | "employment" | "skill";
  version_status: string;
  review_status: string | null;
};
type AttemptRow = {
  attempt_id: string;
  status: string;
  title: string;
  case_id: string;
  updated_at: string | Date;
};
type CaseRow = {
  case_id: string;
  order_name: string;
  order_reference: string;
  case_status: string;
  owner_kind: string | null;
  next_action: string | null;
  updated_at: string | Date;
  closed_at: string | Date | null;
};
type TimelineRow = {
  timeline_event_id: string;
  case_id: string;
  event_type: string;
  from_status: string | null;
  to_status: string;
  owner_kind: string | null;
  next_action: string | null;
  occurred_at: string | Date;
};
type InterviewRow = {
  interview_request_id: string;
  status: string;
  requested_at: string | Date;
  scheduled_at: string | Date | null;
};
type CredentialRow = {
  credential_id: string;
  qualification: string;
  status: string;
  expires_at: string | Date | null;
};
type AppealRow = {
  appeal_id: string;
  credential_id: string;
  status: string;
};
type ReassessmentRow = {
  case_id: string;
  order_name: string;
  updated_at: string | Date;
  attempt_count: number | string;
};

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableTimestamp(value: string | Date | null): string | null {
  return value === null ? null : timestamp(value);
}

function identityProjection(status: string | null): WorkerDashboardProjection["identity"] {
  const normalized = status ?? "not_started";
  const mapping: Record<string, WorkerDashboardProjection["identity"]> = {
    draft: {
      status: "not_started",
      label: "Draft",
      explanation: "Complete your identity details and required evidence before submission."
    },
    submitted: {
      status: "pending",
      label: "Submitted",
      explanation: "Your identity submission is waiting for verification."
    },
    automated_checks: {
      status: "pending",
      label: "Automated checks",
      explanation: "Automated identity checks are in progress."
    },
    manual_review: {
      status: "pending",
      label: "Manual review",
      explanation: "An authorized reviewer is checking your submitted identity evidence."
    },
    more_info: {
      status: "changes_requested",
      label: "More information required",
      explanation: "Your identity submission needs more information before verification can continue."
    },
    verified: {
      status: "verified",
      label: "Verified",
      explanation: "Your current identity version has been verified."
    },
    correction_pending: {
      status: "changes_requested",
      label: "Correction pending",
      explanation: "A correction is waiting for review while the previous verified version remains preserved."
    },
    rejected: {
      status: "rejected",
      label: "Rejected",
      explanation: "Your current identity submission was rejected. Review the identity workspace for the next permitted action."
    },
    escalated: {
      status: "unable_to_verify",
      label: "Escalated",
      explanation: "Your identity submission requires additional authorized review."
    },
    expired_document: {
      status: "changes_requested",
      label: "Document expired",
      explanation: "An identity document requires replacement or renewal."
    },
    suspended: {
      status: "unable_to_verify",
      label: "Suspended",
      explanation: "Identity assurance is suspended pending an authorized review."
    },
    reinstated: {
      status: "verified",
      label: "Reinstated",
      explanation: "Identity assurance has been reinstated."
    },
    closed: {
      status: "unable_to_verify",
      label: "Closed",
      explanation: "This identity record is closed."
    },
    withdrawn: {
      status: "not_started",
      label: "Withdrawn",
      explanation: "The previous identity submission was withdrawn."
    },
    not_started: {
      status: "not_started",
      label: "Not started",
      explanation: "No committed identity submission is connected to this worker yet."
    }
  };
  return mapping[normalized] ?? mapping.not_started;
}

function caseStatus(value: string): AssuranceCaseStatus {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(" ", "_");
  const allowed: AssuranceCaseStatus[] = [
    "created",
    "awaiting_worker_acceptance",
    "identity_pending",
    "evidence_pending",
    "funding_pending",
    "assessment_pending",
    "assessment_in_progress",
    "review_pending",
    "interview_pending",
    "decision_pending",
    "approved",
    "conditionally_approved",
    "reassessment_required",
    "rejected",
    "suspended",
    "closed"
  ];
  return allowed.includes(normalized as AssuranceCaseStatus)
    ? (normalized as AssuranceCaseStatus)
    : "created";
}

function caseOwner(value: string | null): WorkerDashboardProjection["assuranceCases"][number]["nextActionOwner"] {
  if (value === "worker" || value === "company" || value === "reviewer" || value === "assessor") {
    return value;
  }
  return "system";
}

function statusLabel(value: string): string {
  return value.trim() || "Created";
}

function assessmentTone(status: WorkerDashboardProjection["assessments"][number]["status"]): DashboardTone {
  if (status === "completed" || status === "available") return "positive";
  if (status === "not_eligible") return "critical";
  if (status === "assigned" || status === "scheduled" || status === "in_progress" || status === "review_pending") {
    return "warning";
  }
  return "neutral";
}

function mapAttemptStatus(value: string): WorkerDashboardProjection["assessments"][number]["status"] {
  if (value === "IN_PROGRESS") return "in_progress";
  if (value === "SUBMITTED") return "review_pending";
  return "assigned";
}

function credentialStatus(row: CredentialRow, now: Date): WorkerDashboardProjection["credentials"][number]["status"] {
  if (row.status === "suspended") return "suspended";
  if (row.status === "revoked") return "revoked";
  if (row.status === "expired") return "expired";
  const expiry = row.expires_at ? new Date(row.expires_at) : null;
  if (expiry && Number.isFinite(expiry.getTime())) {
    if (expiry.getTime() <= now.getTime()) return "expired";
    if (expiry.getTime() - now.getTime() <= 60 * 24 * 60 * 60 * 1000) return "expiring";
  }
  return "active";
}

function appealStatus(value: string): WorkerDashboardProjection["appeals"][number]["status"] {
  if (value === "under_review") return "under_review";
  if (value === "accepted" || value === "rejected" || value === "withdrawn") return "decided";
  return "submitted";
}

async function liveProjection(
  database: DatabaseClient,
  session: WorkerProjectionIdentity,
  profile: WorkerProfileSummary
): Promise<WorkerDashboardProjection> {
  const [
    identityResult,
    employmentResult,
    evidenceResult,
    attemptResult,
    caseResult,
    timelineResult,
    interviewResult,
    credentialResult,
    appealResult,
    reassessmentResult
  ] = await Promise.all([
    database.query<IdentityRow>(
      `SELECT lifecycle_status
         FROM worker_identities
        WHERE worker_account_id=$1
        LIMIT 1`,
      [session.sub]
    ),
    database.query<EmploymentRow>(
      `SELECT links.link_status,
              tenants.display_name AS company_name,
              sites.name AS site_name,
              departments.name AS department_name
         FROM company_worker_links AS links
         JOIN platform_tenants AS tenants
           ON tenants.tenant_id=links.tenant_id
         LEFT JOIN company_sites AS sites
           ON sites.tenant_id=links.tenant_id
          AND sites.site_id=links.site_id
         LEFT JOIN company_departments AS departments
           ON departments.tenant_id=links.tenant_id
          AND departments.department_id=links.department_id
        WHERE links.worker_account_id=$1
          AND links.link_status IN ('active','pending_worker_acceptance')
        ORDER BY CASE links.link_status WHEN 'active' THEN 0 ELSE 1 END,
                 links.updated_at DESC
        LIMIT 1`,
      [session.sub]
    ),
    database.query<EvidenceRow>(
      `SELECT records.record_kind,
              versions.version_status,
              review.task_status AS review_status
         FROM worker_evidence_records AS records
         JOIN worker_evidence_versions AS versions
           ON versions.version_id=records.current_version_id
         LEFT JOIN LATERAL (
           SELECT tasks.task_status
             FROM evidence_review_tasks AS tasks
            WHERE tasks.worker_account_id=records.worker_account_id
              AND tasks.source_version_id=versions.version_id
            ORDER BY tasks.updated_at DESC, tasks.task_id DESC
            LIMIT 1
         ) AS review ON TRUE
        WHERE records.worker_account_id=$1
          AND records.lifecycle_status <> 'inactive'`,
      [session.sub]
    ),
    database.query<AttemptRow>(
      `SELECT attempts.attempt_id,
              attempts.status,
              catalogue.title,
              attempts.case_id,
              attempts.updated_at
         FROM assessment_attempts AS attempts
         JOIN assessment_catalogue_versions AS catalogue
           ON catalogue.catalogue_version_id=attempts.catalogue_version_id
        WHERE attempts.worker_account_id=$1
        ORDER BY attempts.updated_at DESC
        LIMIT 12`,
      [session.sub]
    ),
    database.query<CaseRow>(
      `SELECT cases.case_id,
              orders.order_name,
              orders.order_reference,
              cases.case_status,
              cases.owner_kind,
              cases.next_action,
              cases.updated_at,
              cases.closed_at
         FROM assurance_cases AS cases
         JOIN assurance_orders AS orders
           ON orders.order_id=cases.order_id
          AND orders.tenant_id=cases.tenant_id
        WHERE cases.worker_account_id=$1
        ORDER BY
          CASE WHEN cases.closed_at IS NULL THEN 0 ELSE 1 END,
          cases.updated_at DESC
        LIMIT 20`,
      [session.sub]
    ),
    database.query<TimelineRow>(
      `SELECT events.timeline_event_id,
              events.case_id,
              events.event_type,
              events.from_status,
              events.to_status,
              events.owner_kind,
              events.next_action,
              events.occurred_at
         FROM assurance_case_timeline_events AS events
         JOIN assurance_cases AS cases
           ON cases.case_id=events.case_id
        WHERE cases.worker_account_id=$1
        ORDER BY events.occurred_at ASC, events.timeline_event_id ASC`,
      [session.sub]
    ),
    database.query<InterviewRow>(
      `SELECT interview_request_id,status,requested_at,scheduled_at
         FROM interview_requests
        WHERE worker_account_id=$1
          AND status <> 'CANCELLED'
        ORDER BY
          CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END,
          COALESCE(scheduled_at,requested_at) DESC
        LIMIT 1`,
      [session.sub]
    ),
    database.query<CredentialRow>(
      `SELECT credential_id,qualification,status,expires_at
         FROM credential_issuances
        WHERE worker_id=$1
        ORDER BY issued_at DESC, credential_id DESC`,
      [session.workerId]
    ),
    database.query<AppealRow>(
      `SELECT appeal_id,credential_id,status
         FROM credential_appeals
        WHERE worker_id=$1
        ORDER BY updated_at DESC, appeal_id DESC`,
      [session.workerId]
    ),
    database.query<ReassessmentRow>(
      `SELECT cases.case_id,
              orders.order_name,
              cases.updated_at,
              COUNT(attempts.attempt_id)::int AS attempt_count
         FROM assurance_cases AS cases
         JOIN assurance_orders AS orders
           ON orders.order_id=cases.order_id
          AND orders.tenant_id=cases.tenant_id
         LEFT JOIN assessment_attempts AS attempts
           ON attempts.case_id=cases.case_id
          AND attempts.worker_account_id=cases.worker_account_id
        WHERE cases.worker_account_id=$1
          AND cases.case_status='Reassessment required'
        GROUP BY cases.case_id,orders.order_name,cases.updated_at
        ORDER BY cases.updated_at DESC`,
      [session.sub]
    )
  ]);

  const evidenceRows = evidenceResult.rows.filter((row) => row.version_status === "submitted");
  const verifiedQualifications = evidenceRows.filter(
    (row) => row.record_kind === "qualification" && row.review_status === "APPROVED"
  ).length;
  const pendingQualifications = evidenceRows.filter(
    (row) =>
      row.record_kind === "qualification" &&
      (row.review_status === null || row.review_status === "QUEUED" || row.review_status === "ASSIGNED")
  ).length;
  const changesRequested = evidenceRows.filter(
    (row) => row.review_status === "CHANGES_REQUESTED"
  ).length;
  const rejectedEvidence = evidenceRows.filter(
    (row) => row.review_status === "REJECTED"
  ).length;
  const verifiedExperienceRecords = evidenceRows.filter(
    (row) =>
      (row.record_kind === "experience" || row.record_kind === "employment") &&
      row.review_status === "APPROVED"
  ).length;
  const verifiedSkills = evidenceRows.filter(
    (row) => row.record_kind === "skill" && row.review_status === "APPROVED"
  ).length;

  const timelineByCase = new Map<string, TimelineRow[]>();
  for (const row of timelineResult.rows) {
    const rows = timelineByCase.get(row.case_id) ?? [];
    rows.push(row);
    timelineByCase.set(row.case_id, rows);
  }

  const activeCases = caseResult.rows.map((row) => {
    const timelineRows = timelineByCase.get(row.case_id) ?? [];
    return {
      id: row.case_id,
      reference: row.order_reference || row.case_id,
      title: row.order_name,
      status: caseStatus(row.case_status),
      statusLabel: statusLabel(row.case_status),
      nextActionOwner: caseOwner(row.owner_kind),
      nextAction: row.next_action ?? "No further action is currently required.",
      updatedAt: timestamp(row.updated_at),
      timeline: timelineRows.map((event, index) => ({
        id: event.timeline_event_id,
        title: event.to_status,
        explanation:
          event.next_action ??
          event.event_type.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase()),
        occurredAt: timestamp(event.occurred_at),
        state:
          index === timelineRows.length - 1 && row.closed_at === null
            ? ("current" as const)
            : ("complete" as const)
      }))
    };
  });

  const interviewRow = interviewResult.rows[0] ?? null;
  const now = new Date();
  const interview = interviewRow
    ? (() => {
        const startsAt = nullableTimestamp(interviewRow.scheduled_at) ?? timestamp(interviewRow.requested_at);
        const startTime = Date.parse(startsAt);
        const joinWindowOpen =
          interviewRow.status === "WAITING_ROOM" ||
          (interviewRow.status === "ASSIGNED" &&
            Number.isFinite(startTime) &&
            Math.abs(startTime - now.getTime()) <= 30 * 60 * 1000);
        const status: NonNullable<WorkerDashboardProjection["interview"]>["status"] =
          interviewRow.status === "COMPLETED"
            ? "completed"
            : joinWindowOpen
              ? "ready"
              : interviewRow.status === "REQUESTED"
                ? "reschedule_required"
                : "scheduled";
        return {
          id: interviewRow.interview_request_id,
          title: "Structured competency interview",
          startsAt,
          joinWindowOpen,
          status
        };
      })()
    : null;

  const employmentRow = employmentResult.rows[0] ?? null;

  return {
    generatedAt: now.toISOString(),
    worker: {
      id: session.workerId,
      displayName: profile.displayName,
      email: session.email,
      profileCompletion: profile.completion,
      publicProfileAvailable: identityResult.rows[0]?.lifecycle_status === "verified"
    },
    identity: identityProjection(identityResult.rows[0]?.lifecycle_status ?? null),
    employment: employmentRow
      ? {
          companyName: employmentRow.company_name,
          siteName: employmentRow.site_name,
          departmentName: employmentRow.department_name,
          linkStatus:
            employmentRow.link_status === "active"
              ? "active"
              : employmentRow.link_status === "pending_worker_acceptance"
                ? "pending"
                : "ended"
        }
      : {
          companyName: null,
          siteName: null,
          departmentName: null,
          linkStatus: "not_linked"
        },
    evidence: {
      verifiedQualifications,
      pendingQualifications,
      changesRequested,
      rejectedEvidence,
      verifiedExperienceRecords,
      verifiedSkills
    },
    assessments: attemptResult.rows.map((row) => {
      const status = mapAttemptStatus(row.status);
      return {
        id: row.attempt_id,
        title: row.title,
        status,
        detail:
          row.status === "IN_PROGRESS"
            ? "Assessment is in progress."
            : "Assessment was submitted and is waiting for the next review step.",
        tone: assessmentTone(status)
      };
    }),
    assuranceCases: activeCases,
    interview,
    credentials: credentialResult.rows.map((row) => ({
      id: row.credential_id,
      title: row.qualification,
      status: credentialStatus(row, now),
      expiresAt: nullableTimestamp(row.expires_at)
    })),
    reassessments: reassessmentResult.rows.map((row) => ({
      id: row.case_id,
      title: row.order_name,
      earliestDate: timestamp(row.updated_at),
      eligibleNow: true,
      attemptsUsed: Number(row.attempt_count),
      attemptsRemaining: null
    })),
    appeals: appealResult.rows.map((row) => ({
      id: row.appeal_id,
      reference: row.credential_id,
      status: appealStatus(row.status),
      title: `Credential appeal · ${row.credential_id}`
    })),
    payments: {
      pendingAmount: 0,
      currency: "USD",
      recentStatus: "none"
    }
  };
}

const getProjectionForWorker = cache(
  async (
    sub: string,
    email: string,
    displayName: string,
    workerId: string
  ): Promise<WorkerDashboardProjection> => {
    const identity: WorkerProjectionIdentity = {
      sub,
      email,
      displayName,
      workerId
    };
    const profile = await getWorkerProfileView(identity);
    const profileSummary: WorkerProfileSummary = {
      displayName: profile.displayName,
      completion: profile.completion
    };
    const database = await getDatabaseClient();
    return liveProjection(database, identity, profileSummary);
  }
);

export async function getWorkerDashboardProjection(
  session: WorkerSession
): Promise<WorkerDashboardProjection> {
  return getProjectionForWorker(
    session.sub,
    session.email,
    session.displayName,
    session.workerId
  );
}

export async function getPublicWorkerProjection(workerId: string): Promise<{
  workerId: string;
  displayName: string;
  status: "verified";
  verifiedAt: string;
} | null> {
  const database = await getDatabaseClient();
  const result = await database.query<{
    worker_reference: string;
    display_name: string;
    updated_at: string | Date;
  }>(
    `SELECT accounts.worker_reference,
            accounts.display_name,
            identities.updated_at
       FROM auth_accounts AS accounts
       JOIN worker_identities AS identities
         ON identities.worker_account_id=accounts.account_id
      WHERE accounts.worker_reference=$1
        AND accounts.account_status='active'
        AND identities.lifecycle_status='verified'
      LIMIT 1`,
    [workerId]
  );
  const row = result.rows[0];
  return row
    ? {
        workerId: row.worker_reference,
        displayName: row.display_name,
        status: "verified",
        verifiedAt: timestamp(row.updated_at)
      }
    : null;
}