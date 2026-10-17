import "server-only";
import {requireLiveReviewActor} from "../review/review-calibration-authority";
import {interviewCalibrationCurrent} from "./interview-calibration-authority";

import { createIdentifier } from "@/lib/auth/auth-domain";
import type { AuthorizationPrincipal } from "@/lib/authorization/authorization-context-domain";
import { getDatabaseClient, type DatabaseClient } from "@/lib/database/database";

type JsonArray = readonly string[];

type CandidateRow = {
  account_id: string;
  display_name: string;
  trade_scopes: unknown;
  qualification_scopes: unknown;
  languages: unknown;
  jurisdictions: unknown;
  risk_levels: unknown;
  availability_json: unknown;
  max_active_interviews: number | string;
  active_interviews: number | string;
  calibrated: boolean;
  conflicted: boolean;
};

export type InterviewAssignmentCandidate = Readonly<{
  assessorAccountId: string;
  displayName: string;
  eligible: boolean;
  score: number;
  rationale: string;
  checks: Readonly<{
    profileActive: boolean;
    tradeScope: boolean;
    qualificationScope: boolean;
    language: boolean;
    jurisdiction: boolean;
    risk: boolean;
    availability: boolean;
    workload: boolean;
    calibration: boolean;
    conflictFree: boolean;
  }>;
}>;

export type InterviewAssignmentResult = Readonly<{
  interviewRequestId: string;
  selectedAssessorAccountId: string | null;
  candidates: readonly InterviewAssignmentCandidate[];
}>;


export type AssessorMatchingProfileView = Readonly<{
  assessorAccountId: string;
  displayName: string;
  email: string;
  tradeScopes: readonly string[];
  qualificationScopes: readonly string[];
  languages: readonly string[];
  jurisdictions: readonly string[];
  riskLevels: readonly string[];
  availability: Readonly<Record<string, unknown>>;
  maxActiveInterviews: number;
  status: "ACTIVE" | "PAUSED";
}>;

export type UnassignedInterviewView = Readonly<{
  interviewRequestId: string;
  caseId: string;
  workerName: string;
  tradeScope: string | null;
  qualificationScope: string | null;
  riskLevel: string;
  language: string;
  jurisdiction: string;
  requestedAt: string;
}>;

export class InterviewAssignmentInputError extends Error {
  constructor(message = "Interview assignment input is invalid.") {
    super(message);
    this.name = "InterviewAssignmentInputError";
  }
}

function array(value: unknown): JsonArray {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed) as unknown; } catch { return Object.freeze([]); }
  }
  if (!Array.isArray(parsed)) return Object.freeze([]);
  return Object.freeze(
    parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 100)
  );
}

function object(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function scopeMatches(required: string | null, scopes: JsonArray): boolean {
  if (!required?.trim()) return true;
  const normalized = required.trim().toLowerCase();
  return scopes.some((scope) =>
    scope === "*" ||
    scope.toLowerCase() === normalized
  );
}

function listMatches(required: string, values: JsonArray): boolean {
  const normalized = required.trim().toLowerCase();
  return values.some((value) =>
    value === "*" ||
    value.toLowerCase() === normalized
  );
}

function availableNow(value: unknown, now: Date): boolean {
  const availability = object(value);
  if (availability.unavailable === true) return false;
  const unavailableUntil = typeof availability.unavailableUntil === "string"
    ? Date.parse(availability.unavailableUntil)
    : Number.NaN;
  if (Number.isFinite(unavailableUntil) && now.getTime() < unavailableUntil) return false;

  const weekdays = Array.isArray(availability.availableWeekdays)
    ? availability.availableWeekdays
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6)
    : [];
  if (weekdays.length > 0 && !weekdays.includes(now.getUTCDay())) return false;
  return true;
}

function candidateScore(input: {
  tradeExact: boolean;
  qualificationExact: boolean;
  languageExact: boolean;
  jurisdictionExact: boolean;
  riskExact: boolean;
  activeInterviews: number;
  maxActiveInterviews: number;
}): number {
  const remaining = Math.max(0, input.maxActiveInterviews - input.activeInterviews);
  return (
    (input.tradeExact ? 100 : 0) +
    (input.qualificationExact ? 100 : 0) +
    (input.languageExact ? 80 : 0) +
    (input.jurisdictionExact ? 80 : 0) +
    (input.riskExact ? 80 : 0) +
    Math.min(100, remaining * 10)
  );
}

export class InterviewAssignmentService {
  constructor(private readonly database: DatabaseClient) {}

