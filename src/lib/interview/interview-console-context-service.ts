import "server-only";
import { calculateInterviewActiveTime } from "./interview-policy-domain";

import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import type { DatabaseClient } from "../database/database";
import { getServerEnvironment } from "../config/server-environment";
import { authorizeSecureFileAccessCore, readSecureFileAccessCore } from "../secure-files/secure-file-access-core";
import { createRuntimePrivateObjectStorage } from "../secure-files/private-object-storage";
import { secureFileFromRow, type SecureFileRow } from "../secure-files/secure-file-repository";

type Stamp = string | Date;
type Scope = {
  case_id: string; tenant_id: string; worker_account_id: string; request_status: string;
  case_status: string; next_action: string | null; effective_policy_reference: string | null;
  assessment_framework_references: unknown; current_request: boolean;
};
export class InterviewConsoleContextAccessError extends Error {
  constructor() { super("Interview context is unavailable."); this.name = "InterviewConsoleContextAccessError"; }
}
const iso = (value: Stamp): string => new Date(value).toISOString();
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;

const PHOTO_SQL = `SELECT files.*
  FROM worker_identities identities
  JOIN worker_identity_versions versions ON versions.identity_id=identities.identity_id
    AND versions.version_number=identities.current_version_number AND versions.version_status='submitted'
  JOIN worker_identity_evidence_bindings bindings ON bindings.identity_version_id=versions.identity_version_id
    AND bindings.worker_account_id=identities.worker_account_id
    AND bindings.purpose='profile_photo' AND bindings.binding_status='active'
  JOIN platform_secure_files files ON files.file_id=bindings.secure_file_id
    AND files.owner_account_id=identities.worker_account_id AND files.owner_role='worker'
    AND files.lifecycle_status='available' AND files.detected_mime IN ('image/png','image/jpeg')
  WHERE identities.worker_account_id=$1 AND identities.lifecycle_status='verified'`;

const EVIDENCE_FROM = `FROM evidence_review_tasks tasks
  JOIN evidence_review_decisions decisions ON decisions.task_id=tasks.task_id
    AND decisions.source_version_id=tasks.source_version_id AND decisions.outcome='APPROVED'
  JOIN worker_evidence_records records ON records.record_id=tasks.source_record_id
    AND records.worker_account_id=tasks.worker_account_id AND records.record_kind=tasks.evidence_kind
  JOIN worker_evidence_versions versions ON versions.version_id=tasks.source_version_id
    AND versions.record_id=records.record_id AND records.current_version_id=versions.version_id
    AND versions.version_status='submitted'
  WHERE tasks.tenant_id=$1 AND tasks.case_id=$2 AND tasks.worker_account_id=$3
    AND tasks.task_status='APPROVED'`;

type Evidence = {
  taskId: string; kind: string; label: string; fileId: string | null;
  title: string | null; issuer: string | null; level: string | null;
  company: string | null; role: string | null; duties: string | null;
  startDate: string | null; endDate: string | null;
};
type Attempt = { attemptId: string; status: string; startedAt: string; submittedAt: string | null };
type Topic = { attemptId: string; topic: string; total: number; correct: number; incorrectMcq: number };
type Written = { attemptId: string; position: number; topic: string; prompt: string; response: string | null };
type Observation = { id: string; competency: string; observedAt: string; text: string; outcome: string; observer: string };
type Comment = { kind: string; outcome: string; reason: string; reviewedAt: string };
type History = { requestId: string; status: string; scheduledAt: string | null; runtimeStatus: string | null; recommendation: string | null };
type Integrity = { attemptId: string; eventType: string; classification: string; state: string; occurredAt: string };
type Decision = { state: string; reasonCode: string; ruleVersion: string; createdAt: string };
export type InterviewConsoleContext = Readonly<{
  profile: Readonly<{ name: string; workerId: string | null; country: string | null; language: string | null; occupation: string | null; experience: string | null; photoFileId: string | null }>;
  evidence: readonly Evidence[]; observations: readonly Observation[]; attempts: readonly Attempt[];
  topics: readonly Topic[]; written: readonly Written[]; integrity: readonly Integrity[];
  comments: readonly Comment[]; history: readonly History[];
  decision: Decision | null; caseStatus: string; nextAction: string | null; policyReference: string | null;
  frameworkReferences: readonly string[]; elapsedSeconds: number; timerRunning: boolean;
}>;

