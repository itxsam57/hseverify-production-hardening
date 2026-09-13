"use server";
import { revalidatePath } from "next/cache";
import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { BillingService } from "@/lib/billing/billing-service";

function text(data:FormData,name:string):string{const value=data.get(name);return typeof value==="string"?value:"";}
function integer(data:FormData,name:string):number{return Number.parseInt(text(data,name),10);}
async function service():Promise<BillingService>{return new BillingService(await getDatabaseClient());}
function refresh():void{revalidatePath("/company/billing");}

export async function createCreditCheckout(formData:FormData):Promise<void>{const principal=await requireCurrentTenantPermission("company.billing.manage");await(await service()).createCreditCheckout(principal,{idempotencyKey:text(formData,"idempotencyKey"),creditUnits:integer(formData,"creditUnits"),amountMinor:integer(formData,"amountMinor"),currency:text(formData,"currency")});refresh();}
export async function requestRefund(formData:FormData):Promise<void>{const principal=await requireCurrentTenantPermission("company.billing.manage");await(await service()).requestRefund(principal,{invoiceId:text(formData,"invoiceId"),idempotencyKey:text(formData,"idempotencyKey"),amountMinor:integer(formData,"amountMinor")});refresh();}
export async function runReconciliation():Promise<void>{const principal=await requireCurrentTenantPermission("company.billing.manage");await(await service()).runReconciliation(principal);refresh();}