  async evaluate(
    interviewRequestId: string,
    now = new Date()
  ): Promise<InterviewAssignmentResult> {
    const requestId = interviewRequestId.trim();
    if (!requestId) throw new InterviewAssignmentInputError();

    const requestResult = await this.database.query<{
      interview_request_id: string;
      tenant_id: string;
      worker_account_id: string;
      trade_scope: string | null;
      qualification_scope: string | null;
      risk_level: string;
      language: string;
      jurisdiction: string;
      assessor_account_id: string | null;
      framework_reference: string | null;
    }>(
      `SELECT requests.interview_request_id,requests.tenant_id,requests.worker_account_id,
              requests.trade_scope,requests.qualification_scope,requests.risk_level,
              requests.language,requests.jurisdiction,requests.assessor_account_id,
              frameworks.framework_reference
         FROM interview_requests AS requests
         JOIN assurance_cases AS cases ON cases.case_id=requests.case_id
         LEFT JOIN assurance_case_policy_snapshots AS snapshots ON snapshots.case_id=cases.case_id
         LEFT JOIN assurance_frameworks AS frameworks ON frameworks.framework_id=snapshots.framework_id
        WHERE requests.interview_request_id=$1
        LIMIT 1`,
      [requestId]
    );
    const request = requestResult.rows[0];
    if (!request) throw new InterviewAssignmentInputError("Interview request is unavailable.");
    if (request.assessor_account_id) {
      return Object.freeze({
        interviewRequestId: requestId,
        selectedAssessorAccountId: request.assessor_account_id,
        candidates: Object.freeze([])
      });
    }

    const candidates = await this.database.query<CandidateRow>(
      `SELECT accounts.account_id,accounts.display_name,
              profiles.trade_scopes,profiles.qualification_scopes,profiles.languages,
              profiles.jurisdictions,profiles.risk_levels,profiles.availability_json,
              profiles.max_active_interviews,
              COUNT(active_requests.interview_request_id)::int AS active_interviews,
              FALSE AS calibrated,
              EXISTS(
                SELECT 1
                  FROM interview_assignment_conflicts AS conflicts
                 WHERE conflicts.assessor_account_id=accounts.account_id
                   AND conflicts.worker_account_id=$1
                   AND conflicts.active=TRUE
              ) AS conflicted
         FROM auth_accounts AS accounts
         JOIN auth_account_roles AS roles
           ON roles.account_id=accounts.account_id AND roles.role='assessor'
         JOIN assessor_assignment_profiles AS profiles
           ON profiles.assessor_account_id=accounts.account_id
          AND profiles.profile_status='ACTIVE'
         LEFT JOIN interview_requests AS active_requests
           ON active_requests.assessor_account_id=accounts.account_id
          AND active_requests.status IN ('ASSIGNED','WAITING_ROOM')
        WHERE accounts.account_status='active'
        GROUP BY accounts.account_id,accounts.display_name,
                 profiles.trade_scopes,profiles.qualification_scopes,profiles.languages,
                 profiles.jurisdictions,profiles.risk_levels,profiles.availability_json,
                 profiles.max_active_interviews`,
      [request.worker_account_id]
    );

    for(const candidate of candidates.rows)candidate.calibrated=await interviewCalibrationCurrent(this.database,candidate.account_id,requestId);
    const evaluated = candidates.rows.map((row): InterviewAssignmentCandidate => {
      const trades = array(row.trade_scopes);
      const qualifications = array(row.qualification_scopes);
      const languages = array(row.languages);
      const jurisdictions = array(row.jurisdictions);
      const risks = array(row.risk_levels);
      const activeInterviews = Number(row.active_interviews);
      const maxActiveInterviews = Number(row.max_active_interviews);

      const tradeScope = scopeMatches(request.trade_scope, trades);
      const qualificationScope = scopeMatches(request.qualification_scope, qualifications);
      const language = listMatches(request.language, languages);
      const jurisdiction = listMatches(request.jurisdiction, jurisdictions);
      const risk = listMatches(request.risk_level, risks);
      const availability = availableNow(row.availability_json, now);
      const workload = activeInterviews < maxActiveInterviews;
      const calibration = Boolean(row.calibrated);
      const conflictFree = !row.conflicted;
      const eligible =
        tradeScope &&
        qualificationScope &&
        language &&
        jurisdiction &&
        risk &&
        availability &&
        workload &&
        calibration &&
        conflictFree;

      const score = eligible ? candidateScore({
        tradeExact: Boolean(request.trade_scope && trades.some((v) => v.toLowerCase() === request.trade_scope?.toLowerCase())),
        qualificationExact: Boolean(request.qualification_scope && qualifications.some((v) => v.toLowerCase() === request.qualification_scope?.toLowerCase())),
        languageExact: languages.some((v) => v.toLowerCase() === request.language.toLowerCase()),
        jurisdictionExact: jurisdictions.some((v) => v.toLowerCase() === request.jurisdiction.toLowerCase()),
        riskExact: risks.some((v) => v.toLowerCase() === request.risk_level.toLowerCase()),
        activeInterviews,
        maxActiveInterviews
      }) : 0;

      const failed = Object.entries({
        tradeScope,
        qualificationScope,
        language,
        jurisdiction,
        risk,
        availability,
        workload,
        calibration,
        conflictFree
      }).filter(([, value]) => !value).map(([key]) => key);

      return Object.freeze({
        assessorAccountId: row.account_id,
        displayName: row.display_name,
        eligible,
        score,
        rationale: eligible
          ? `Eligible: ${activeInterviews}/${maxActiveInterviews} active interviews, framework calibration current.`
          : `Ineligible: ${failed.join(", ")}.`,
        checks: Object.freeze({
          profileActive: true,
          tradeScope,
          qualificationScope,
          language,
          jurisdiction,
          risk,
          availability,
          workload,
          calibration,
          conflictFree
        })
      });
    }).sort((left, right) =>
      Number(right.eligible) - Number(left.eligible) ||
      right.score - left.score ||
      left.assessorAccountId.localeCompare(right.assessorAccountId)
    );

    const selected = evaluated.find((candidate) => candidate.eligible) ?? null;
    return Object.freeze({
      interviewRequestId: requestId,
      selectedAssessorAccountId: selected?.assessorAccountId ?? null,
      candidates: Object.freeze(evaluated)
    });
  }

