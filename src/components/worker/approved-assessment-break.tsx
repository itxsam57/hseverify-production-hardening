"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startApprovedAssessmentBreakAction,interruptAssessmentAction } from "@/app/worker/(portal)/assessments/[attemptId]/actions";
import { Button } from "@/components/ui/button";
import type { AssessmentAttemptClientView } from "@/lib/assessment-attempt/assessment-attempt-domain";
export function ApprovedBreakControl({view,onPrepare}:{view:AssessmentAttemptClientView;onPrepare?:()=>Promise<boolean>}):React.JSX.Element|null {
 const router=useRouter(),[minutes,setMinutes]=useState(1),[pending,setPending]=useState(false),[error,setError]=useState("");
 const mutation=useRef<string|null>(null),allowance=view.accommodationBreak?.remainingAllowanceSeconds??0;
 if(view.submitted||allowance<60)return null;
 async function start():Promise<void>{
  setPending(true);setError("");
  try{
   if(onPrepare&&!await onPrepare()){setError("Wait until your current answer is Saved, then take the break.");return;}
   mutation.current??=crypto.randomUUID().replaceAll("-","");
   const result=await startApprovedAssessmentBreakAction({attemptId:view.attemptId,durationSeconds:minutes*60,mutationKey:mutation.current});
   if(!result.ok){setError(result.message);return;}
   router.refresh();
  }catch{setError("The break could not start. Reload the assessment and try again.");}
  finally{setPending(false);}
 }
 return <section className="content-stack" aria-label="Approved assessment breaks">
  <p>Approved break time remaining: {Math.floor(allowance/60)} {Math.floor(allowance/60) === 1 ? "minute" : "minutes"}. Questions and editing are unavailable during the fixed break.</p>
  <label>Break length in minutes<input type="number" min={1} max={Math.floor(allowance/60)} value={minutes} disabled={pending} onChange={event=>{setMinutes(Number(event.target.value));mutation.current=null;}} /></label>
  <Button type="button" variant="secondary" disabled={pending||!Number.isSafeInteger(minutes)||minutes<1||minutes*60>allowance} onClick={()=>void start()}>{pending?"Starting break…":"Take approved break"}</Button>
  {error?<p role="alert">{error}</p>:null}
 </section>;
}
export function ApprovedBreakRest({view}:{view:AssessmentAttemptClientView}):React.JSX.Element {
 const router=useRouter(),[exitPending,setExitPending]=useState(false),[error,setError]=useState("");
 const rest=view.accommodationBreak!;
 async function exit():Promise<void>{
  setExitPending(true);setError("");
  try{
   const result=await interruptAssessmentAction(view.attemptId,"emergency_exit");
   if(result.ok){router.push("/worker/available-assessments");return;}
   setError(result.message);
  }catch{setError("The emergency exit could not be recorded. Check your connection and try again.");}
  setExitPending(false);
 }
 return <section className="page-stack" aria-labelledby="approved-break-heading">
  <h1 id="approved-break-heading">Approved break</h1>
  <p>Assessment work time is paused. Questions, review and answer editing resume after this fixed break.</p>
  <ApprovedBreakCountdown key={`${rest.endsAt}:${rest.remainingSeconds}`} remainingSeconds={rest.remainingSeconds} />
  <p>Break ends at: <time data-testid="approved-break-end" dateTime={rest.endsAt??undefined}>{rest.endsAt}</time></p>
  <p>Break time left after this break: {Math.floor(rest.remainingAllowanceSeconds/60)} {Math.floor(rest.remainingAllowanceSeconds/60) === 1 ? "minute" : "minutes"}.</p>
  <div className="button-row">
   <Button type="button" variant="secondary" onClick={()=>router.refresh()}>Check break status</Button>
   <Button type="button" variant="danger" disabled={exitPending} onClick={()=>void exit()}>Emergency exit</Button>
  </div>
  {error?<p role="alert">{error}</p>:null}
 </section>;
}

function ApprovedBreakCountdown({remainingSeconds}:{remainingSeconds:number}):React.JSX.Element {
 const router=useRouter(),[elapsed,setElapsed]=useState(0);
 useEffect(()=>{
  const started=performance.now();
  const timer=setInterval(()=>{
   const passed=Math.floor((performance.now()-started)/1000);setElapsed(passed);
   if(passed>=remainingSeconds)router.refresh();
  },1000);
  return()=>clearInterval(timer);
 },[remainingSeconds,router]);
 const remaining=Math.max(0,remainingSeconds-elapsed);
 return <p role="timer" aria-label="Approved break time remaining">{Math.floor(remaining/60)}:{String(remaining%60).padStart(2,"0")} remaining</p>;
}
