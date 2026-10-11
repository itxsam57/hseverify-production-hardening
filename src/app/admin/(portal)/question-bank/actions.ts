"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getQuestionBankService } from "@/lib/question-bank/question-bank-service";
import type { QuestionWorkflowAction, QuestionWorkflowState, QuestionVersionInput } from "@/lib/question-bank/question-bank-domain";
const text = (f: FormData, n: string) => { const v = f.get(n); return typeof v === "string" ? v : ""; };
function payload(f: FormData): QuestionVersionInput { const parsed = JSON.parse(text(f, "versionPayload")) as unknown; if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Question version payload must be a JSON object."); return parsed as QuestionVersionInput; }
export async function createQuestionAction(f: FormData) { const p = await requirePlatformPermission({ expectedRole: "admin", permission: "platform.operations.manage" }); await (await getQuestionBankService()).createQuestion(p, { questionReference: text(f, "questionReference"), version: payload(f) }); revalidatePath("/admin/question-bank"); }
export async function reviseQuestionAction(f: FormData) { const p = await requirePlatformPermission({ expectedRole: "admin", permission: "platform.operations.manage" }); await (await getQuestionBankService()).reviseQuestion(p, { questionId: text(f, "questionId"), expectedAuthoringVersionId: text(f, "expectedAuthoringVersionId"), version: payload(f) }); revalidatePath("/admin/question-bank"); }
export async function transitionQuestionAction(f: FormData) { const p = await requirePlatformPermission({ expectedRole: "admin", permission: "platform.operations.manage" }); await (await getQuestionBankService()).transitionQuestion(p, { questionId: text(f, "questionId"), expectedAuthoringVersionId: text(f, "expectedAuthoringVersionId"), expectedWorkflowState: text(f, "expectedWorkflowState") as QuestionWorkflowState, expectedRevisionNo: Number(text(f, "expectedRevisionNo")), targetVersionId: text(f, "targetVersionId") || undefined, action: text(f, "workflowAction") as QuestionWorkflowAction, reason: text(f, "reason") }); revalidatePath("/admin/question-bank"); }