  async evaluateAndPersist(
    interviewRequestId: string,
    now = new Date()
  ): Promise<InterviewAssignmentResult> {
    const result = await this.evaluate(interviewRequestId, now);
    const request = await this.database.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM interview_requests WHERE interview_request_id=$1",
      [interviewRequestId]
    );
    const tenantId = request.rows[0]?.tenant_id;
    if (!tenantId) throw new InterviewAssignmentInputError("Interview request is unavailable.");

    await this.database.query(
      "DELETE FROM interview_assignment_decisions WHERE tenant_id=$1 AND interview_request_id=$2",
      [tenantId, interviewRequestId]
    );
    for (const candidate of result.candidates) {
      await this.database.query(
        `INSERT INTO interview_assignment_decisions(
           assignment_decision_id,interview_request_id,tenant_id,assessor_account_id,
           selected,eligibility_json,score,rationale,created_at
         ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
        [
          createIdentifier("interview_assignment"),
          interviewRequestId,
          tenantId,
          candidate.assessorAccountId,
          candidate.assessorAccountId === result.selectedAssessorAccountId,
          JSON.stringify(candidate.checks),
          candidate.score,
          candidate.rationale,
          now.toISOString()
        ]
      );
    }
    return result;
  }

  async declareConflictAndRematch(
    principal: AuthorizationPrincipal,
    interviewRequestId: string,
    reasonInput: string,
    now = new Date()
  ): Promise<InterviewAssignmentResult> {
    if (principal.activeRole !== "assessor" || principal.accountStatus !== "active") {
      throw new InterviewAssignmentInputError("Assessor access is required.");
    }
    const reason = reasonInput.trim();
    if (reason.length < 5 || reason.length > 2000) {
      throw new InterviewAssignmentInputError("Conflict reason must contain between 5 and 2000 characters.");
    }
    const request = await this.database.query<{
      interview_request_id: string;
      tenant_id: string;
      worker_account_id: string;
      assessor_account_id: string | null;
      status: string;
    }>(
      `SELECT interview_request_id,tenant_id,worker_account_id,assessor_account_id,status
         FROM interview_requests
        WHERE interview_request_id=$1
        FOR UPDATE`,
      [interviewRequestId]
    );
    const row = request.rows[0];
    if (
      !row ||
      row.assessor_account_id !== principal.accountId ||
      !["ASSIGNED","WAITING_ROOM"].includes(row.status)
    ) {
      throw new InterviewAssignmentInputError("This interview is not assigned to the current Assessor.");
    }

    await this.database.query(
      `INSERT INTO interview_assignment_conflicts(
         conflict_id,assessor_account_id,worker_account_id,reason,active,created_at
       ) VALUES($1,$2,$3,$4,TRUE,$5)`,
      [
        createIdentifier("interview_conflict"),
        principal.accountId,
        row.worker_account_id,
        reason,
        now.toISOString()
      ]
    );
    const reset = await this.database.query(
      `UPDATE interview_requests
          SET status='REQUESTED',assessor_account_id=NULL,scheduled_at=NULL,
              reminder_at=NULL,reschedule_reason=$2
        WHERE interview_request_id=$1 AND assessor_account_id=$3
          AND status IN ('ASSIGNED','WAITING_ROOM')`,
      [interviewRequestId, `Conflict declared: ${reason}`, principal.accountId]
    );
    if (reset.affectedRows !== 1) {
      throw new InterviewAssignmentInputError("Interview assignment changed before the conflict could be recorded.");
    }

    const result = await this.evaluateAndPersist(interviewRequestId, now);
    if (result.selectedAssessorAccountId) {
      await this.database.query(
        `UPDATE interview_requests
            SET status='ASSIGNED',assessor_account_id=$2
          WHERE interview_request_id=$1 AND status='REQUESTED' AND assessor_account_id IS NULL`,
        [interviewRequestId, result.selectedAssessorAccountId]
      );
    }
    return result;
  }

  async listUnassigned(principal: AuthorizationPrincipal): Promise<readonly UnassignedInterviewView[]> {
    if (principal.activeRole !== "admin" || principal.accountStatus !== "active") {
      throw new InterviewAssignmentInputError("Administrator access is required.");
    }
    const result = await this.database.query<{
      interview_request_id: string;
      case_id: string;
      worker_name: string;
      trade_scope: string | null;
      qualification_scope: string | null;
      risk_level: string;
      language: string;
      jurisdiction: string;
      requested_at: string | Date;
    }>(
      `SELECT requests.interview_request_id,requests.case_id,worker.display_name AS worker_name,
              requests.trade_scope,requests.qualification_scope,requests.risk_level,
              requests.language,requests.jurisdiction,requests.requested_at
         FROM interview_requests AS requests
         JOIN auth_accounts AS worker ON worker.account_id=requests.worker_account_id
        WHERE requests.status='REQUESTED' AND requests.assessor_account_id IS NULL
        ORDER BY requests.requested_at,requests.interview_request_id`
    );
    return Object.freeze(result.rows.map((row) => Object.freeze({
      interviewRequestId: row.interview_request_id,
      caseId: row.case_id,
      workerName: row.worker_name,
      tradeScope: row.trade_scope,
      qualificationScope: row.qualification_scope,
      riskLevel: row.risk_level,
      language: row.language,
      jurisdiction: row.jurisdiction,
      requestedAt: row.requested_at instanceof Date ? row.requested_at.toISOString() : new Date(row.requested_at).toISOString()
    })));
  }


  async matchAndAssign(
    principal: AuthorizationPrincipal,
    interviewRequestId: string,
    now = new Date()
  ): Promise<InterviewAssignmentResult> {
    if (principal.activeRole !== "admin" || principal.accountStatus !== "active") {
      throw new InterviewAssignmentInputError("Administrator access is required.");
    }
    const request = await this.database.query<{ status: string; assessor_account_id: string | null }>(
      "SELECT status,assessor_account_id FROM interview_requests WHERE interview_request_id=$1 FOR UPDATE",
      [interviewRequestId]
    );
    const row = request.rows[0];
    if (!row || row.status !== "REQUESTED" || row.assessor_account_id !== null) {
      throw new InterviewAssignmentInputError("Interview is not awaiting assignment.");
    }
    const result = await this.evaluateAndPersist(interviewRequestId, now);
    if (result.selectedAssessorAccountId) {
      const updated = await this.database.query(
        `UPDATE interview_requests
            SET status='ASSIGNED',assessor_account_id=$2
          WHERE interview_request_id=$1 AND status='REQUESTED' AND assessor_account_id IS NULL`,
        [interviewRequestId, result.selectedAssessorAccountId]
      );
      if (updated.affectedRows !== 1) {
        throw new InterviewAssignmentInputError("Interview assignment changed before it could be applied.");
      }
    }
    return result;
  }

  async upsertProfile(
    principal: AuthorizationPrincipal,
    input: {
      assessorAccountId: string;
      tradeScopes: readonly string[];
      qualificationScopes: readonly string[];
      languages: readonly string[];
      jurisdictions: readonly string[];
      riskLevels: readonly string[];
      availability: Readonly<Record<string, unknown>>;
      maxActiveInterviews: number;
      status: "ACTIVE" | "PAUSED";
    },
    now = new Date()
  ): Promise<void> {
    if (principal.activeRole !== "admin" || principal.accountStatus !== "active") {
      throw new InterviewAssignmentInputError("Administrator access is required.");
    }
    if (!Number.isSafeInteger(input.maxActiveInterviews) || input.maxActiveInterviews < 1 || input.maxActiveInterviews > 100) {
      throw new InterviewAssignmentInputError("Maximum active interviews must be between 1 and 100.");
    }
    const normalizeList = (values: readonly string[]) =>
      [...new Set(values.map((v) => v.trim()).filter(Boolean).map((v) => v.slice(0, 160)))].slice(0, 100);
    await this.database.transaction(async database=>{
     await requireLiveReviewActor(database,principal,"admin",true);
     await database.query("SELECT flow_id FROM auth_staff_enrollment_flows WHERE account_id=$1 ORDER BY flow_id FOR UPDATE",[input.assessorAccountId]);
    const role = await database.query(
      `SELECT 1
         FROM auth_accounts AS accounts
         JOIN auth_account_roles AS roles ON roles.account_id=accounts.account_id
        WHERE accounts.account_id=$1 AND accounts.account_status='active' AND roles.role='assessor'
          AND NOT EXISTS(SELECT 1 FROM auth_staff_enrollment_flows flows WHERE flows.account_id=accounts.account_id AND flows.current_step<>'complete')
        FOR NO KEY UPDATE OF accounts,roles`,
      [input.assessorAccountId]
    );
    if (!role.rows[0]) throw new InterviewAssignmentInputError("Selected account is not an active Assessor.");

    await database.query(
      `INSERT INTO assessor_assignment_profiles(
         assessor_account_id,trade_scopes,qualification_scopes,languages,jurisdictions,
         risk_levels,availability_json,max_active_interviews,profile_status,updated_at
       ) VALUES($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10)
       ON CONFLICT(assessor_account_id)
       DO UPDATE SET
         trade_scopes=EXCLUDED.trade_scopes,
         qualification_scopes=EXCLUDED.qualification_scopes,
         languages=EXCLUDED.languages,
         jurisdictions=EXCLUDED.jurisdictions,
         risk_levels=EXCLUDED.risk_levels,
         availability_json=EXCLUDED.availability_json,
         max_active_interviews=EXCLUDED.max_active_interviews,
         profile_status=EXCLUDED.profile_status,
         updated_at=EXCLUDED.updated_at`,
      [
        input.assessorAccountId,
        JSON.stringify(normalizeList(input.tradeScopes)),
        JSON.stringify(normalizeList(input.qualificationScopes)),
        JSON.stringify(normalizeList(input.languages)),
        JSON.stringify(normalizeList(input.jurisdictions)),
        JSON.stringify(normalizeList(input.riskLevels)),
        JSON.stringify(input.availability),
        input.maxActiveInterviews,
        input.status,
        now.toISOString()
      ]
    );
    });
  }

  async listProfiles(principal: AuthorizationPrincipal): Promise<readonly AssessorMatchingProfileView[]> {
    if (principal.activeRole !== "admin" || principal.accountStatus !== "active") {
      throw new InterviewAssignmentInputError("Administrator access is required.");
    }
    const result = await this.database.query<{
      assessor_account_id: string;
      display_name: string;
      email_normalized: string;
      trade_scopes: unknown;
      qualification_scopes: unknown;
      languages: unknown;
      jurisdictions: unknown;
      risk_levels: unknown;
      availability_json: unknown;
      max_active_interviews: number | string;
      profile_status: "ACTIVE" | "PAUSED";
    }>(
      `SELECT profiles.assessor_account_id,profiles.trade_scopes,profiles.qualification_scopes,
              profiles.languages,profiles.jurisdictions,profiles.risk_levels,profiles.availability_json,
              profiles.max_active_interviews,profiles.profile_status,
              accounts.display_name,accounts.email_normalized
         FROM assessor_assignment_profiles AS profiles
         JOIN auth_accounts AS accounts ON accounts.account_id=profiles.assessor_account_id
        ORDER BY accounts.display_name,profiles.assessor_account_id`
    );
    return Object.freeze(result.rows.map((row) => Object.freeze({
      assessorAccountId: row.assessor_account_id,
      displayName: row.display_name,
      email: row.email_normalized,
      tradeScopes: array(row.trade_scopes),
      qualificationScopes: array(row.qualification_scopes),
      languages: array(row.languages),
      jurisdictions: array(row.jurisdictions),
      riskLevels: array(row.risk_levels),
      availability: Object.freeze({ ...object(row.availability_json) }),
      maxActiveInterviews: Number(row.max_active_interviews),
      status: row.profile_status
    })));
  }
}

export async function getInterviewAssignmentService(): Promise<InterviewAssignmentService> {
  return new InterviewAssignmentService(await getDatabaseClient());
}