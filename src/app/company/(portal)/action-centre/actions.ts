"use server";
import { revalidatePath } from "next/cache";
import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { AssuranceActionCentreService } from "@/lib/assurance/assurance-action-centre-service";
function text(formData:FormData,name:string):string{const value=formData.get(name);return typeof value==="string"?value:"";}
async function service(){return new AssuranceActionCentreService(await getDatabaseClient());}
function refresh(){revalidatePath("/company/action-centre");revalidatePath("/company/assurance-orders");}
export async function assignAssuranceActionOwner(formData:FormData):Promise<void>{const principal=await requireCurrentTenantPermission("company.orders.manage");await(await service()).assignOwner(principal,text(formData,"actionId"),text(formData,"membershipId"));refresh();}
export async function acknowledgeAssuranceAction(formData:FormData):Promise<void>{const principal=await requireCurrentTenantPermission("company.orders.manage");await(await service()).acknowledge(principal,text(formData,"actionId"));refresh();}
export async function snoozeAssuranceAction(formData:FormData):Promise<void>{const principal=await requireCurrentTenantPermission("company.orders.manage");const until=new Date(text(formData,"until"));await(await service()).snooze(principal,text(formData,"actionId"),until,text(formData,"reason"));refresh();}