export class InterviewConsoleContextService {
  constructor(private readonly database: DatabaseClient) {}

  private async scope(db: DatabaseClient, actor: AuthorizationPrincipal, requestId: string): Promise<Scope> {
    if (actor.activeRole !== "assessor" || actor.accountStatus !== "active" || !actor.sessionId)
      throw new InterviewConsoleContextAccessError();
    const result = await db.query<Scope>(
      `SELECT requests.case_id,requests.tenant_id,requests.worker_account_id,requests.status AS request_status,
              cases.case_status,cases.next_action,orders.effective_policy_reference,orders.assessment_framework_references,
              cases.interview_reference=requests.interview_request_id AS current_request
         FROM interview_requests requests
         JOIN assurance_cases cases ON cases.case_id=requests.case_id AND cases.tenant_id=requests.tenant_id
           AND cases.worker_account_id=requests.worker_account_id
         JOIN assurance_orders orders ON orders.order_id=cases.order_id AND orders.tenant_id=cases.tenant_id
         JOIN auth_accounts accounts ON accounts.account_id=requests.assessor_account_id AND accounts.account_status='active'
         JOIN auth_account_roles roles ON roles.account_id=accounts.account_id AND roles.role='assessor'
         JOIN auth_sessions sessions ON sessions.account_id=accounts.account_id AND sessions.session_id=$2
           AND sessions.active_role='assessor' AND sessions.revoked_at IS NULL AND sessions.expires_at>clock_timestamp()
        WHERE requests.interview_request_id=$1 AND requests.assessor_account_id=$3
        FOR SHARE OF requests,cases,accounts,sessions`,
      [requestId,actor.sessionId,actor.accountId]
    );
    if (!result.rows[0]) throw new InterviewConsoleContextAccessError();
    return result.rows[0];
  }

