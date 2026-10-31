import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getQuestionBankService, type QuestionAdminListItem } from "@/lib/question-bank/question-bank-service";
import type { QuestionWorkflowAction } from "@/lib/question-bank/question-bank-domain";
import { createQuestionAction, reviseQuestionAction, transitionQuestionAction, importDraftQuestionsAction } from "./actions";
import { QuestionBulkImportForm } from "@/components/admin/question-bulk-import-form";
const EXAMPLE = JSON.stringify({ questionType: "MULTIPLE_CHOICE", prompt: "What is the first safe action after discovering an uncontrolled workplace hazard?", options: ["Stop work", "Continue working", "Ignore the hazard"], answerKey: "Stop work", rubric: null, frameworkReference: "HSE-CORE", domainReference: "Hazard control", difficulty: "MEDIUM", tags: ["hazards", "core"] }, null, 2);
function validActions(item: QuestionAdminListItem, accountId: string): readonly Readonly<{
    action: QuestionWorkflowAction;
    label: string;
    reason?: boolean;
}>[] {
    const author = item.workflow.authorAccountId === accountId;
    switch (item.workflow.state) {
        case "DRAFT": return [...(author ? [{ action: "SUBMIT" as const, label: "Submit for review" }] : []), { action: "ARCHIVE", label: "Archive draft" }];
        case "UNDER_REVIEW": return author ? [] : [{ action: "APPROVE", label: "Approve version" }, { action: "REQUEST_CHANGES", label: "Request changes", reason: true }];
        case "APPROVED": return [{ action: "PUBLISH", label: "Publish approved version" }, { action: "ARCHIVE", label: "Archive approved draft" }];
        case "CHANGES_REQUESTED": return [{ action: "ARCHIVE", label: "Archive draft" }];
        case "PUBLISHED": return [{ action: "PAUSE", label: "Pause publication" }, { action: "RETIRE", label: "Retire version", reason: true }];
        case "PAUSED": return [{ action: "RESUME", label: "Resume publication" }, { action: "RETIRE", label: "Retire version", reason: true }];
        case "RETIRED": return [{ action: "ARCHIVE", label: "Archive version" }];
        default: return [];
    }
}
export default async function QuestionBankPage() {
    const principal = await requirePlatformPermission({ expectedRole: "admin", permission: "platform.operations.manage" });
    const questions = await (await getQuestionBankService()).listQuestions(principal);
    const publishedCount = questions.filter(item => item.question.questionStatus === "ACTIVE").length;
    return <section className="page-stack">
 <div className="page-heading"><div><p className="eyebrow">Assessment administration</p><h1>Question Bank</h1><p>Drafts require an independent administrator to approve the exact version before publication. Only published versions enter live assessments.</p><p>{publishedCount} published questions available</p></div></div>
 <form action={createQuestionAction}><h2>Create question</h2><label>Stable reference<input name="questionReference" required minLength={2} maxLength={120}/></label><label>Version JSON<textarea name="versionPayload" required rows={16} placeholder={EXAMPLE}/></label><button type="submit">Create draft question</button></form>
 <QuestionBulkImportForm action={importDraftQuestionsAction}/>
 <section><h2>Current questions</h2>{questions.length === 0 ? <p>No questions have been created.</p> : questions.map(item => <article key={item.question.questionId} data-question-reference={item.question.questionReference}>
 <h3>{item.question.questionReference}</h3>
 <p>{item.version.questionType} · {item.version.difficulty} · v{item.version.versionNo} · {item.workflow.state}</p><p>{item.version.prompt}</p>
 <p>Domain: {item.version.domainReference} · Framework: <code>{item.version.frameworkId}</code></p><p>Tags: {item.version.tags.join(", ") || "None"}</p>
 <p>Author: {item.workflow.authorAccountId}{item.workflow.approvedByAccountId ? <> · Approved by: {item.workflow.approvedByAccountId}</> : null}</p>
 {item.workflow.decisionReason ? <p>Decision reason: {item.workflow.decisionReason}</p> : null}
 {item.workflow.provenance === "LEGACY_IMPORTED" ? <p>Imported publication history; independent approval was not recorded for this legacy version.</p> : null}
 {item.liveVersion ? <aside><h4>Live publication pointer · v{item.liveVersion.versionNo}</h4><p>{item.question.questionStatus === "ACTIVE" ? "Published" : "Not currently delivering"}: {item.liveVersion.prompt}</p>{item.liveVersion.questionVersionId !== item.version.questionVersionId ? <p>This version stays live while the newer draft is reviewed.</p> : null}{item.liveVersion.questionVersionId !== item.version.questionVersionId ? item.history.filter(entry => entry.version.questionVersionId === item.liveVersion?.questionVersionId).map(entry => <div key={entry.version.questionVersionId}>{(entry.workflow.state === "PUBLISHED" ? [{ action: "PAUSE", label: "Pause live version" }, { action: "RETIRE", label: "Retire live version" }] : entry.workflow.state === "PAUSED" ? [{ action: "RESUME", label: "Resume live version" }, { action: "RETIRE", label: "Retire live version" }] : []).map(action => <form action={transitionQuestionAction} key={action.action}><input type="hidden" name="questionId" value={item.question.questionId}/><input type="hidden" name="expectedAuthoringVersionId" value={item.question.authoringVersionId}/><input type="hidden" name="targetVersionId" value={entry.version.questionVersionId}/><input type="hidden" name="expectedWorkflowState" value={entry.workflow.state}/><input type="hidden" name="expectedRevisionNo" value={entry.workflow.revisionNo}/><input type="hidden" name="workflowAction" value={action.action}/>{action.action === "RETIRE" ? <label>Decision reason<textarea name="reason" required minLength={3} maxLength={2000}/></label> : null}<button type="submit">{action.label}</button></form>)}</div>) : null}</aside> : <p>This question has no current publication.</p>}
 {validActions(item, principal.accountId).map(action => <form action={transitionQuestionAction} key={action.action}>
 <input type="hidden" name="questionId" value={item.question.questionId}/><input type="hidden" name="expectedAuthoringVersionId" value={item.question.authoringVersionId}/><input type="hidden" name="expectedWorkflowState" value={item.workflow.state}/><input type="hidden" name="expectedRevisionNo" value={item.workflow.revisionNo}/><input type="hidden" name="workflowAction" value={action.action}/>
 {action.reason ? <label>Decision reason<textarea name="reason" required minLength={3} maxLength={2000}/></label> : null}<button type="submit">{action.label}</button></form>)}
 {item.workflow.state === "UNDER_REVIEW" && item.workflow.authorAccountId === principal.accountId ? <p>Another administrator must review this version.</p> : null}
 {["DRAFT", "CHANGES_REQUESTED", "PUBLISHED", "PAUSED"].includes(item.workflow.state) ? <details><summary>Create a new immutable revision</summary><form action={reviseQuestionAction}><input type="hidden" name="questionId" value={item.question.questionId}/><input type="hidden" name="expectedAuthoringVersionId" value={item.question.authoringVersionId}/><label>Replacement version JSON<textarea name="versionPayload" required rows={14} placeholder="Paste the complete next version JSON here."/></label><button type="submit">Save draft revision</button></form></details> : null}
 <details><summary>Immutable version history</summary>{item.history.map(entry => <div key={entry.version.questionVersionId}><p>v{entry.version.versionNo} · {entry.workflow.state} · {entry.workflow.provenance}</p><p>{entry.version.prompt}</p><p>Author: {entry.workflow.authorAccountId} · Reviewer: {entry.workflow.approvedByAccountId ?? "Not approved"}</p>{entry.workflow.decisionReason ? <p>Decision reason: {entry.workflow.decisionReason}</p> : null}{entry.version.questionVersionId !== item.question.authoringVersionId && entry.version.questionVersionId !== item.question.currentVersionId && ["DRAFT", "CHANGES_REQUESTED", "APPROVED", "PAUSED", "RETIRED"].includes(entry.workflow.state) ? <form action={transitionQuestionAction}><input type="hidden" name="questionId" value={item.question.questionId}/><input type="hidden" name="expectedAuthoringVersionId" value={item.question.authoringVersionId}/><input type="hidden" name="targetVersionId" value={entry.version.questionVersionId}/><input type="hidden" name="expectedWorkflowState" value={entry.workflow.state}/><input type="hidden" name="expectedRevisionNo" value={entry.workflow.revisionNo}/><input type="hidden" name="workflowAction" value="ARCHIVE"/><button type="submit">Archive superseded v{entry.version.versionNo}</button></form> : null}</div>)}</details>
 </article>)}</section></section>;
}
