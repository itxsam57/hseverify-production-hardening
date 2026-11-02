import Link from "next/link";
import {requirePlatformPermission} from "@/lib/authorization/authorization-service";
import {CaseAppealService} from "@/lib/assurance/case-appeal-service";
import {reviewCaseAppealAction} from "./actions";
export const dynamic="force-dynamic";
export default async function AdminCaseAppealsPage({searchParams}:{searchParams:Promise<{status?:string;error?:string}>}):Promise<React.JSX.Element>{
 const actor=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
 const params=await searchParams,appeals=await new CaseAppealService().listForAdmin(actor);
 return <section className="page-stack">
  <header className="page-heading"><div><p className="eyebrow">Admin</p><h1>Assurance Case appeals</h1>
   <p>Review rejected unissued cases independently of the original decision maker. Case history and reasons are retained. <Link href="/admin/appeals">Issued credential appeals</Link> are separate.</p></div></header>
  {params.status==="updated"?<p role="status" className="status-banner status-success">Independent appeal review recorded.</p>:null}
  {params.error?<p role="alert" className="status-banner status-error">{params.error==="mfa"?"Sign in again with MFA before reviewing an appeal.":params.error==="independence"?"This appeal requires a different authorized reviewer from the original decision maker.":params.error==="conflict"?"Appeal version changed or the review reason is invalid.":"Invalid review status."}</p>:null}
  <section className="content-stack"><h2>Submitted case appeals</h2>
   {appeals.length===0?<p>No Assurance Case appeals yet.</p>:appeals.map(a=><article className="panel content-stack" key={a.appealId} id={a.appealId}>
    <h3>{a.caseId}</h3><p>Worker: {a.workerAccountId}</p><p>Status: {a.status.replaceAll("_"," ")} · Version {a.version}</p>
    <p>Grounds: {a.grounds}</p><p>Original decision: {a.decisionId}</p>
    {a.reviewReason?<p>Review outcome: {a.reviewReason}</p>:null}
    {a.status==="submitted"||a.status==="under_review"?<form action={reviewCaseAppealAction} className="form-grid" aria-label={"Review case appeal "+a.appealId}>
     <input type="hidden" name="appealId" value={a.appealId}/><input type="hidden" name="expectedVersion" value={a.version}/>
     <label>Review outcome<select name="status" defaultValue={a.status==="submitted"?"under_review":"accepted"}>
       <option value="under_review">Under review</option><option value="accepted">Accepted for reassessment</option><option value="rejected">Appeal rejected</option>
     </select></label>
     <label>Independent review reason<textarea name="reason" minLength={10} maxLength={4000} rows={4} required/></label>
     <button type="submit">Record case appeal review</button>
    </form>:null}
   </article>)}
  </section>
 </section>;
}
