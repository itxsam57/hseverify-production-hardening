"use client";
import {useActionState,useState} from "react";
export type ReviewQualityFormState={error:string|null;message:string|null};
export function ReviewQualityForm({action,mode,reference,revision=0,limit=25}:{action:(previous:ReviewQualityFormState,form:FormData)=>Promise<ReviewQualityFormState>;mode:"selection"|"capacity";reference:string;revision?:number;limit?:number}){
 const [state,formAction,pending]=useActionState(action,{error:null,message:null});
 const [reason,setReason]=useState(""),[capacity,setCapacity]=useState(String(limit));
 return <form action={formAction} className="content-stack" aria-label={mode==="selection"?"Require independent second review":"Reviewer workload limit"}>
  <input type="hidden" name={mode==="selection"?"taskId":"accountId"} value={reference}/>
  <input type="hidden" name="expectedRevision" value={revision}/>
  {mode==="capacity"?<label>Maximum open reviews<input name="maxOpenReviews" type="number" min={1} max={250} required value={capacity} onChange={event=>setCapacity(event.target.value)}/></label>:null}
  <label>{mode==="selection"?"Second-review selection reason":"Workload change reason"}<textarea name="reason" required minLength={5} maxLength={2000} value={reason} onChange={event=>setReason(event.target.value)}/></label>
  {state.error?<p role="alert">{state.error}</p>:null}{state.message?<p role="status">{state.message}</p>:null}
  <button type="submit" disabled={pending}>{pending?"Saving…":mode==="selection"?"Require independent second review":"Save workload limit"}</button>
 </form>;
}
