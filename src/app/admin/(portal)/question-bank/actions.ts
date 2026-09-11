"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getQuestionBankService } from "@/lib/question-bank/question-bank-service";
import type { QuestionStatus,QuestionVersionInput } from "@/lib/question-bank/question-bank-domain";
const text=(f:FormData,n:string)=>{const v=f.get(n);return typeof v==="string"?v:"";};
function payload(f:FormData):QuestionVersionInput{const parsed=JSON.parse(text(f,"versionPayload")) as unknown;if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error("Question version payload must be a JSON object.");return parsed as QuestionVersionInput;}
export async function createQuestionAction(f:FormData){const p=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});await(await getQuestionBankService()).createQuestion(p,{questionReference:text(f,"questionReference"),version:payload(f)});revalidatePath("/admin/question-bank");}
export async function reviseQuestionAction(f:FormData){const p=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});await(await getQuestionBankService()).reviseQuestion(p,{questionId:text(f,"questionId"),expectedCurrentVersionId:text(f,"expectedCurrentVersionId"),version:payload(f)});revalidatePath("/admin/question-bank");}
export async function setQuestionStatusAction(f:FormData){const p=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});await(await getQuestionBankService()).setStatus(p,text(f,"questionId"),text(f,"questionStatus") as QuestionStatus);revalidatePath("/admin/question-bank");}
