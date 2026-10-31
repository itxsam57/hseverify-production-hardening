"use client";
import {useActionState,useState} from "react";
export type DuplicateIdentityFormState={error:string|null;message:string|null};
export function DuplicateIdentityReviewForm({action,identityId,identityVersionId,checkId,revision}:{action:(previous:DuplicateIdentityFormState,form:FormData)=>Promise<DuplicateIdentityFormState>;identityId:string;identityVersionId:string;checkId:string;revision:number}){
 const [state,formAction,pending]=useActionState(action,{error:null,message:null});const [reason,setReason]=useState(""),[disposition,setDisposition]=useState("duplicate_review");
 return <form aria-label="Resolve duplicate identity" action={formAction} className="content-stack">
  <input type="hidden" name="identityId" value={identityId}/><input type="hidden" name="identityVersionId" value={identityVersionId}/><input type="hidden" name="checkId" value={checkId}/><input type="hidden" name="expectedRevision" value={revision}/>
  <label>Identity eligibility outcome<select name="disposition" value={disposition} onChange={e=>setDisposition(e.target.value)}><option value="duplicate_review">Further duplicate review</option><option value="recover_existing_account">Recover existing account</option><option value="block_worker_id">Keep Worker ID blocked</option><option value="continue">Clear duplicate concern and issue Worker ID</option></select></label>
  <label>Duplicate review reason<textarea name="reason" required minLength={5} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
  <p>Review the matching identity records and independent source documents. A match is a signal for human review. Continuing issues an ID only to this verified identity; accounts are never merged.</p>
  {state.error?<p role="alert">{state.error}</p>:null}{state.message?<p role="status">{state.message}</p>:null}
  <button type="submit" disabled={pending}>{pending?"Saving…":"Record duplicate identity outcome"}</button>
 </form>;
}
