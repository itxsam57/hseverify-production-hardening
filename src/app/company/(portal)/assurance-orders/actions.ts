"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { AssuranceOrderInputError, type AssuranceFundingMethod } from "@/lib/assurance/assurance-order-domain";
import { AssuranceOrderService } from "@/lib/assurance/assurance-order-service";
import { EvidenceReviewService } from "@/lib/review/evidence-review-service";

function text(formData:FormData,name:string):string { const value=formData.get(name); return typeof value==="string"?value:""; }
function optional(formData:FormData,name:string):string|null { return text(formData,name).trim()||null; }
function references(formData:FormData,name:string):readonly string[] { return Object.freeze(text(formData,name).split(/[\n,]/).map(v=>v.trim()).filter(Boolean)); }
function draft(formData:FormData){ return {
  orderName:text(formData,"orderName"), orderReference:text(formData,"orderReference"), siteId:optional(formData,"siteId"), departmentId:optional(formData,"departmentId"),
  requestedIdentityChecks:references(formData,"requestedIdentityChecks"), requestedEvidenceChecks:references(formData,"requestedEvidenceChecks"),
  assessmentFrameworkReferences:references(formData,"assessmentFrameworkReferences"), interviewRequired:formData.get("interviewRequired")==="on",
  credentialTarget:optional(formData,"credentialTarget"), deadline:optional(formData,"deadline"), effectivePolicyReference:optional(formData,"effectivePolicyReference"),
  companyNotes:optional(formData,"companyNotes"), purchaseOrderReference:optional(formData,"purchaseOrderReference")
} as const; }
async function service():Promise<AssuranceOrderService>{ return new AssuranceOrderService(await getDatabaseClient()); }
function refresh(orderId?:string):void { revalidatePath("/company/assurance-orders"); revalidatePath("/company/action-centre"); revalidatePath("/company/dashboard"); if(orderId) revalidatePath(`/company/assurance-orders/${orderId}`); }

export async function createAssuranceOrderAction(formData:FormData):Promise<void>{
  const principal=await requireCurrentTenantPermission("company.orders.manage");
  const created=await (await service()).createDraft(principal,draft(formData));
  const workerLinkIds=formData.getAll("workerLinkIds").filter((value):value is string=>typeof value==="string"&&value.trim().length>0);
  const fundingRaw=text(formData,"fundingMethod"); const funding:AssuranceFundingMethod=fundingRaw==="company"||fundingRaw==="worker"?fundingRaw:"worker";
  for(const workerLinkId of workerLinkIds) await (await service()).addWorkerTarget(principal,created.orderId,workerLinkId,funding);
  refresh(created.orderId); redirect(`/company/assurance-orders/${created.orderId}`);
}
export async function saveAssuranceOrderDraftAction(formData:FormData):Promise<void>{ const principal=await requireCurrentTenantPermission("company.orders.manage"); const orderId=text(formData,"orderId"); await (await service()).saveDraft(principal,orderId,draft(formData)); refresh(orderId); }
export async function addAssuranceOrderWorkerAction(formData:FormData):Promise<void>{ const principal=await requireCurrentTenantPermission("company.orders.manage"); const fundingRaw=text(formData,"fundingMethod"); if(fundingRaw!=="company"&&fundingRaw!=="worker") throw new AssuranceOrderInputError("Choose Company or Worker funding."); const orderId=text(formData,"orderId"); await (await service()).addWorkerTarget(principal,orderId,text(formData,"workerLinkId"),fundingRaw); refresh(orderId); }
export async function removeAssuranceOrderWorkerAction(formData:FormData):Promise<void>{ const principal=await requireCurrentTenantPermission("company.orders.manage"); const orderId=text(formData,"orderId"); await (await service()).removeWorkerTarget(principal,orderId,text(formData,"targetId")); refresh(orderId); }
export async function validateAssuranceOrderAction(formData:FormData):Promise<void>{ const principal=await requireCurrentTenantPermission("company.orders.manage"); const orderId=text(formData,"orderId"); await (await service()).validateOrder(principal,orderId); refresh(orderId); }
export async function submitAssuranceOrderAction(formData:FormData):Promise<void>{ const principal=await requireCurrentTenantPermission("company.orders.manage"); const orderId=text(formData,"orderId"); await (await service()).submitOrder(principal,orderId); refresh(orderId); }
export async function queueAssuranceCaseEvidenceAction(formData:FormData):Promise<void>{
  const principal=await requireCurrentTenantPermission("company.orders.manage");
  const caseId=text(formData,"caseId");
  if(!caseId) throw new AssuranceOrderInputError("Assurance Case is required.");
  const database=await getDatabaseClient();
  await new EvidenceReviewService(database).queueCaseEvidence(principal,caseId);
  refresh(text(formData,"orderId")||undefined);
}
export async function cancelAssuranceOrderDraftAction(formData:FormData):Promise<void>{ const principal=await requireCurrentTenantPermission("company.orders.manage"); const orderId=text(formData,"orderId"); await (await service()).cancelDraft(principal,orderId); refresh(orderId); }
export async function cancelSubmittedAssuranceOrderAction(formData:FormData):Promise<void>{ const principal=await requireCurrentTenantPermission("company.orders.manage"); const orderId=text(formData,"orderId"); await (await service()).cancelSubmittedOrder(principal,orderId); refresh(orderId); }
