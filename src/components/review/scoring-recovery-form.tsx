"use client";

import {useActionState,useState} from "react";

export type ScoringRecoveryState = {error:string|null;message:string|null};
export function ScoringRecoveryForm({action,reviewId,revision,mode}:{action:(previous:ScoringRecoveryState,form:FormData)=>Promise<ScoringRecoveryState>;reviewId:string;revision:number;mode:"conflict"|"amendment"}){
 const [state,formAction,pending]=useActionState(action,{error:null,message:null});
 const [reason,setReason]=useState("");
 const conflict=mode==="conflict";
 return <form action={formAction} className="content-stack" aria-label={conflict?"Declare scoring conflict":"Start scoring amendment"}>
  <input type="hidden" name="reviewId" value={reviewId}/>
  <input type="hidden" name="expectedRevision" value={revision}/>
  <label>{conflict?"Scoring conflict reason":"Scoring amendment reason"}
   <textarea name="reason" required minLength={5} maxLength={4000} value={reason} onChange={event=>setReason(event.target.value)}/>
  </label>
  <p>{conflict?"Declaring a conflict removes your scoring access and sends this case to Admin for independent reassignment.":"The original final score remains in history. Every rubric criterion must be marked again before the amendment can advance."}</p>
  {state.error?<p role="alert">{state.error}</p>:null}
  {state.message?<p role="status">{state.message}</p>:null}
  <button type="submit" disabled={pending}>{pending?"Saving…":conflict?"Declare scoring conflict":"Start scoring amendment"}</button>
 </form>;
}
