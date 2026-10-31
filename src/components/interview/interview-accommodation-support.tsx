"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { InterviewSupportKind, InterviewSupportView } from "@/lib/privacy/interview-accommodation-support";
export function InterviewAccommodationSupport({interviewRequestId,role}:{interviewRequestId:string;role:"worker"|"assessor"}): React.JSX.Element | null {
 const supportTypeId = useId();
 const [view,setView] = useState<InterviewSupportView|null>(null);
 const [loadError,setLoadError] = useState("");
 const [publishError,setPublishError] = useState("");
 const [kind,setKind] = useState<InterviewSupportKind>("CAPTION");
 const [sourceText,setSourceText] = useState("");
 const [translatedText,setTranslatedText] = useState("");
 const [pending,setPending] = useState(false);
 const mutationKey = useRef<string|null>(null);
 const endpoint = "/api/interviews/"+encodeURIComponent(interviewRequestId)+"/accommodation-support";
 useEffect(() => {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | null = null;
  async function poll(): Promise<void> {
   try {
    const response = await fetch(endpoint,{cache:"no-store",signal:controller.signal});
    const body = await response.json() as InterviewSupportView & {error?:string};
    if (!response.ok) throw new Error(body.error ?? "Human support is unavailable.");
    if (!controller.signal.aborted) {
     setView(body);setLoadError("");
     setKind(current => body.channels.includes(current) ? current : body.channels[0] ?? "CAPTION");
    }
   } catch(error) {
    if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Human support is unavailable.");
   }
   if (!controller.signal.aborted) timer = setTimeout(() => void poll(),2000);
  }
  void poll();
  return () => { controller.abort(); if (timer) clearTimeout(timer); };
 },[endpoint]);
 async function publish(event: FormEvent<HTMLFormElement>): Promise<void> {
  event.preventDefault();setPending(true);setPublishError("");
  mutationKey.current ??= crypto.randomUUID().replaceAll("-","");
  try {
   const response = await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",
    body:JSON.stringify({kind,sourceText,...(kind === "INTERPRETATION" ? {translatedText} : {}),mutationKey:mutationKey.current})});
   const result = await response.json() as {error?:string};
   if (!response.ok) throw new Error(result.error ?? "Human support could not be published.");
   mutationKey.current = null;setSourceText("");setTranslatedText("");
   const updated = await fetch(endpoint,{cache:"no-store"});
   if (updated.ok) setView(await updated.json() as InterviewSupportView);
  } catch(error) { setPublishError(error instanceof Error ? error.message : "Human support could not be published."); }
  finally { setPending(false); }
 }
 if (view && !view.approved) return null;
 return <section className="panel content-stack" aria-label="Approved human interview support">
  <h3>Human captions and interpretation</h3>
  <p>Typed by the assigned Assessor. This panel does not generate captions or translations automatically.</p>
  {loadError ? <p role="alert" className="form-error">{loadError}</p> : null}
  {!view && !loadError ? <p role="status">Checking approved interview support…</p> : null}
  {view?.blockedReason ? <p role="status">{view.blockedReason}</p> : null}
  {view ? <p>Interview language: {view.sourceLanguage}{view.targetLanguage ? " · Worker language: "+view.targetLanguage : ""}</p> : null}
  {view && role === "assessor" && view.canPublish ? <form onSubmit={event => void publish(event)} className="content-stack">
   <label htmlFor={supportTypeId}>Support type</label><select id={supportTypeId} value={kind} disabled={pending} onChange={event => {setKind(event.target.value as InterviewSupportKind);mutationKey.current=null;}}>
    {view.channels.map(channel => <option key={channel} value={channel}>{channel === "CAPTION" ? "Human caption" : "Human interpretation"}</option>)}
   </select>
   <label>Spoken text ({view.sourceLanguage})<textarea required minLength={2} maxLength={2000} rows={3} value={sourceText} disabled={pending} onChange={event => {setSourceText(event.target.value);mutationKey.current=null;}} /></label>
   {kind === "INTERPRETATION" ? <label>Interpretation ({view.targetLanguage})<textarea required minLength={2} maxLength={2000} rows={3} value={translatedText} disabled={pending} onChange={event => {setTranslatedText(event.target.value);mutationKey.current=null;}} /></label> : null}
   <button type="submit" className="button button-primary" disabled={pending}>{pending ? "Publishing…" : "Publish human support"}</button>
  </form> : null}
  {publishError ? <p role="alert" className="form-error">{publishError}</p> : null}
  <ol aria-label="Human support messages">
   {(view?.messages ?? []).map(item => <li key={item.messageId} className="content-stack">
    <strong>{item.kind === "CAPTION" ? "Human caption" : "Human interpretation"}</strong>
    <p style={{whiteSpace:"pre-wrap"}}>{item.sourceText}</p>
    {item.translatedText ? <p style={{whiteSpace:"pre-wrap"}}>{item.translatedText}</p> : null}
   </li>)}
  </ol>
 </section>;
}
