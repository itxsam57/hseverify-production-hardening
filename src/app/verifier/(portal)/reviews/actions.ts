"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getEvidenceReviewService } from "@/lib/review/evidence-review-service";
function text(f:FormData,n:string){const v=f.get(n);return typeof v==='string'?v:'';}
function refresh(id?:string){revalidatePath('/verifier/reviews');if(id)revalidatePath(`/verifier/reviews/${id}`);}
export async function claimEvidenceReviewAction(f:FormData){const p=await requirePlatformPermission({expectedRole:'verifier',permission:'verification.assigned.decide'});const id=text(f,'taskId');await(await getEvidenceReviewService()).claim(p,id);refresh(id);}
export async function declareEvidenceReviewConflictAction(f:FormData){const p=await requirePlatformPermission({expectedRole:'verifier',permission:'verification.assigned.decide'});const id=text(f,'taskId');await(await getEvidenceReviewService()).declareConflict(p,id,text(f,'reason'));refresh(id);}
export async function decideEvidenceReviewAction(f:FormData){const p=await requirePlatformPermission({expectedRole:'verifier',permission:'verification.assigned.decide'});const id=text(f,'taskId');await(await getEvidenceReviewService()).decide(p,id,text(f,'outcome'),text(f,'reason'));refresh(id);}
