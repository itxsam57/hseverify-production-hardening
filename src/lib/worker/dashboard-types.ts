export type VerificationStatus =
  | "not_started"
  | "pending"
  | "verified"
  | "changes_requested"
  | "unable_to_verify"
  | "rejected";

export type AssuranceCaseStatus =
  | "created"
  | "awaiting_worker_acceptance"
  | "identity_pending"
  | "evidence_pending"
  | "funding_pending"
  | "assessment_pending"
  | "assessment_in_progress"
  | "review_pending"
  | "interview_pending"
  | "decision_pending"
  | "approved"
  | "conditionally_approved"
  | "reassessment_required"
  | "rejected"
  | "suspended"
  | "closed";

export type DashboardTone = "neutral" | "positive" | "warning" | "critical";

export type WorkerDashboardProjection = {
  generatedAt: string;
  worker: {
    id: string;
    displayName: string;
    email: string;
    profileCompletion: number;
    publicProfileAvailable: boolean;
  };
  identity: {
    status: VerificationStatus;
    label: string;
    explanation: string;
  };
  employment: {
    companyName: string | null;
    siteName: string | null;
    departmentName: string | null;
    linkStatus: "not_linked" | "pending" | "active" | "ended";
  };
  evidence: {
    verifiedQualifications: number;
    pendingQualifications: number;
    changesRequested: number;
    verifiedExperienceRecords: number;
    verifiedSkills: number;
  };
  assessments: Array<{
    id: string;
    title: string;
    status:
      | "available"
      | "assigned"
      | "funding_pending"
      | "scheduled"
      | "in_progress"
      | "submitted"
      | "review_pending"
      | "completed"
      | "not_eligible";
    detail: string;
    tone: DashboardTone;
  }>;
  assuranceCases: Array<{
    id: string;
    reference: string;
    title: string;
    status: AssuranceCaseStatus;
    statusLabel: string;
    nextActionOwner: "worker" | "company" | "reviewer" | "assessor" | "system";
    nextAction: string;
    updatedAt: string;
    timeline: Array<{
      id: string;
      title: string;
      explanation: string;
      occurredAt: string;
      state: "complete" | "current" | "upcoming";
    }>;
  }>;
  interview: {
    id: string;
    title: string;
    startsAt: string;
    joinWindowOpen: boolean;
    status: "none" | "scheduled" | "ready" | "completed" | "reschedule_required";
  } | null;
  credentials: Array<{
    id: string;
    title: string;
    status: "active" | "conditional" | "expiring" | "expired" | "suspended";
    expiresAt: string | null;
  }>;
  reassessments: Array<{
    id: string;
    title: string;
    earliestDate: string;
    eligibleNow: boolean;
    attemptsUsed: number;
    attemptsRemaining: number | null;
  }>;
  appeals: Array<{
    id: string;
    reference: string;
    status: "eligible" | "submitted" | "under_review" | "decided";
    title: string;
  }>;
  payments: {
    pendingAmount: number;
    currency: string;
    recentStatus: "none" | "pending" | "paid" | "failed" | "refunded";
  };
};
