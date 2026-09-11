import "server-only";

import { cache } from "react";

import type { WorkerSession } from "@/lib/auth/worker-session";
import type { WorkerDashboardProjection } from "@/lib/worker/dashboard-types";
import { getWorkerProfileView } from "@/lib/worker/profile-service";

type WorkerProjectionIdentity = Pick<
  WorkerSession,
  "sub" | "email" | "displayName" | "workerId"
>;

type WorkerProfileSummary = {
  displayName: string;
  completion: number;
};

function emptyProjection(
  session: WorkerProjectionIdentity,
  profile: WorkerProfileSummary
): WorkerDashboardProjection {
  return {
    generatedAt: new Date().toISOString(),
    worker: {
      id: session.workerId,
      displayName: profile.displayName,
      email: session.email,
      profileCompletion: profile.completion,
      publicProfileAvailable: false
    },
    identity: {
      status: "not_started",
      label: "Not started",
      explanation: "No committed identity submission is connected to this worker yet."
    },
    employment: {
      companyName: null,
      siteName: null,
      departmentName: null,
      linkStatus: "not_linked"
    },
    evidence: {
      verifiedQualifications: 0,
      pendingQualifications: 0,
      changesRequested: 0,
      verifiedExperienceRecords: 0,
      verifiedSkills: 0
    },
    assessments: [],
    assuranceCases: [],
    interview: null,
    credentials: [],
    reassessments: [],
    appeals: [],
    payments: {
      pendingAmount: 0,
      currency: "USD",
      recentStatus: "none"
    }
  };
}

function demonstrationProjection(
  session: WorkerProjectionIdentity,
  profile: WorkerProfileSummary
): WorkerDashboardProjection {
  return {
    generatedAt: new Date().toISOString(),
    worker: {
      id: session.workerId,
      displayName: profile.displayName,
      email: session.email,
      profileCompletion: profile.completion,
      publicProfileAvailable: true
    },
    identity: {
      status: "verified",
      label: "Verified",
      explanation: "Identity evidence was verified against the submitted record."
    },
    employment: {
      companyName: "Northstar Engineering Services",
      siteName: "Riyadh Operations",
      departmentName: "Projects",
      linkStatus: "active"
    },
    evidence: {
      verifiedQualifications: 3,
      pendingQualifications: 1,
      changesRequested: 0,
      verifiedExperienceRecords: 2,
      verifiedSkills: 5
    },
    assessments: [
      {
        id: "assessment-1",
        title: "Workplace Safety Knowledge Assessment",
        status: "assigned",
        detail: "Company assigned · funding approved",
        tone: "warning"
      },
      {
        id: "assessment-2",
        title: "Permit-to-Work Competency Renewal",
        status: "available",
        detail: "Available now from verified qualification evidence",
        tone: "positive"
      }
    ],
    assuranceCases: [
      {
        id: "case-1",
        reference: "AC-2026-004281",
        title: "Safety Officer Assurance",
        status: "assessment_pending",
        statusLabel: "Assessment pending",
        nextActionOwner: "worker",
        nextAction: "Complete the assigned knowledge assessment.",
        updatedAt: "2026-08-01T13:30:00.000Z",
        timeline: [
          {
            id: "timeline-1",
            title: "Application created",
            explanation: "The company assurance order created your worker-specific case.",
            occurredAt: "2026-07-28T09:00:00.000Z",
            state: "complete"
          },
          {
            id: "timeline-2",
            title: "Identity confirmed",
            explanation: "The verified worker identity was linked to this case.",
            occurredAt: "2026-07-29T11:15:00.000Z",
            state: "complete"
          },
          {
            id: "timeline-3",
            title: "Assessment assigned",
            explanation: "Funding and eligibility checks passed.",
            occurredAt: "2026-08-01T13:30:00.000Z",
            state: "current"
          },
          {
            id: "timeline-4",
            title: "Human review",
            explanation: "Review begins after the assessment is submitted.",
            occurredAt: "",
            state: "upcoming"
          },
          {
            id: "timeline-5",
            title: "Interview and decision",
            explanation: "The case policy requires a structured interview before decision.",
            occurredAt: "",
            state: "upcoming"
          }
        ]
      }
    ],
    interview: {
      id: "interview-1",
      title: "Structured competency interview",
      startsAt: "2026-08-06T10:00:00.000Z",
      joinWindowOpen: false,
      status: "scheduled"
    },
    credentials: [
      {
        id: "credential-1",
        title: "General HSE Awareness",
        status: "active",
        expiresAt: "2027-03-31T23:59:59.000Z"
      },
      {
        id: "credential-2",
        title: "Permit-to-Work Competency",
        status: "expiring",
        expiresAt: "2026-09-15T23:59:59.000Z"
      }
    ],
    reassessments: [
      {
        id: "reassessment-1",
        title: "Confined Space Entry",
        earliestDate: "2026-08-18T00:00:00.000Z",
        eligibleNow: false,
        attemptsUsed: 1,
        attemptsRemaining: 2
      }
    ],
    appeals: [],
    payments: {
      pendingAmount: 0,
      currency: "USD",
      recentStatus: "paid"
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

    if (process.env.HSE_USE_WORKER_DEMO_DATA === "true") {
      return demonstrationProjection(identity, profileSummary);
    }

    return emptyProjection(identity, profileSummary);
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
  const demoWorkerId = process.env.HSE_WORKER_DEMO_ID ?? "HSE-WRK-000001";
  if (
    process.env.HSE_USE_WORKER_DEMO_DATA !== "true" ||
    workerId !== demoWorkerId
  ) {
    return null;
  }

  return {
    workerId,
    displayName: process.env.HSE_WORKER_DEMO_NAME ?? "Demo Worker",
    status: "verified",
    verifiedAt: "2026-07-29T11:15:00.000Z"
  };
}
