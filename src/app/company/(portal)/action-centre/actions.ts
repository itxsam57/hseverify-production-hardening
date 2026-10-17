"use server";
import { revalidatePath } from "next/cache";
import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { AssuranceOrderAccessError, AssuranceOrderConflictError, AssuranceOrderInputError } from "@/lib/assurance/assurance-order-domain";
import { AssuranceActionCentreService } from "@/lib/assurance/assurance-action-centre-service";
function text(formData:FormData,name:string):string{const value=formData.get(name);return typeof value==="string"?value:"";}
async function service(){return new AssuranceActionCentreService(await getDatabaseClient());}
function refresh(){revalidatePath("/company/action-centre");revalidatePath("/company/assurance-orders");}
export async function assignAssuranceActionOwner(formData:FormData):Promise<void>{const principal=await requireCurrentTenantPermission("company.orders.manage");await(await service()).assignOwner(principal,text(formData,"actionId"),text(formData,"membershipId"));refresh();}
export async function acknowledgeAssuranceAction(formData:FormData):Promise<void>{const principal=await requireCurrentTenantPermission("company.orders.manage");await(await service()).acknowledge(principal,text(formData,"actionId"));refresh();}
export type AssuranceSnoozeActionState = Readonly<{status:"idle"|"error"|"success";message:string}>;
export async function snoozeAssuranceAction(_previousState:AssuranceSnoozeActionState,formData:FormData):Promise<AssuranceSnoozeActionState>{
  const principal=await requireCurrentTenantPermission("company.orders.manage");
  try{
    await(await service()).snooze(principal,text(formData,"actionId"),new Date(text(formData,"until")),text(formData,"reason"));
    refresh();
    return {status:"success",message:"Action snoozed until the selected date."};
  }catch(error){
    if(error instanceof AssuranceOrderInputError||error instanceof AssuranceOrderConflictError)return {status:"error",message:error.message};
    if(error instanceof AssuranceOrderAccessError)return {status:"error",message:"This action is no longer available. Reload and try again."};
    return {status:"error",message:"The action could not be snoozed. Try again."};
  }
}
