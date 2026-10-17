"use client";
import {useActionState,useState} from "react";
type AssignmentState={message:string;success:boolean};
export function ScoringAssignmentForm({action,caseId,reviewId,revision,candidates}:{action:(state:AssignmentState,form:FormData)=>Promise<AssignmentState>;caseId:string;reviewId:string|null;revision:number;candidates:readonly {accountId:string;displayName:string}[]}){
 const [state,submit,pending]=useActionState(action,{message:"",success:false});
 const [reason,setReason]=useState("");
 const [reviewer,setReviewer]=useState("");
 return <form action={submit} className="form-grid">
  <input type="hidden" name="caseId" value={caseId}/><input type="hidden" name="expectedReviewId" value={reviewId??""}/><input type="hidden" name="expectedRevision" value={revision}/>
  <label>Calibrated independent Verifier<select name="reviewerAccountId" required value={reviewer} onChange={event=>setReviewer(event.target.value)}><option value="" disabled>Select Verifier</option>{candidates.map(candidate=><option key={candidate.accountId} value={candidate.accountId}>{candidate.displayName}</option>)}</select></label>
  <label>Assignment reason<textarea name="reason" required minLength={5} maxLength={2000} rows={3} value={reason} onChange={event=>setReason(event.target.value)}/></label>
  <button type="submit" disabled={pending||candidates.length===0}>{pending?"Assigning review…":"Assign assessment review"}</button>
  {state.message?<p role={state.success?"status":"alert"}>{state.message}</p>:null}
 </form>;
}
