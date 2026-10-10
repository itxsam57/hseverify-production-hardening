import "server-only";

import { interviewRequestPolicyValues } from "./interview-policy-service";

import type { DatabaseClient } from "../database/database";
import type { InterviewRequest, InterviewRequestStatus, InterviewConsole } from "./interview-scheduling-domain";
import { InterviewSchedulingInputError } from "./interview-scheduling-domain";

type InterviewRow = {
  interview_request_id:string; case_id:string; worker_account_id:string; status:InterviewRequestStatus;
  requested_at:string|Date; scheduled_at:string|Date|null; assessor_account_id:string|null;
  candidate_available_from:string|Date|null; candidate_available_until:string|Date|null;
  timezone:string; reminder_at:string|Date|null; reschedule_reason:string|null; tenant_id:string;
};

export type ScopedInterviewRequest = InterviewRequest & { tenantId: string; workerAvailability: Readonly<{availableFrom:string;availableUntil:string}> | null };

const COLUMNS = "interview_request_id,case_id,worker_account_id,status,requested_at,scheduled_at,assessor_account_id,timezone,reminder_at,reschedule_reason,candidate_available_from,candidate_available_until";
const iso = (value:string|Date|null):string|null => value === null ? null : (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

function mapRequest(row:InterviewRow):InterviewRequest {
  return Object.freeze({
    interviewRequestId:row.interview_request_id, caseId:row.case_id, workerAccountId:row.worker_account_id,
    status:row.status, requestedAt:iso(row.requested_at)!, scheduledAt:iso(row.scheduled_at),
    assessorAccountId:row.assessor_account_id, timezone:row.timezone, reminderAt:iso(row.reminder_at),
    rescheduleReason:row.reschedule_reason
  });
}

function mapScopedRequest(row:InterviewRow):ScopedInterviewRequest {
  return Object.freeze({...mapRequest(row),tenantId:row.tenant_id,workerAvailability:row.candidate_available_from && row.candidate_available_until ? Object.freeze({availableFrom:iso(row.candidate_available_from)!,availableUntil:iso(row.candidate_available_until)!}) : null});
}

export class InterviewSchedulingRepository {
  constructor(private readonly database:DatabaseClient) {}

  async findAssignedToAssessor(tenantId:string, assessorAccountId:string):Promise<InterviewRequest[]> {
    const result = await this.database.query<InterviewRow>(`SELECT ${COLUMNS} FROM interview_requests WHERE tenant_id=$1 AND assessor_account_id=$2 ORDER BY requested_at ASC`, [tenantId, assessorAccountId]);
    return result.rows.map(mapRequest);
  }

  async findAssignedToAssessorAccount(assessorAccountId:string, query = ""):Promise<ScopedInterviewRequest[]> {
    const result = await this.database.query<InterviewRow>(
      `SELECT ${COLUMNS},tenant_id FROM interview_requests
        WHERE assessor_account_id=$1
          AND ($2='' OR strpos(lower(concat_ws(' ',interview_request_id,
               case_id,worker_account_id,status,replace(status,'_',' '))),lower($2))>0)
        ORDER BY requested_at ASC,interview_request_id ASC`,
      [assessorAccountId, query.trim().slice(0,160)]
    );
    return result.rows.map(mapScopedRequest);
  }

  async findByRequestIdForAssessor(interviewRequestId:string, assessorAccountId:string, forUpdate = false):Promise<ScopedInterviewRequest|null> {
    const result = await this.database.query<InterviewRow>(
      `SELECT ${COLUMNS},tenant_id FROM interview_requests WHERE interview_request_id=$1 AND assessor_account_id=$2${forUpdate ? " FOR UPDATE" : ""}`,
      [interviewRequestId, assessorAccountId]
    );
    const row = result.rows[0];
    return row ? mapScopedRequest(row) : null;
  }

  async findByRequestIdForWorker(interviewRequestId:string, workerAccountId:string, forUpdate = false):Promise<ScopedInterviewRequest|null> {
    const result = await this.database.query<InterviewRow>(
      `SELECT ${COLUMNS},tenant_id FROM interview_requests WHERE interview_request_id=$1 AND worker_account_id=$2${forUpdate ? " FOR UPDATE" : ""}`,
      [interviewRequestId, workerAccountId]
    );
    const row = result.rows[0];
    return row ? mapScopedRequest(row) : null;
  }

  async findByCase(tenantId:string, caseId:string):Promise<InterviewRequest|null> {
    const result = await this.database.query<InterviewRow>(`SELECT ${COLUMNS} FROM interview_requests WHERE tenant_id=$1 AND case_id=$2`, [tenantId,caseId]);
    return result.rows[0] ? mapRequest(result.rows[0]) : null;
  }

  async findByRequestId(tenantId:string, interviewRequestId:string):Promise<InterviewRequest|null> {
    const result = await this.database.query<InterviewRow>(`SELECT ${COLUMNS} FROM interview_requests WHERE tenant_id=$1 AND interview_request_id=$2`, [tenantId,interviewRequestId]);
    return result.rows[0] ? mapRequest(result.rows[0]) : null;
  }

  async insert(tenantId:string, value:InterviewRequest):Promise<InterviewRequest> {
    const policy = await interviewRequestPolicyValues(this.database, tenantId, value.caseId);
    const values = [value.interviewRequestId,value.caseId,value.workerAccountId,value.status,value.requestedAt,
      value.scheduledAt,value.assessorAccountId,value.timezone,value.reminderAt,value.rescheduleReason,tenantId];
    const columns = "interview_request_id,case_id,worker_account_id,status,requested_at,scheduled_at,assessor_account_id,timezone,reminder_at,reschedule_reason,tenant_id";
    const recordingColumns = policy?.recording ? ",recording_policy,recording_retention_days,recording_consent_required" : "";
    const result = policy
      ? await this.database.query<InterviewRow>(
        `INSERT INTO interview_requests (${columns},trade_scope,qualification_scope,risk_level,language,jurisdiction${recordingColumns})
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16${policy.recording ? ",$17,$18,$19" : ""}
         FROM assurance_cases WHERE tenant_id=$11 AND case_id=$2 AND worker_account_id=$3
         RETURNING ${COLUMNS}`,
        [...values,policy.context.tradeScope,policy.context.qualificationScope,policy.context.riskLevel,
         policy.context.language,policy.context.jurisdiction,
         ...(policy.recording ? [policy.recording.policy,policy.recording.retentionDays,policy.recording.consentRequired] : [])]
      )
      : await this.database.query<InterviewRow>(
        `INSERT INTO interview_requests (${columns}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${COLUMNS}`,
        values
      );
    if (!result.rows[0]) throw new Error("Interview request was not persisted.");
    return mapRequest(result.rows[0]);
  }

  async update(tenantId:string, value:InterviewRequest):Promise<InterviewRequest> {
    const result = await this.database.query<InterviewRow>(`UPDATE interview_requests SET status=$3,scheduled_at=$4,assessor_account_id=$5,timezone=$6,reminder_at=$7,reschedule_reason=$8 WHERE tenant_id=$1 AND interview_request_id=$2 RETURNING ${COLUMNS}`,
      [tenantId,value.interviewRequestId,value.status,value.scheduledAt,value.assessorAccountId,value.timezone,value.reminderAt,value.rescheduleReason]);
    if (!result.rows[0]) throw new Error("Interview request was not updated.");
    return mapRequest(result.rows[0]);
  }

  private async assertConsoleSessionBinding(input: {tenantId: string; interviewSessionId: string; interviewRequestId: string}): Promise<void> {
    const result = await this.database.query(
      "SELECT 1 FROM interview_runtime_sessions WHERE interview_session_id=$1 AND (tenant_id<>$2 OR interview_request_id<>$3)",
      [input.interviewSessionId, input.tenantId, input.interviewRequestId]
    );
    if (result.rows.length) throw new InterviewSchedulingInputError("Interview session does not belong to this request.");
  }

  async saveConsoleDraft(input:{tenantId:string; interviewSessionId:string; interviewRequestId:string; notes:readonly unknown[]; recommendation:string|null; submitted:boolean; updatedAt:string}):Promise<void> {
    await this.assertConsoleSessionBinding(input);
    const saved = await this.database.query(`INSERT INTO interview_console_drafts (tenant_id,interview_session_id,interview_request_id,notes,recommendation,submitted,updated_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7) ON CONFLICT (tenant_id,interview_session_id) DO UPDATE SET notes=$4::jsonb,recommendation=$5,submitted=$6,updated_at=$7 WHERE interview_console_drafts.interview_request_id=EXCLUDED.interview_request_id RETURNING interview_session_id`, [input.tenantId,input.interviewSessionId,input.interviewRequestId,JSON.stringify(input.notes),input.recommendation,input.submitted,input.updatedAt]);
    if (!saved.rows.length) throw new InterviewSchedulingInputError("Interview session does not belong to this request.");
  }

  async saveConsoleState(input:{tenantId:string; interviewSessionId:string; interviewRequestId:string; notes:readonly unknown[]; scorecard:unknown; recommendation:string|null; submitted:boolean; updatedAt:string}):Promise<void> {
    await this.assertConsoleSessionBinding(input);
    const saved = await this.database.query(`INSERT INTO interview_console_drafts (tenant_id,interview_session_id,interview_request_id,notes,scorecard,recommendation,submitted,updated_at) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8) ON CONFLICT (tenant_id,interview_session_id) DO UPDATE SET notes=$4::jsonb,scorecard=$5::jsonb,recommendation=$6,submitted=$7,updated_at=$8 WHERE interview_console_drafts.interview_request_id=EXCLUDED.interview_request_id RETURNING interview_session_id`, [input.tenantId,input.interviewSessionId,input.interviewRequestId,JSON.stringify(input.notes),JSON.stringify(input.scorecard),input.recommendation,input.submitted,input.updatedAt]);
    if (!saved.rows.length) throw new InterviewSchedulingInputError("Interview session does not belong to this request.");
  }

  async loadLatestConsoleDraft(tenantId:string, interviewRequestId:string):Promise<(Partial<InterviewConsole> & { interviewSessionId:string })|null> {
    const result = await this.database.query<{interview_session_id:string; notes:unknown[]; scorecard:unknown; recommendation:string|null; submitted:boolean}>(
      `SELECT interview_session_id,notes,scorecard,recommendation,submitted
       FROM interview_console_drafts
       WHERE tenant_id=$1 AND interview_request_id=$2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [tenantId, interviewRequestId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      interviewSessionId: row.interview_session_id,
      notes: (row.notes ?? []) as InterviewConsole["notes"],
      scorecard: row.scorecard as InterviewConsole["scorecard"],
      recommendation: row.recommendation as InterviewConsole["recommendation"],
      submitted: row.submitted
    };
  }

  async loadConsoleDraft(tenantId:string, interviewSessionId:string):Promise<Partial<InterviewConsole>|null> {
    const result = await this.database.query<{notes:unknown[]; scorecard:unknown; recommendation:string|null; submitted:boolean}>(
      `SELECT notes,scorecard,recommendation,submitted FROM interview_console_drafts WHERE tenant_id=$1 AND interview_session_id=$2`,
      [tenantId, interviewSessionId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return { notes: (row.notes ?? []) as InterviewConsole["notes"], scorecard: row.scorecard as InterviewConsole["scorecard"], recommendation: row.recommendation as InterviewConsole["recommendation"], submitted: row.submitted };
  }
}