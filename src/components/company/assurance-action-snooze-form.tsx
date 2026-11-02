"use client";

import {useActionState,useEffect,useRef} from "react";
import {snoozeAssuranceAction,type AssuranceSnoozeActionState} from "@/app/company/(portal)/action-centre/actions";
import {captureFormSnapshot} from "@/components/ui/unsaved-changes-guard";
import {Button} from "@/components/ui/button";

const INITIAL_STATE:AssuranceSnoozeActionState={status:"idle",message:""};
export function AssuranceActionSnoozeForm({actionId}:{actionId:string}):React.JSX.Element{
  const [state,action,pending]=useActionState(snoozeAssuranceAction,INITIAL_STATE);
  const form=useRef<HTMLFormElement>(null);
  const submitted=useRef<string|null>(null);
  useEffect(()=>{
    if(state.status==="success"&&submitted.current!==null){
      form.current?.dispatchEvent(new CustomEvent("hse:form-saved",{bubbles:true,detail:submitted.current}));
    }
  },[state]);
  return <form ref={form} action={action} className="inline-form"
    onReset={event=>event.preventDefault()}
    onSubmit={event=>{submitted.current=captureFormSnapshot(event.currentTarget);}}>
    <input type="hidden" name="actionId" value={actionId}/>
    <label>Until<input type="datetime-local" name="until" required/></label>
    <label>Reason<input name="reason" minLength={3} maxLength={500} required/></label>
    <Button type="submit" disabled={pending}>{pending?"Snoozing…":"Snooze"}</Button>
    {state.message?<p role={state.status==="error"?"alert":"status"}>{state.message}</p>:null}
  </form>;
}
