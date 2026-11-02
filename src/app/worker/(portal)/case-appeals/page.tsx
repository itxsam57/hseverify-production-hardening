import Link from "next/link";
import {requirePortalAuthorization} from "@/lib/authorization/authorization-service";
import {CaseAppealService} from "@/lib/assurance/case-appeal-service";
import {findWorkerAssuranceCase} from "@/lib/assurance-orders/worker-assurance-case-service";
import {submitCaseAppealAction} from "./actions";
export const dynamic="force-dynamic";
export default async function WorkerCaseAppealsPage({searchParams}:{searchParams:Promise<{caseId?:string;status?:string;error?:string}>}):Promise<React.JSX.Element>{
 const principal=await requirePortalAuthorization("worker"),params=await searchParams;
 const cases=new CaseAppealService(),history=await cases.listForWorker(principal);
 const caseId=typeof params.caseId==="string"?params.caseId.trim():"";
 const record=caseId?await findWorkerAssuranceCase(principal,caseId):null;
 const eligible=record?.status==="Rejected"&&!record.credentialReference;
 return <section className="page-stack">
  <header className="page-heading"><div><p className="eyebrow">Worker</p><h1>Assurance Case appeals</h1>
   <p>Request an independent review of a rejected case without an issued credential. The original decision remains preserved. This is separate from <Link href="/worker/appeals">credential appeals</Link>.</p></div></header>
  {params.status==="submitted"?<p role="status" className="status-banner status-success">Case appeal submitted for independent Admin review.</p>:null}
  {params.error?<p role="alert" className="status-banner status-error">{params.error==="conflict"?"An appeal is already open or the appeal grounds are invalid.": "The rejected case is unavailable or not yours."}</p>:null}
  <section className="panel content-stack"><h2>Request independent review</h2>
   {eligible?<form action={submitCaseAppealAction} className="form-grid">
    <p>Rejected case: <code>{record.caseId}</code></p><input type="hidden" name="caseId" value={record.caseId}/>
    <label>Appeal grounds<textarea name="grounds" required minLength={10} maxLength={4000} rows={5} placeholder="Explain what should be reconsidered and why."/></label>
    <button type="submit">Submit case appeal</button>
   </form>:<p>Select a rejected case without an issued credential from your assurance history to open its appeal form.</p>}
  </section>
  <section className="content-stack"><h2>Case appeal history</h2>
   {history.length===0?<p>No case appeals yet.</p>:history.map(a=><article className="panel content-stack" key={a.appealId} id={a.appealId}>
    <h3><Link href={"/worker/assurance-cases/"+a.caseId}>{a.caseId}</Link></h3>
    <p>Status: {a.status.replaceAll("_"," ")} · Version {a.version}</p>
    <p>Grounds: {a.grounds}</p>
    {a.reviewReason?<p>Independent review outcome: {a.reviewReason}</p>:null}
    {a.status==="accepted"?<>
      <p>Appeal accepted. A new reassessment is required under current eligibility and funding policy. The rejected case remains preserved.</p>
      <Link className="button button-primary" href={"/worker/assessment-applications?sourceCaseAppealId="+encodeURIComponent(a.appealId)}>Continue linked reassessment</Link>
     </>:null}
   </article>)}
  </section>
 </section>;
}
