import "server-only";
import type { AuthorizationPrincipal } from "../authorization/authorization-context-domain";
import { bindTrustedAuditActor } from "../audit/audit-domain";
import { DatabaseAuditRepository } from "../audit/audit-repository";
import type { DatabaseClient } from "../database/database";
import { getDatabaseClient } from "../database/database";
import { QuestionBankAccessError, QuestionBankConflictError, QuestionBankInputError, createQuestionId, createQuestionVersionId, normalizeQuestionReference, normalizeQuestionVersion, type NormalizedQuestionVersion, type QuestionStatus, type QuestionVersionInput, type StoredQuestion, type StoredQuestionVersion, type WrittenRubric, type QuestionAnswerKey, type QuestionType, type QuestionDifficulty, type QuestionWorkflow, type QuestionWorkflowAction, type QuestionWorkflowState } from "./question-bank-domain";
type QuestionRow = {
    question_id: string;
    question_reference: string;
    question_status: QuestionStatus;
    authoring_version_id: string | null;
    current_version_id: string | null;
    current_content_fingerprint: string | null;
    created_at: string | Date;
    updated_at: string | Date;
};
type VersionRow = {
    question_version_id: string;
    question_id: string;
    version_no: number | string;
    question_type: QuestionType;
    prompt: string;
    options_json: unknown;
    answer_key_json: unknown;
    rubric_json: unknown;
    framework_id: string;
    domain_reference: string;
    difficulty: QuestionDifficulty;
    tags_json: unknown;
    content_fingerprint: string;
    created_at: string | Date;
};
const iso = (value: string | Date): string => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
function jsonContainer(value: unknown): unknown {
    if (typeof value !== "string")
        return value;
    const trimmed = value.trim();
    if (!(trimmed.startsWith("[") || trimmed.startsWith("{")))
        return value;
    try {
        return JSON.parse(trimmed);
    }
    catch {
        throw new QuestionBankConflictError("Stored question JSON is invalid.");
    }
}
function stringArray(value: unknown): readonly string[] {
    const parsed = jsonContainer(value);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
        throw new QuestionBankConflictError("Stored question options/tags are invalid.");
    }
    return Object.freeze(parsed as string[]);
}
function answer(value: unknown, questionType: QuestionType): QuestionAnswerKey {
    if (questionType === "MULTIPLE_CHOICE" && typeof value === "string") {
        return value;
    }
    if (questionType === "TRUE_FALSE" && typeof value === "boolean") {
        return value;
    }
    if ((questionType === "INTEGER" || questionType === "DECIMAL") &&
        typeof value === "number" &&
        Number.isFinite(value)) {
        return value;
    }
    throw new QuestionBankConflictError("Stored question answer key is invalid.");
}
function rubric(value: unknown): WrittenRubric | null {
    if (value === null || value === undefined)
        return null;
    const parsed = jsonContainer(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new QuestionBankConflictError("Stored question rubric is invalid.");
    }
    return parsed as WrittenRubric;
}
function toQuestion(row: QuestionRow): StoredQuestion {
    if (!row.current_version_id || !row.authoring_version_id || !row.current_content_fingerprint) {
        throw new QuestionBankConflictError("Question current-version pointer is incomplete.");
    }
    return Object.freeze({
        questionId: row.question_id,
        questionReference: row.question_reference,
        questionStatus: row.question_status,
        currentVersionId: row.current_version_id,
        authoringVersionId: row.authoring_version_id,
        currentContentFingerprint: row.current_content_fingerprint,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at)
    });
}
function toVersion(row: VersionRow): StoredQuestionVersion {
    return Object.freeze({
        questionVersionId: row.question_version_id,
        questionId: row.question_id,
        versionNo: Number(row.version_no),
        questionType: row.question_type,
        prompt: row.prompt,
        options: row.options_json === null ? null : stringArray(row.options_json),
        answerKey: row.answer_key_json === null
            ? null
            : answer(row.answer_key_json, row.question_type),
        rubric: rubric(row.rubric_json),
        frameworkId: row.framework_id,
        domainReference: row.domain_reference,
        difficulty: row.difficulty,
        tags: stringArray(row.tags_json),
        contentFingerprint: row.content_fingerprint,
        createdAt: iso(row.created_at)
    });
}
async function liveAdmin(database: DatabaseClient, principal: AuthorizationPrincipal, now: Date): Promise<void> {
    if (principal.activeRole !== "admin" || principal.accountStatus !== "active") {
        throw new QuestionBankAccessError();
    }
    const row = await database.query(`SELECT 1
     FROM auth_sessions s
     JOIN auth_accounts a ON a.account_id=s.account_id
     JOIN auth_account_roles r ON r.account_id=a.account_id AND r.role='admin'
     WHERE s.session_id=$1
       AND s.account_id=$2
       AND s.active_role='admin'
       AND s.revoked_at IS NULL
       AND s.expires_at>$3
       AND a.account_status='active'
     FOR UPDATE OF s,a`, [principal.sessionId, principal.accountId, now.toISOString()]);
    if (!row.rows[0])
        throw new QuestionBankAccessError();
}
async function frameworkId(database: DatabaseClient, reference: string): Promise<string> {
    const row = await database.query<{
        framework_id: string;
    }>(`SELECT framework_id
     FROM assurance_frameworks
     WHERE framework_reference=$1 AND framework_status='ACTIVE'`, [reference]);
    if (!row.rows[0])
        throw new QuestionBankInputError("Assessment framework is unavailable.");
    return row.rows[0].framework_id;
}
async function appendAudit(database: DatabaseClient, principal: AuthorizationPrincipal, action: "assessment.question.created" | "assessment.question.revised" | "assessment.question.status.changed", reference: string, metadata: Record<string, unknown>): Promise<void> {
    await new DatabaseAuditRepository(Promise.resolve(database)).append(bindTrustedAuditActor(principal), {
        action,
        outcome: "succeeded",
        target: { type: "resource", reference },
        metadata
    });
}
async function insertVersion(database: DatabaseClient, questionId: string, versionNo: number, normalized: NormalizedQuestionVersion, framework: string, principal: AuthorizationPrincipal, now: Date): Promise<string> {
    const id = createQuestionVersionId();
    await database.query(`INSERT INTO assessment_question_versions(
       question_version_id,question_id,version_no,question_type,prompt,
       options_json,answer_key_json,rubric_json,framework_id,domain_reference,
       difficulty,tags_json,content_fingerprint,created_by_account_id,created_at
     ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12::jsonb,$13,$14,$15)`, [
        id,
        questionId,
        versionNo,
        normalized.questionType,
        normalized.prompt,
        normalized.options === null ? null : JSON.stringify(normalized.options),
        normalized.answerKey === null ? null : JSON.stringify(normalized.answerKey),
        normalized.rubric === null ? null : JSON.stringify(normalized.rubric),
        framework,
        normalized.domainReference,
        normalized.difficulty,
        JSON.stringify(normalized.tags),
        normalized.contentFingerprint,
        principal.accountId,
        now.toISOString()
    ]);
    return id;
}
function conflict(error: unknown): never {
    if (error && typeof error === "object" && (error as {
        code?: unknown;
    }).code === "23505") {
        throw new QuestionBankConflictError("Question reference or active semantic content already exists.");
    }
    throw error;
}
type WorkflowRow = {
    question_version_id: string;
    workflow_state: QuestionWorkflowState;
    author_account_id: string;
    approved_by_account_id: string | null;
    approved_at: string | Date | null;
    provenance: "AUTHORED" | "LEGACY_IMPORTED";
    revision_no: number | string;
    transition_reason?: string | null;
    transition_actor_account_id?: string | null;
};
function toWorkflow(row: WorkflowRow): QuestionWorkflow { return Object.freeze({ questionVersionId: row.question_version_id, state: row.workflow_state, authorAccountId: row.author_account_id, approvedByAccountId: row.approved_by_account_id, approvedAt: row.approved_at ? iso(row.approved_at) : null, provenance: row.provenance, revisionNo: Number(row.revision_no), decisionReason: row.transition_reason ?? null, decisionByAccountId: row.transition_actor_account_id ?? null }); }
export type QuestionAdminListItem = Readonly<{
    question: StoredQuestion;
    version: StoredQuestionVersion;
    workflow: QuestionWorkflow;
    liveVersion: StoredQuestionVersion | null;
    history: readonly Readonly<{
        version: StoredQuestionVersion;
        workflow: QuestionWorkflow;
    }>[];
}>;
export class QuestionBankService {
    constructor(private readonly database: DatabaseClient) { }
    async importDraftQuestions(principal: AuthorizationPrincipal, rows: readonly {
        questionReference: string;
        version: QuestionVersionInput;
    }[], now = new Date()): Promise<Readonly<{ createdCount: number }>> {
        if (!Array.isArray(rows) || rows.length === 0 || rows.length > 25)
            throw new QuestionBankInputError("Import must contain 1 to 25 question rows.");
        return this.database.transaction(async database => {
            await liveAdmin(database, principal, now);
            const seen = new Set<string>();
            for (const [index, row] of rows.entries()) {
                const position = index + 1;
                try {
                    if (!row || typeof row !== "object" || Array.isArray(row) || !row.version ||
                        typeof row.version !== "object" || Array.isArray(row.version))
                        throw new QuestionBankInputError("Question row or version must be an object.");
                    let reference: string;
                    let normalized: NormalizedQuestionVersion;
                    try {
                        reference = normalizeQuestionReference(row.questionReference);
                        normalized = normalizeQuestionVersion(row.version);
                    } catch (error) {
                        if (error instanceof TypeError)
                            throw new QuestionBankInputError("Question row is missing fields or has invalid field types.");
                        throw error;
                    }
                    if (seen.has(reference))
                        throw new QuestionBankInputError("Duplicate question reference within this import.");
                    seen.add(reference);
                    const framework = await frameworkId(database, normalized.frameworkReference);
                    const id = createQuestionId();
                    await database.query("INSERT INTO assessment_questions(question_id,question_reference,question_status,created_by_account_id,created_at,updated_at) VALUES($1,$2,'INACTIVE',$3,$4,$4)", [id, reference, principal.accountId, now.toISOString()]);
                    const versionId = await insertVersion(database, id, 1, normalized, framework, principal, now);
                    await database.query("UPDATE assessment_questions SET current_version_id=$2,authoring_version_id=$2,current_content_fingerprint=$3 WHERE question_id=$1", [id, versionId, normalized.contentFingerprint]);
                    await appendAudit(database, principal, "assessment.question.created", id, { questionType: normalized.questionType, versionNo: 1, workflowState: "DRAFT", importRow: position });
                } catch (error) {
                    if (error instanceof QuestionBankInputError)
                        throw new QuestionBankInputError(`Row ${position}: ${error.message}`);
                    if (error instanceof QuestionBankConflictError || (error && typeof error === "object" && (error as {code?: unknown}).code === "23505"))
                        throw new QuestionBankConflictError(`Row ${position}: question reference or content conflicts with an existing question.`);
                    throw error;
                }
            }
            return Object.freeze({ createdCount: rows.length });
        });
    }
    async createQuestion(principal: AuthorizationPrincipal, input: {
        questionReference: string;
        version: QuestionVersionInput;
    }, now = new Date()): Promise<QuestionAdminListItem> {
        const reference = normalizeQuestionReference(input.questionReference), normalized = normalizeQuestionVersion(input.version);
        try {
            return await this.database.transaction(async (database) => {
                await liveAdmin(database, principal, now);
                const framework = await frameworkId(database, normalized.frameworkReference), id = createQuestionId();
                await database.query("INSERT INTO assessment_questions(question_id,question_reference,question_status,created_by_account_id,created_at,updated_at) VALUES($1,$2,'INACTIVE',$3,$4,$4)", [id, reference, principal.accountId, now.toISOString()]);
                const versionId = await insertVersion(database, id, 1, normalized, framework, principal, now);
                await database.query("UPDATE assessment_questions SET current_version_id=$2,authoring_version_id=$2,current_content_fingerprint=$3 WHERE question_id=$1", [id, versionId, normalized.contentFingerprint]);
                await appendAudit(database, principal, "assessment.question.created", id, { questionType: normalized.questionType, versionNo: 1, workflowState: "DRAFT" });
                return this.loadItem(database, id);
            });
        }
        catch (error) {
            return conflict(error);
        }
    }
    async reviseQuestion(principal: AuthorizationPrincipal, input: {
        questionId: string;
        expectedAuthoringVersionId?: string;
        expectedCurrentVersionId?: string;
        version: QuestionVersionInput;
    }, now = new Date()): Promise<QuestionAdminListItem> {
        const normalized = normalizeQuestionVersion(input.version), expected = input.expectedAuthoringVersionId ?? input.expectedCurrentVersionId;
        try {
            return await this.database.transaction(async (database) => {
                await liveAdmin(database, principal, now);
                const item = await this.lockItem(database, input.questionId, expected);
                if (["UNDER_REVIEW", "APPROVED", "RETIRED", "ARCHIVED"].includes(item.workflow.state))
                    throw new QuestionBankConflictError("Resolve the current review or retirement before authoring another revision.");
                const framework = await frameworkId(database, normalized.frameworkReference);
                const next=await database.query<{version_no:number|string}>("SELECT COALESCE(MAX(version_no),0)+1 AS version_no FROM assessment_question_versions WHERE question_id=$1",[input.questionId]);
                const versionNo=Number(next.rows[0]?.version_no);
                const versionId = await insertVersion(database, input.questionId, versionNo, normalized, framework, principal, now);
                await database.query("UPDATE assessment_questions SET authoring_version_id=$2,updated_at=$3 WHERE question_id=$1", [input.questionId, versionId, now.toISOString()]);
                await appendAudit(database, principal, "assessment.question.revised", input.questionId, { questionType: normalized.questionType, versionNo, workflowState: "DRAFT" });
                return this.loadItem(database, input.questionId);
            });
        }
        catch (error) {
            return conflict(error);
        }
    }
    async transitionQuestion(principal: AuthorizationPrincipal, input: {
        questionId: string;
        expectedAuthoringVersionId: string;
        expectedWorkflowState: QuestionWorkflowState;
        expectedRevisionNo: number;
        targetVersionId?: string;
        action: QuestionWorkflowAction;
        reason?: string;
    }, now = new Date()): Promise<QuestionAdminListItem> {
        const transitions: Record<QuestionWorkflowAction, readonly [
            readonly QuestionWorkflowState[],
            QuestionWorkflowState
        ]> = {
            SUBMIT: [["DRAFT"], "UNDER_REVIEW"], REQUEST_CHANGES: [["UNDER_REVIEW"], "CHANGES_REQUESTED"], APPROVE: [["UNDER_REVIEW"], "APPROVED"], PUBLISH: [["APPROVED"], "PUBLISHED"], PAUSE: [["PUBLISHED"], "PAUSED"], RESUME: [["PAUSED"], "PUBLISHED"], RETIRE: [["PUBLISHED", "PAUSED"], "RETIRED"], ARCHIVE: [["DRAFT", "CHANGES_REQUESTED", "APPROVED", "RETIRED", "PAUSED"], "ARCHIVED"]
        };
        if (!transitions[input.action])
            throw new QuestionBankInputError("Question transition is invalid.");
        const reason = input.reason?.trim() || null;
        if (reason && reason.length > 2000)
            throw new QuestionBankInputError("Question reason is too long.");
        if (["REQUEST_CHANGES", "RETIRE"].includes(input.action) && (!reason || reason.length < 3))
            throw new QuestionBankInputError("Give a reason for this decision.");
        try {
            return await this.database.transaction(async (database) => {
                await liveAdmin(database, principal, now);
                const item = await this.lockItem(database, input.questionId, input.expectedAuthoringVersionId);
                const target = item.history.find(entry => entry.version.questionVersionId === (input.targetVersionId ?? item.question.authoringVersionId));
                if (!target)
                    throw new QuestionBankAccessError();
                const workflow = target.workflow, version = target.version;
                const [from, to] = transitions[input.action];
                if (!Number.isSafeInteger(input.expectedRevisionNo) || workflow.revisionNo !== input.expectedRevisionNo || workflow.state !== input.expectedWorkflowState || !from.includes(workflow.state))
                    throw new QuestionBankConflictError("Question lifecycle changed. Reload before deciding.");
                if (input.action === "SUBMIT" && workflow.authorAccountId !== principal.accountId)
                    throw new QuestionBankAccessError();
                if (["APPROVE", "REQUEST_CHANGES"].includes(input.action) && workflow.authorAccountId === principal.accountId)
                    throw new QuestionBankAccessError();
                if (input.action === "ARCHIVE" && workflow.state !== "RETIRED" && item.question.currentVersionId === version.questionVersionId && workflow.state === "PAUSED")
                    throw new QuestionBankConflictError("Retire the live version before archiving.");
                if (["SUBMIT", "REQUEST_CHANGES", "APPROVE", "PUBLISH"].includes(input.action) && version.questionVersionId !== item.question.authoringVersionId)
                    throw new QuestionBankConflictError("Review the current authoring version.");
                if (input.action === "RESUME" && version.questionVersionId !== item.question.currentVersionId)
                    throw new QuestionBankConflictError("Superseded publication cannot replace the current live pointer.");
                if (input.action === "PUBLISH" && item.question.currentVersionId !== version.questionVersionId) {
                    const prior = await database.query<WorkflowRow>("SELECT * FROM question_version_workflow WHERE question_version_id=$1 FOR UPDATE", [item.question.currentVersionId]);
                    if (prior.rows[0]?.workflow_state === "PUBLISHED")
                        await this.changeWorkflow(database, principal, prior.rows[0], "PAUSED", "Superseded by independently approved revision.", now);
                }
                await this.changeWorkflow(database, principal, { question_version_id: workflow.questionVersionId, workflow_state: workflow.state, author_account_id: workflow.authorAccountId, approved_by_account_id: workflow.approvedByAccountId, approved_at: workflow.approvedAt, provenance: workflow.provenance, revision_no: workflow.revisionNo }, to, reason, now);
                if (to === "PUBLISHED")
                    await database.query("UPDATE assessment_questions SET current_version_id=$2,current_content_fingerprint=$3,question_status='ACTIVE',updated_at=$4 WHERE question_id=$1", [input.questionId, version.questionVersionId, version.contentFingerprint, now.toISOString()]);
                else if (item.question.currentVersionId === version.questionVersionId && ["PAUSED", "RETIRED", "ARCHIVED"].includes(to))
                    await database.query("UPDATE assessment_questions SET question_status='INACTIVE',updated_at=$2 WHERE question_id=$1", [input.questionId, now.toISOString()]);
                if(to==="ARCHIVED"&&version.questionVersionId===item.question.authoringVersionId&&version.questionVersionId!==item.question.currentVersionId){
                    const remaining=await database.query<{question_version_id:string}>("SELECT v.question_version_id FROM assessment_question_versions v JOIN question_version_workflow w USING(question_version_id,question_id) WHERE v.question_id=$1 AND w.workflow_state<>'ARCHIVED' ORDER BY v.version_no DESC LIMIT 1",[input.questionId]);
                    if(remaining.rows[0])await database.query("UPDATE assessment_questions SET authoring_version_id=$2,updated_at=$3 WHERE question_id=$1",[input.questionId,remaining.rows[0].question_version_id,now.toISOString()]);
                }
                await appendAudit(database, principal, "assessment.question.status.changed", input.questionId, { workflowState: to, questionVersionId: version.questionVersionId, reason });
                return this.loadItem(database, input.questionId);
            });
        }
        catch (error) {
            return conflict(error);
        }
    }
    // Legacy callers may pause published content; activation always requires explicit approved workflow.
    async setStatus(principal: AuthorizationPrincipal, questionId: string, status: QuestionStatus, now = new Date()): Promise<StoredQuestion> {
        if (status !== "INACTIVE")
            throw new QuestionBankConflictError("Use approval and publication; direct activation is unavailable.");
        const items = await this.listQuestions(principal), item = items.find(row => row.question.questionId === questionId);
        if (!item)
            throw new QuestionBankAccessError();
        return (await this.transitionQuestion(principal, { questionId, expectedAuthoringVersionId: item.question.authoringVersionId, expectedWorkflowState: item.workflow.state, expectedRevisionNo: item.workflow.revisionNo, action: "PAUSE" }, now)).question;
    }
    async listQuestions(principal: AuthorizationPrincipal): Promise<readonly QuestionAdminListItem[]> {
        return this.database.transaction(async (database) => {
            await liveAdmin(database, principal, new Date());
            const rows = await database.query<{
                question_id: string;
            }>("SELECT question_id FROM assessment_questions ORDER BY updated_at DESC,question_id");
            const result: QuestionAdminListItem[] = [];
            for (const row of rows.rows)
                result.push(await this.loadItem(database, row.question_id));
            return Object.freeze(result);
        });
    }
    private async lockItem(database: DatabaseClient, id: string, expected: string | undefined): Promise<QuestionAdminListItem> {
        if (!/^assessment_question_[A-Za-z0-9_-]{24}$/.test(id) || !expected || !/^question_version_[A-Za-z0-9_-]{24}$/.test(expected))
            throw new QuestionBankInputError("Question version reference is invalid.");
        const rows = await database.query<QuestionRow>("SELECT * FROM assessment_questions WHERE question_id=$1 FOR UPDATE", [id]);
        const row = rows.rows[0];
        if (!row)
            throw new QuestionBankAccessError();
        if (row.authoring_version_id !== expected)
            throw new QuestionBankConflictError("Question was revised by another writer.");
        return this.loadItem(database, id);
    }
    private async changeWorkflow(database: DatabaseClient, principal: AuthorizationPrincipal, row: WorkflowRow, to: QuestionWorkflowState, reason: string | null, now: Date): Promise<void> {
        const result = await database.query("UPDATE question_version_workflow SET workflow_state=$2,transition_actor_account_id=$3,transition_session_id=$4,transition_reason=$5,approved_by_account_id=CASE WHEN $2='APPROVED' THEN $3 ELSE approved_by_account_id END,approved_at=CASE WHEN $2='APPROVED' THEN $6::timestamptz ELSE approved_at END WHERE question_version_id=$1 AND workflow_state=$7 AND revision_no=$8 RETURNING question_version_id", [row.question_version_id, to, principal.accountId, principal.sessionId, reason, now.toISOString(), row.workflow_state, Number(row.revision_no)]);
        if (!result.rows[0])
            throw new QuestionBankConflictError("Question review changed concurrently.");
    }
    private async loadItem(database: DatabaseClient, id: string): Promise<QuestionAdminListItem> {
        const q = await database.query<QuestionRow>("SELECT * FROM assessment_questions WHERE question_id=$1", [id]);
        if (!q.rows[0])
            throw new QuestionBankAccessError();
        const question = toQuestion(q.rows[0]);
        const versions = await database.query<VersionRow & WorkflowRow>("SELECT v.*,w.*,v.created_at FROM assessment_question_versions v JOIN question_version_workflow w USING(question_version_id,question_id) WHERE v.question_id=$1 ORDER BY version_no DESC", [id]);
        const history = Object.freeze(versions.rows.map(row => Object.freeze({ version: toVersion(row), workflow: toWorkflow(row) })));
        const authoring = history.find(row => row.version.questionVersionId === question.authoringVersionId);
        if (!authoring)
            throw new QuestionBankConflictError("Question authoring version is unavailable.");
        const live = history.find(row => row.version.questionVersionId === question.currentVersionId && ["PUBLISHED", "PAUSED", "RETIRED"].includes(row.workflow.state));
        return Object.freeze({ question, version: authoring.version, workflow: authoring.workflow, liveVersion: live?.version ?? null, history });
    }
}
export async function getQuestionBankService(): Promise<QuestionBankService> { return new QuestionBankService(await getDatabaseClient()); }
