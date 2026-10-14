"use client";
import {useActionState,useState} from "react";
export type IntegrityFormState={error:string|null};
export function IntegrityReviewForm({action,reviewId,revision,eventCount,admin=false}:{action:(state:IntegrityFormState,form:FormData)=>Promise<IntegrityFormState>;reviewId:string;revision:number;eventCount:number;admin?:boolean}){
 const [state,submit,pending]=useActionState(action,{error:null}),[reason,setReason]=useState(""),[disposition,setDisposition]=useState("");
 return <form action={submit} onReset={event=>event.preventDefault()} className="content-stack">
 <input type="hidden" name="reviewId" value={reviewId}/><input type="hidden" name={admin?"revision":"integrityRevision"} value={revision}/><input type="hidden" name={admin?"eventCount":"integrityEventCount"} value={eventCount}/>
 {!admin?<label>Integrity disposition<select aria-label="Integrity disposition" name="integrityDisposition" required value={disposition} onChange={event=>setDisposition(event.target.value)}><option value="">Select disposition</option><option value="CLEAR">Clear</option><option value="CONCERN_CONFIRMED">Concern confirmed</option><option value="UNABLE">Unable to determine</option><option value="ESCALATE">Escalate to Admin</option></select></label>:null}
 <label>{admin?"Review and return reason":"Integrity reason"}<textarea aria-label={admin?"Review and return reason":"Integrity reason"} name={admin?"reason":"integrityReason"} minLength={5} maxLength={4000} required value={reason} onChange={event=>setReason(event.target.value)}/></label>
 {state.error?<p role="alert">{state.error}</p>:null}
 <button type="submit" disabled={pending}>{pending?"Saving integrity review…":admin?"Return integrity to Verifier":"Record integrity disposition"}</button>
 </form>;
}