  async load(actor: AuthorizationPrincipal, requestId: string): Promise<InterviewConsoleContext | null> {
    return this.database.transaction(async db => {
      const scope = await this.scope(db,actor,requestId);
      // Archived appointments keep their own drafts, never the successor's case context.
      if (scope.request_status === "CANCELLED" || !scope.current_request) return null;
      const params = [scope.tenant_id,scope.case_id,scope.worker_account_id];
      const profile = await db.query<{display_name:string;worker_id:string|null;preferred_name:string|null;country:string|null;language:string|null;occupation:string|null;experience:string|null}>(
        `SELECT accounts.display_name,worker_ids.permanent_worker_id AS worker_id,
                profiles.profile_document#>>'{personal,preferredName}' AS preferred_name,
                profiles.profile_document#>>'{personal,countryOfResidence}' AS country,
                profiles.profile_document#>>'{personal,primaryLanguage}' AS language,
                profiles.profile_document#>>'{professional,primaryOccupation}' AS occupation,
                profiles.profile_document#>>'{professional,yearsExperience}' AS experience
           FROM auth_accounts accounts LEFT JOIN worker_profiles profiles ON profiles.worker_sub=accounts.account_id
           LEFT JOIN worker_identity_worker_ids worker_ids ON worker_ids.worker_account_id=accounts.account_id
          WHERE accounts.account_id=$1`,[scope.worker_account_id]);
      const photo = await db.query<SecureFileRow>(PHOTO_SQL,[scope.worker_account_id]);
      const evidenceRows = await db.query<{task_id:string;evidence_kind:string;evidence_label:string;secure_file_id:string|null;title:string|null;issuer:string|null;level:string|null;company:string|null;role:string|null;duties:string|null;start_date:Stamp|null;end_date:Stamp|null}>(
        `SELECT tasks.task_id,tasks.evidence_kind,tasks.evidence_label,
                CASE WHEN files.lifecycle_status='available' AND (
                  EXISTS(SELECT 1 FROM worker_evidence_attachments attachments WHERE attachments.version_id=tasks.source_version_id AND attachments.record_id=tasks.source_record_id AND attachments.secure_file_id=tasks.secure_file_id AND attachments.superseded_at IS NULL)
                  OR EXISTS(SELECT 1 FROM worker_employment_leaving_letters letters WHERE letters.employment_version_id=tasks.source_version_id AND letters.employment_record_id=tasks.source_record_id AND letters.secure_file_id=tasks.secure_file_id AND letters.status='active')
                ) THEN files.file_id ELSE NULL END AS secure_file_id,
                qualifications.qualification_title AS title,qualifications.issuing_organization AS issuer,qualifications.qualification_level AS level,
                COALESCE(employment.company_name,experience.company_name) AS company,
                COALESCE(employment.role_title,experience.role_title) AS role,
                COALESCE(employment.duties,experience.duties) AS duties,
                COALESCE(employment.start_date,experience.start_date) AS start_date,
                COALESCE(employment.end_date,experience.end_date) AS end_date
           ${EVIDENCE_FROM.replace("WHERE",`LEFT JOIN worker_qualification_versions qualifications ON qualifications.version_id=versions.version_id
             LEFT JOIN worker_employment_versions employment ON employment.version_id=versions.version_id
             LEFT JOIN worker_experience_versions experience ON experience.version_id=versions.version_id
             LEFT JOIN platform_secure_files files ON files.file_id=tasks.secure_file_id AND files.owner_account_id=tasks.worker_account_id AND files.owner_role='worker'
             WHERE`)}
          ORDER BY tasks.evidence_kind,tasks.created_at`,params);
      const observations = await db.query<{observation_id:string;competency_reference:string;observed_at:Stamp;observation_text:string;outcome:string;display_name:string}>(
        `SELECT observations.observation_id,observations.competency_reference,observations.observed_at,
                observations.observation_text,observations.outcome,accounts.display_name
           FROM supervisor_observations observations
           JOIN evidence_review_tasks tasks ON tasks.source_record_id=observations.observation_id
             AND tasks.source_version_id=observations.observation_id AND tasks.evidence_kind='supervisor_observation'
             AND tasks.case_id=observations.case_id AND tasks.tenant_id=observations.tenant_id AND tasks.worker_account_id=observations.worker_account_id
           JOIN evidence_review_decisions decisions ON decisions.task_id=tasks.task_id
             AND decisions.source_version_id=tasks.source_version_id AND decisions.outcome='APPROVED'
           JOIN auth_tenant_memberships memberships ON memberships.membership_id=observations.observer_membership_id AND memberships.tenant_id=observations.tenant_id
           JOIN auth_accounts accounts ON accounts.account_id=memberships.account_id
          WHERE observations.tenant_id=$1 AND observations.case_id=$2 AND observations.worker_account_id=$3
            AND observations.observation_status='submitted' AND tasks.task_status='APPROVED'
          ORDER BY observations.observed_at DESC`,params);
      const attempts = await db.query<{attempt_id:string;status:string;started_at:Stamp;submitted_at:Stamp|null}>(
        "SELECT attempt_id,status,started_at,submitted_at FROM assessment_attempts WHERE case_id=$1 AND worker_account_id=$2 ORDER BY started_at DESC,attempt_id",
        [scope.case_id,scope.worker_account_id]);
      const questions = await db.query<{attempt_id:string;position:number;domain_reference:string;question_type:string;prompt:string|null;response:string|null;correct:boolean|null}>(
        `SELECT attempts.attempt_id,items.position,versions.domain_reference,versions.question_type,
                CASE WHEN versions.question_type IN ('SHORT_TEXT','LONG_TEXT') THEN versions.prompt END AS prompt,
                CASE WHEN versions.question_type IN ('SHORT_TEXT','LONG_TEXT') THEN
                  CASE WHEN latest.revision_no IS NOT NULL THEN latest.text_value ELSE answers.text_value END END AS response,
                CASE versions.question_type
                  WHEN 'MULTIPLE_CHOICE' THEN (CASE WHEN latest.revision_no IS NOT NULL THEN latest.text_value ELSE answers.text_value END)=COALESCE(versions.answer_key_json->>'value',versions.answer_key_json#>>'{}')
                  WHEN 'TRUE_FALSE' THEN (CASE WHEN latest.revision_no IS NOT NULL THEN latest.boolean_value ELSE answers.boolean_value END)=(COALESCE(versions.answer_key_json->>'value',versions.answer_key_json#>>'{}'))::boolean
                  WHEN 'INTEGER' THEN (CASE WHEN latest.revision_no IS NOT NULL THEN latest.numeric_value ELSE answers.numeric_value END)=(COALESCE(versions.answer_key_json->>'value',versions.answer_key_json#>>'{}'))::numeric
                  WHEN 'DECIMAL' THEN (CASE WHEN latest.revision_no IS NOT NULL THEN latest.numeric_value ELSE answers.numeric_value END)=(COALESCE(versions.answer_key_json->>'value',versions.answer_key_json#>>'{}'))::numeric
                END AS correct
           FROM assessment_attempts attempts
           JOIN generated_assessment_form_items items ON items.form_id=attempts.form_id
           JOIN assessment_question_versions versions ON versions.question_id=items.question_id AND versions.question_version_id=items.question_version_id
           LEFT JOIN assessment_attempt_answers answers ON answers.attempt_id=attempts.attempt_id AND answers.position=items.position AND answers.question_version_id=items.question_version_id
           LEFT JOIN LATERAL (SELECT revision_no,text_value,boolean_value,numeric_value FROM assessment_answer_revisions
             WHERE answer_id=answers.answer_id AND attempt_id=attempts.attempt_id AND position=items.position ORDER BY revision_no DESC LIMIT 1) latest ON TRUE
          WHERE attempts.case_id=$1 AND attempts.worker_account_id=$2 AND attempts.status IN ('SUBMITTED','AUTO_SUBMITTED')
          ORDER BY attempts.started_at DESC,attempts.attempt_id,items.position`,[scope.case_id,scope.worker_account_id]);
      const integrity = await db.query<{attempt_id:string;event_type:string;classification:string;state:string;occurred_at:Stamp}>(
        `SELECT events.attempt_id,events.event_type,events.classification,events.state,events.occurred_at
           FROM integrity_capture_events events JOIN assessment_attempts attempts ON attempts.attempt_id=events.attempt_id
          WHERE attempts.case_id=$1 AND attempts.worker_account_id=$2 ORDER BY events.occurred_at DESC`,
        [scope.case_id,scope.worker_account_id]);
      const comments = await db.query<{kind:string;outcome:string;reason:string;reviewed_at:Stamp}>(
        `SELECT tasks.evidence_kind AS kind,decisions.outcome,decisions.reason,decisions.decided_at AS reviewed_at
           FROM evidence_review_tasks tasks JOIN evidence_review_decisions decisions ON decisions.task_id=tasks.task_id AND decisions.source_version_id=tasks.source_version_id
          WHERE tasks.tenant_id=$1 AND tasks.case_id=$2 AND tasks.worker_account_id=$3 AND decisions.assessor_visible
            AND tasks.task_status IN ('APPROVED','REJECTED','CHANGES_REQUESTED')
            AND (EXISTS(SELECT 1 FROM worker_evidence_records records JOIN worker_evidence_versions versions ON versions.record_id=records.record_id
              WHERE records.record_id=tasks.source_record_id AND records.worker_account_id=tasks.worker_account_id AND records.record_kind=tasks.evidence_kind
                AND versions.version_id=tasks.source_version_id AND records.current_version_id=versions.version_id AND versions.version_status='submitted')
              OR EXISTS(SELECT 1 FROM supervisor_observations observations WHERE observations.observation_id=tasks.source_record_id AND observations.observation_id=tasks.source_version_id
                AND observations.case_id=tasks.case_id AND observations.tenant_id=tasks.tenant_id AND observations.worker_account_id=tasks.worker_account_id AND observations.observation_status='submitted')
              OR (tasks.evidence_kind='identity' AND EXISTS(
                SELECT 1 FROM worker_identities identities JOIN worker_identity_versions versions ON versions.identity_id=identities.identity_id
                  AND versions.version_number=identities.current_version_number AND versions.version_status='submitted'
                WHERE identities.identity_id=tasks.source_record_id AND versions.identity_version_id=tasks.source_version_id
                  AND identities.worker_account_id=tasks.worker_account_id)))
          UNION ALL
         SELECT 'written assessment',reviews.decision,reviews.reason,reviews.created_at
           FROM written_score_reviews reviews JOIN assessment_attempts attempts ON attempts.attempt_id=reviews.attempt_id AND attempts.case_id=reviews.case_id
          WHERE reviews.tenant_id=$1 AND reviews.case_id=$2 AND attempts.worker_account_id=$3 AND reviews.status='FINAL' AND reviews.assessor_visible
          ORDER BY reviewed_at DESC`,params);
      const history = await db.query<{interview_request_id:string;status:string;scheduled_at:Stamp|null;runtime_status:string|null;recommendation:string|null}>(
        `SELECT requests.interview_request_id,requests.status,requests.scheduled_at,sessions.status AS runtime_status,drafts.recommendation
           FROM interview_requests requests
           LEFT JOIN interview_runtime_sessions sessions ON sessions.interview_request_id=requests.interview_request_id AND sessions.tenant_id=requests.tenant_id
           LEFT JOIN LATERAL (SELECT recommendation FROM interview_console_drafts WHERE interview_request_id=requests.interview_request_id AND tenant_id=requests.tenant_id ORDER BY updated_at DESC LIMIT 1) drafts ON TRUE
          WHERE requests.case_id=$1 AND requests.tenant_id=$2 AND requests.worker_account_id=$3 ORDER BY requests.requested_at DESC`,
        [scope.case_id,scope.tenant_id,scope.worker_account_id]);
      const decision = await db.query<{state:string;reason_code:string;rule_version:string;created_at:Stamp}>(
        "SELECT state,reason_code,rule_version,created_at FROM platform_decisions WHERE case_id=$1 ORDER BY created_at DESC,decision_id DESC LIMIT 1",[scope.case_id]);
      const events = await db.query<{event_type:string;occurred_at:Stamp}>(
        `SELECT events.event_type,events.occurred_at FROM interview_runtime_events events
           JOIN interview_runtime_sessions sessions ON sessions.interview_session_id=events.interview_session_id
          WHERE sessions.interview_request_id=$1 AND sessions.tenant_id=$2 ORDER BY events.occurred_at,events.event_id`,[requestId,scope.tenant_id]);
      const clock = await db.query<{now:Stamp}>("SELECT clock_timestamp() AS now");
      const activeTime = calculateInterviewActiveTime(events.rows, new Date(clock.rows[0].now));
      const topics = new Map<string,Topic>();
      const written: Written[] = [];
      for (const question of questions.rows) {
        const key = question.attempt_id+"\u0000"+question.domain_reference;
        const topic = topics.get(key) ?? {attemptId:question.attempt_id,topic:question.domain_reference,total:0,correct:0,incorrectMcq:0};
        topic.total++;
        if (question.correct) topic.correct++;
        if (["MULTIPLE_CHOICE","TRUE_FALSE"].includes(question.question_type) && !question.correct) topic.incorrectMcq++;
        topics.set(key,topic);
        if (question.prompt !== null) written.push({attemptId:question.attempt_id,position:Number(question.position),topic:question.domain_reference,prompt:question.prompt,response:question.response});
      }
      const person = profile.rows[0];
      const rawFrameworks: unknown = typeof scope.assessment_framework_references === "string" ? JSON.parse(scope.assessment_framework_references) : scope.assessment_framework_references;
      return Object.freeze({
        profile:Object.freeze({name:text(person?.preferred_name) ?? person?.display_name ?? "Assigned Worker",workerId:person?.worker_id ?? null,country:text(person?.country),language:text(person?.language),occupation:text(person?.occupation),experience:text(person?.experience),photoFileId:photo.rows[0]?.file_id ?? null}),
        evidence:evidenceRows.rows.map(row=>({taskId:row.task_id,kind:row.evidence_kind,label:row.evidence_label,fileId:row.secure_file_id,title:row.title,issuer:row.issuer,level:row.level,company:row.company,role:row.role,duties:row.duties,startDate:row.start_date ? iso(row.start_date).slice(0,10):null,endDate:row.end_date ? iso(row.end_date).slice(0,10):null})),
        observations:observations.rows.map(row=>({id:row.observation_id,competency:row.competency_reference,observedAt:iso(row.observed_at),text:row.observation_text,outcome:row.outcome,observer:row.display_name})),
        attempts:attempts.rows.map(row=>({attemptId:row.attempt_id,status:row.status,startedAt:iso(row.started_at),submittedAt:row.submitted_at ? iso(row.submitted_at):null})),
        topics:[...topics.values()],written,
        integrity:integrity.rows.map(row=>({attemptId:row.attempt_id,eventType:row.event_type,classification:row.classification,state:row.state,occurredAt:iso(row.occurred_at)})),
        comments:comments.rows.map(row=>({kind:row.kind,outcome:row.outcome,reason:row.reason,reviewedAt:iso(row.reviewed_at)})),
        history:history.rows.map(row=>({requestId:row.interview_request_id,status:row.status,scheduledAt:row.scheduled_at ? iso(row.scheduled_at):null,runtimeStatus:row.runtime_status,recommendation:row.recommendation})),
        decision:decision.rows[0] ? {state:decision.rows[0].state,reasonCode:decision.rows[0].reason_code,ruleVersion:decision.rows[0].rule_version,createdAt:iso(decision.rows[0].created_at)}:null,
        caseStatus:scope.case_status,nextAction:scope.next_action,policyReference:scope.effective_policy_reference,
        frameworkReferences:Array.isArray(rawFrameworks) ? rawFrameworks.filter((value):value is string=>typeof value==="string"):[],
        elapsedSeconds:activeTime.seconds,timerRunning:activeTime.running
      });
    });
  }

