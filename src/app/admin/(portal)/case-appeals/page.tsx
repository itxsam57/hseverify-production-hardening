import Link from "next/link";
import {requirePlatformPermission} from "@/lib/authorization/authorization-service";
import {CaseAppealService,CaseAppealAccessError} from "@/lib/assurance/case-appeal-service";
import {reviewCaseAppealAction,requestCaseAppealEvidenceAction,requestCaseAppealInterviewAction} from "./actions";
import {CaseAppealEvidenceFollowupService} from "@/lib/assurance/case-appeal-evidence-followup-service";
export const dynamic="force-dynamic";
export default async function AdminCaseAppealsPage({searchParams}:{searchParams:Promise<{status?:string;error?:string}>}):Promise<React.JSX.Element>{
 const actor=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
 const params=await searchParams,service=new CaseAppealService(),appeals=await service.listForAdmin(actor);
 const followup=new CaseAppealEvidenceFollowupService(),requests=new Map(await Promise.all(appeals.map(async a=>[a.appealId,await followup.list(actor,a.appealId)] as const)));
 const interviews=new Map(await Promise.all(appeals.map(async a=>[a.appealId,await followup.listInterviews(actor,a.appealId)] as const)));
 const hasPending=(appealId:string)=>(requests.get(appealId)??[]).some(req=>!req.responded)||
   (interviews.get(appealId)??[]).some(req=>!req.recommendation);
 const evidence=new Map(await Promise.all(appeals.map(async appeal=>{
   try{return [appeal.appealId,await service.listEvidence(actor,appeal.appealId)] as const;}
   catch(error){if(error instanceof CaseAppealAccessError)return [appeal.appealId,null] as const;throw error;}
 })));
 return <section className="page-stack">
  <header className="page-heading"><div><p className="eyebrow">Admin</p><h1>Assurance Case appeals</h1>
   <p>Review rejected unissued cases independently of the original decision maker. Case history and reasons are retained. <Link href="/admin/appeals">Issued credential appeals</Link> are separate.</p></div></header>
  {params.status==="updated"?<p role="status" className="status-banner status-success">Independent appeal review recorded.</p>:null}
  {params.status==="evidence-requested"?<p role="status" className="status-banner status-success">Additional evidence requested from Worker.</p>:null}
  {params.status==="interview-requested"?<p role="status" className="status-banner status-success">Independent appeal interview requested and sent to Assessor matching.</p>:null}
  {params.error?<p role="alert" className="status-banner status-error">{params.error==="mfa"?"Sign in again with MFA before reviewing an appeal.":params.error==="independence"?"This appeal requires a different authorized reviewer from the original decision maker.":params.error==="conflict"?"Appeal version changed or the review reason is invalid.":"Invalid review status."}</p>:null}
  <section className="content-stack"><h2>Submitted case appeals</h2>
   {appeals.length===0?<p>No Assurance Case appeals yet.</p>:appeals.map(a=><article className="panel content-stack" key={a.appealId} id={a.appealId}>
    <h3>{a.caseId}</h3><p>Worker: {a.workerAccountId}</p><p>Status: {a.status.replaceAll("_"," ")} · Version {a.version}</p>
    <p>Grounds: {a.grounds}</p><p>Original decision: {a.decisionId}</p>
    <div aria-label={"Supporting evidence "+a.appealId}><h4>Frozen supporting evidence</h4>
      {evidence.get(a.appealId)===null?<p>Evidence restricted: original decision maker cannot inspect independent appeal files.</p>:
       (evidence.get(a.appealId)?.length??0)===0?<p>No supporting files selected.</p>:
       evidence.get(a.appealId)?.map(file=><p key={file.fileId}>
        <a href={"/admin/case-appeals/"+encodeURIComponent(a.appealId)+"/files/"+encodeURIComponent(file.fileId)} target="_blank" rel="noopener noreferrer">
         Open retained supporting file {file.recordId}
        </a> · Version {file.versionId} · {file.byteSize} bytes
       </p>)}
    </div>
    {a.reviewReason?<p>Review outcome: {a.reviewReason}</p>:null}
    <div className="content-stack" aria-label={"Additional evidence requests "+a.appealId}>
      {(requests.get(a.appealId)??[]).map(req=><section className="panel content-stack" key={req.requestId}>
        <h4>Additional scanned evidence requested</h4><p>{req.reason}</p>
        <p>{req.responded?"Worker response received":"Worker response required"}</p>
        {req.responseReason?<p>Response: {req.responseReason}</p>:null}
      </section>)}
    </div>
    <div className="content-stack" aria-label={"Appeal interview requests "+a.appealId}>
     {(interviews.get(a.appealId)??[]).map(interview=><section key={interview.interviewRequestId} className="panel content-stack">
      <h4>Independent appeal interview</h4><p>{interview.reason}</p>
      <p>Status: {interview.status} · {interview.recommendation?"Assessor recommendation: "+interview.recommendation:
       interview.assessorId?"Assigned to Assessor":"Assessor assignment pending"}</p>
     </section>)}
    </div>
    {(a.status==="submitted"||a.status==="under_review")&&!hasPending(a.appealId)?
    <form action={requestCaseAppealInterviewAction} className="form-grid" aria-label={"Request independent appeal interview "+a.appealId}>
      <input type="hidden" name="appealId" value={a.appealId}/>
      <input type="hidden" name="expectedVersion" value={a.version}/>
      <label>Interview request reason<textarea name="reason" minLength={10} maxLength={4000} rows={3} required/></label>
      <button type="submit">Request independent interview</button>
    </form>:null}
    {(a.status==="submitted"||a.status==="under_review")&&!hasPending(a.appealId)?
    <form action={requestCaseAppealEvidenceAction} className="form-grid" aria-label={"Request additional case evidence "+a.appealId}>
      <input type="hidden" name="appealId" value={a.appealId}/>
      <input type="hidden" name="expectedVersion" value={a.version}/>
      <label>Additional evidence request reason
        <textarea name="reason" minLength={10} maxLength={4000} required rows={3}/>
      </label><button type="submit">Request additional evidence</button>
    </form>:null}
    {(a.status==="submitted"||a.status==="under_review")&&!hasPending(a.appealId)?
    <form action={reviewCaseAppealAction} className="form-grid" aria-label={"Review case appeal "+a.appealId}>
     <input type="hidden" name="appealId" value={a.appealId}/><input type="hidden" name="expectedVersion" value={a.version}/>
     <label>Review outcome<select name="status" defaultValue={a.status==="submitted"?"under_review":"accepted"}>
       <option value="under_review">Under review</option><option value="accepted">Accepted for reassessment</option><option value="rejected">Appeal rejected</option>
     </select></label>
     <label>Independent review reason<textarea name="reason" minLength={10} maxLength={4000} rows={4} required/></label>
     <button type="submit">Record case appeal review</button>
    </form>:a.status==="under_review"&&hasPending(a.appealId)?
     <p role="status">Awaiting requested Worker evidence or Assessor interview recommendation before final appeal review.</p>:null}
   </article>)}
  </section>
 </section>;
}
