"use server";
import { redirect } from "next/navigation";
import { EvidenceReviewConflictError } from "@/lib/review/evidence-review-domain";
import { revalidatePath } from "next/cache";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getEvidenceReviewService } from "@/lib/review/evidence-review-service";
function text(f:FormData,n:string){const v=f.get(n);return typeof v==='string'?v:'';}
function refresh(id?:string){revalidatePath('/verifier/reviews');if(id)revalidatePath(`/verifier/reviews/${id}`);}
export async function claimEvidenceReviewAction(f:FormData){const p=await requirePlatformPermission({expectedRole:'verifier',permission:'verification.assigned.decide'});const id=text(f,'taskId');await(await getEvidenceReviewService()).claim(p,id);refresh(id);}
export async function declareEvidenceReviewConflictAction(f:FormData){const p=await requirePlatformPermission({expectedRole:'verifier',permission:'verification.assigned.decide'});const id=text(f,'taskId');await(await getEvidenceReviewService()).declareConflict(p,id,text(f,'reason'));refresh(id);}
export async function decideEvidenceReviewAction(f:FormData){const p=await requirePlatformPermission({expectedRole:'verifier',permission:'verification.assigned.decide'});const id=text(f,'taskId');const revision=text(f,'decisionRevision');if(!/^(0|[1-9][0-9]*)$/.test(revision))throw new Error('Invalid review history revision.');try{await(await getEvidenceReviewService()).decide(p,id,text(f,'outcome'),text(f,'reason'),new Date(),{assessorVisible:f.get('assessorVisible')==='on',confirmTrade:f.get('confirmTrade')==='on',expectedResolutionRevision:Number(revision)});}catch(error){if(error instanceof EvidenceReviewConflictError)redirect(`/verifier/reviews/${id}?reviewError=history_changed`);throw error;}refresh(id);}

export async function saveEvidenceReviewDraftAction(f:FormData){const p=await requirePlatformPermission({expectedRole:'verifier',permission:'verification.assigned.decide'});const id=text(f,'taskId');const revision=text(f,'draftRevision');if(!/^(0|[1-9][0-9]*)$/.test(revision))throw new Error('Invalid draft revision.');await(await getEvidenceReviewService()).saveDraftNotes(p,id,text(f,'notes'),Number(revision));refresh(id);}

export async function resolveEvidenceReviewAction(f:FormData){const p=await requirePlatformPermission({expectedRole:'verifier',permission:'verification.assigned.decide'});const id=text(f,'taskId');await(await getEvidenceReviewService()).resolveReview(p,id,{expectedRevision:/^(0|[1-9][0-9]*)$/.test(text(f,'resolutionRevision'))?Number(text(f,'resolutionRevision')):NaN,outcome:text(f,'resolution'),reason:text(f,'resolutionReason'),attemptedMethods:text(f,'attemptedMethods'),limitations:text(f,'limitations'),destination:text(f,'destination')});refresh(id);}