  async preview(actor: AuthorizationPrincipal, requestId: string, fileId: string) {
    const environment = getServerEnvironment();
    const repository = {findForPrincipal: async (principal: AuthorizationPrincipal, ref: string) =>
      this.database.transaction(async db => {
        const scope = await this.scope(db,principal,requestId);
        if (scope.request_status === "CANCELLED" || !scope.current_request || ref !== fileId) return null;
        const photo = await db.query<SecureFileRow>(PHOTO_SQL+" AND files.file_id=$2",[scope.worker_account_id,ref]);
        if (photo.rows[0]) return secureFileFromRow(photo.rows[0]);
        const result = await db.query<SecureFileRow>(
          `SELECT files.* ${EVIDENCE_FROM.replace("WHERE",`JOIN platform_secure_files files ON files.file_id=tasks.secure_file_id
            AND files.owner_account_id=tasks.worker_account_id AND files.owner_role='worker' AND files.lifecycle_status='available' WHERE`)}
            AND files.file_id=$4 AND (
              EXISTS(SELECT 1 FROM worker_evidence_attachments attachments WHERE attachments.version_id=tasks.source_version_id AND attachments.record_id=tasks.source_record_id AND attachments.secure_file_id=files.file_id AND attachments.superseded_at IS NULL)
              OR EXISTS(SELECT 1 FROM worker_employment_leaving_letters letters WHERE letters.employment_version_id=tasks.source_version_id AND letters.employment_record_id=tasks.source_record_id AND letters.secure_file_id=files.file_id AND letters.status='active')
            )`,[scope.tenant_id,scope.case_id,scope.worker_account_id,ref]);
        return result.rows[0] ? secureFileFromRow(result.rows[0]) : null;
      })
    };
    const issued = await authorizeSecureFileAccessCore({principal:actor,fileRef:fileId,purpose:"preview",signingSecret:environment.sessionSecret,repository});
    return readSecureFileAccessCore({principal:actor,token:issued.token,expectedPurpose:"preview",signingSecret:environment.sessionSecret,repository,storage:createRuntimePrivateObjectStorage(environment.appEnvironment)});
  }
}
