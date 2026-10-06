"use client";
import { useActionState, useState, useSyncExternalStore } from "react";
import { submitPublicInquiryAction } from "@/app/contact/inquiry-actions";
export type InquiryActionState = {status:"idle"|"success"|"error";message:string;reference:string|null};
function subscribeToReadiness():()=>void{return ()=>{};}
export function PublicInquiryForm({kind,submissionNonce}:{kind:"contact"|"demo";submissionNonce:string}):React.JSX.Element {
 const ready=useSyncExternalStore(subscribeToReadiness,()=>true,()=>false);
 const [draft,setDraft]=useState({name:"",email:"",company:"",message:""});
 const field=(name:keyof typeof draft)=>({disabled:!ready,value:draft[name],onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>setDraft(previous=>({...previous,[name]:event.target.value}))});
 const [state,action,pending]=useActionState(submitPublicInquiryAction,{status:"idle",message:"",reference:null} as InquiryActionState);
 return <form action={action} className="public-verification-form">
  <input type="hidden" name="kind" value={kind}/><input type="hidden" name="submissionNonce" value={submissionNonce}/>
  <div hidden aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off"/></label></div>
  <div className="field-stack"><label htmlFor="inquiry-name">Your name</label><input id="inquiry-name" name="name" {...field("name")} autoComplete="name" minLength={2} maxLength={120} required/></div>
  <div className="field-stack"><label htmlFor="inquiry-email">Email address</label><input id="inquiry-email" name="email" {...field("email")} type="email" autoComplete="email" maxLength={254} required/></div>
  <div className="field-stack"><label htmlFor="inquiry-company">Company (optional)</label><input id="inquiry-company" name="company" {...field("company")} autoComplete="organization" maxLength={160}/></div>
  <div className="field-stack"><label htmlFor="inquiry-message">{kind==="demo"?"What would you like to see?":"How can we help?"}</label><textarea id="inquiry-message" name="message" {...field("message")} minLength={10} maxLength={4000} rows={6} required/></div>
  <p>We will record your request for staff follow-up. A demo is arranged only after staff contact you. Please avoid including sensitive Worker information.</p>
  <button type="submit" className="button button-primary" disabled={!ready||pending||state.status==="success"}>{pending?"Submitting…":kind==="demo"?"Request demo":"Send message"}</button>
  <div aria-live="polite">{state.message?<p>{state.message}</p>:null}{state.reference?<p><strong>Request reference:</strong> {state.reference}</p>:null}</div>
 </form>;
}
