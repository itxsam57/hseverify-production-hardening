"use server";
import { revalidatePath } from "next/cache";
import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getEffectivePolicyService } from "@/lib/policy/effective-policy-service";
const text=(f:FormData,n:string)=>{const v=f.get(n);return typeof v==="string"?v:"";};
export async function savePolicyOverrideAction(f:FormData){const p=await requireCurrentTenantPermission("company.settings.manage");await(await getEffectivePolicyService()).saveTenantOverride(p,{policyReference:text(f,"policyReference"),overrideValues:JSON.parse(text(f,"overrideValues")) as unknown,effectiveFrom:new Date(text(f,"effectiveFrom")),effectiveTo:text(f,"effectiveTo")?new Date(text(f,"effectiveTo")):null});revalidatePath("/company/settings/policy");}
