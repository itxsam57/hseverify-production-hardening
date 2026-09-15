import "server-only";

import type { DatabaseClient } from "../database/database";
import type { InterviewRequest, InterviewRequestStatus, InterviewConsole } from "./interview-scheduling-domain";

type InterviewRow = {
  interview_request_id:string; case_id:string; worker_account_id:string; status:InterviewRequestStatus;
  requested_at:string|Date; scheduled_at:string|Date|null; assessor_account_id:string|null;
  timezone:string; reminder_at:string|Date|null; reschedule_reason:string|null;
};

const COLUMNS = "interview_request_id,case_id,worker_account_id,status,requested_at,scheduled_at,assessor_account_id,timezone,reminder_at,reschedule_reason";
const iso = (value:string|Date|null):string|null => value === null ? null : (value instanceof Date ? value.toISOString() : new Date(value).toISOString());

function mapRequest(row:InterviewRow):InterviewRequest {
  return Object.freeze({
    interviewRequestId:row.interview_request_id, caseId:row.case_id, workerAccountId:row.worker_account_id,
    status:row.status, requestedAt:iso(row.requested_at)!, scheduledAt:iso(row.scheduled_at),
    assessorAccountId:row.assessor_account_id, timezone:row.timezone, reminderAt:iso(row.reminder_at),
    rescheduleReason:row.reschedule_reason
  });
}

export class InterviewSchedulingRepository {
  constructor(private readonly database:DatabaseClient) {}

  async findAssignedToAssessor(tenantId:string, assessorAccountId:string):Promise<InterviewRequest[]> {
    const result = await this.database.query<InterviewRow>(`SELECT ${COLUMNS} FROM interview_requests WHERE tenant_id=$1 AND assessor_account_id=$2 ORDER BY requested_at ASC`, [tenantId, assessorAccountId]);
    return result.rows.map(mapRequest);
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
    const result = await this.database.query<InterviewRow>(`INSERT INTO interview_requests (interview_request_id,case_id,worker_account_id,status,requested_at,scheduled_at,assessor_account_id,timezone,reminder_at,reschedule_reason,tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${COLUMNS}`,
      [value.interviewRequestId,value.caseId,value.workerAccountId,value.status,value.requestedAt,value.scheduledAt,value.assessorAccountId,value.timezone,value.reminderAt,value.rescheduleReason,tenantId]);
    if (!result.rows[0]) throw new Error("Interview request was not persisted.");
    return mapRequest(result.rows[0]);
  }

  async update(tenantId:string, value:InterviewRequest):Promise<InterviewRequest> {
    const result = await this.database.query<InterviewRow>(`UPDATE interview_requests SET status=$3,scheduled_at=$4,assessor_account_id=$5,timezone=$6,reminder_at=$7,reschedule_reason=$8 WHERE tenant_id=$1 AND interview_request_id=$2 RETURNING ${COLUMNS}`,
      [tenantId,value.interviewRequestId,value.status,value.scheduledAt,value.assessorAccountId,value.timezone,value.reminderAt,value.rescheduleReason]);
    if (!result.rows[0]) throw new Error("Interview request was not updated.");
    return mapRequest(result.rows[0]);
  }

  async saveConsoleDraft(input:{tenantId:string; interviewSessionId:string; interviewRequestId:string; notes:readonly unknown[]; recommendation:string|null; submitted:boolean; updatedAt:string}):Promise<void> {
    await this.database.query(`INSERT INTO interview_console_drafts (tenant_id,interview_session_id,interview_request_id,notes,recommendation,submitted,updated_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7) ON CONFLICT (tenant_id,interview_session_id) DO UPDATE SET notes=$4::jsonb,recommendation=$5,submitted=$6,updated_at=$7`, [input.tenantId,input.interviewSessionId,input.interviewRequestId,JSON.stringify(input.notes),input.recommendation,input.submitted,input.updatedAt]);
  }

  async saveConsoleState(input:{tenantId:string; interviewSessionId:string; interviewRequestId:string; notes:readonly unknown[]; scorecard:unknown; recommendation:string|null; submitted:boolean; updatedAt:string}):Promise<void> {
    await this.database.query(`INSERT INTO interview_console_drafts (tenant_id,interview_session_id,interview_request_id,notes,recommendation,submitted,updated_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7) ON CONFLICT (tenant_id,interview_session_id) DO UPDATE SET notes=$4::jsonb,recommendation=$5,submitted=$6,updated_at=$7`, [input.tenantId,input.interviewSessionId,input.interviewRequestId,JSON.stringify({ notes: input.notes, scorecard: input.scorecard }),input.recommendation,input.submitted,input.updatedAt]);
  }

  async loadConsoleDraft(tenantId:string, interviewSessionId:string):Promise<Partial<InterviewConsole>|null> {
    const result = await this.database.query<{notes:unknown[]; recommendation:string|null; submitted:boolean}>(
      `SELECT notes,recommendation,submitted FROM interview_console_drafts WHERE tenant_id=$1 AND interview_session_id=$2`,
      [tenantId, interviewSessionId]
    );
    const row = result.rows[0];
    if (!row) return null;
    const stored = Array.isArray(row.notes) ? { notes: row.notes } : row.notes as { notes?: unknown[]; scorecard?: unknown };
    return { notes: (stored.notes ?? []) as InterviewConsole["notes"], recommendation: row.recommendation as InterviewConsole["recommendation"], submitted: row.submitted, scorecard: stored.scorecard as InterviewConsole["scorecard"] | undefined };
  }
}
