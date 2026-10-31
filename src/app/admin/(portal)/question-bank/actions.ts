"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getQuestionBankService } from "@/lib/question-bank/question-bank-service";
import { QuestionBankConflictError, QuestionBankInputError, type QuestionVersionInput as BatchVersion } from "@/lib/question-bank/question-bank-domain";
import type { QuestionWorkflowAction, QuestionWorkflowState, QuestionVersionInput } from "@/lib/question-bank/question-bank-domain";
const text = (f: FormData, n: string) => { const v = f.get(n); return typeof v === "string" ? v : ""; };
function payload(f: FormData): QuestionVersionInput { const parsed = JSON.parse(text(f, "versionPayload")) as unknown; if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Question version payload must be a JSON object."); return parsed as QuestionVersionInput; }
export async function createQuestionAction(f: FormData) { const p = await requirePlatformPermission({ expectedRole: "admin", permission: "platform.operations.manage" }); await (await getQuestionBankService()).createQuestion(p, { questionReference: text(f, "questionReference"), exposureFamilyReference: text(f, "exposureFamilyReference") || undefined, version: payload(f) }); revalidatePath("/admin/question-bank"); }
export async function reviseQuestionAction(f: FormData) { const p = await requirePlatformPermission({ expectedRole: "admin", permission: "platform.operations.manage" }); await (await getQuestionBankService()).reviseQuestion(p, { questionId: text(f, "questionId"), expectedAuthoringVersionId: text(f, "expectedAuthoringVersionId"), version: payload(f) }); revalidatePath("/admin/question-bank"); }
export async function transitionQuestionAction(f: FormData) { const p = await requirePlatformPermission({ expectedRole: "admin", permission: "platform.operations.manage" }); await (await getQuestionBankService()).transitionQuestion(p, { questionId: text(f, "questionId"), expectedAuthoringVersionId: text(f, "expectedAuthoringVersionId"), expectedWorkflowState: text(f, "expectedWorkflowState") as QuestionWorkflowState, expectedRevisionNo: Number(text(f, "expectedRevisionNo")), targetVersionId: text(f, "targetVersionId") || undefined, action: text(f, "workflowAction") as QuestionWorkflowAction, reason: text(f, "reason") }); revalidatePath("/admin/question-bank"); }

export type BulkQuestionImportState = { status: "idle" | "error" | "success"; message: string };
export async function importDraftQuestionsAction(_previous: BulkQuestionImportState, f: FormData): Promise<BulkQuestionImportState> {
    const principal = await requirePlatformPermission({ expectedRole: "admin", permission: "platform.operations.manage" });
    const raw = text(f, "questionBatch");
    if (!raw.trim() || raw.length > 60000)
        return { status: "error", message: "Batch JSON must contain 1 to 60,000 characters." };
    let rows: unknown;
    try { rows = JSON.parse(raw); }
    catch { return { status: "error", message: "Question batch is not valid JSON." }; }
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 25)
        return { status: "error", message: "Question batch must be an array of 1 to 25 rows." };
    try {
        const result = await (await getQuestionBankService()).importDraftQuestions(
            principal, rows as {questionReference:string;exposureFamilyReference?:string;version:BatchVersion}[]
        );
        revalidatePath("/admin/question-bank");
        return { status: "success", message: `${result.createdCount} draft questions imported. Independent approval is still required.` };
    } catch (error) {
        if (error instanceof QuestionBankInputError || error instanceof QuestionBankConflictError)
            return { status: "error", message: `No rows imported. ${error.message}` };
        throw error;
    }
}
