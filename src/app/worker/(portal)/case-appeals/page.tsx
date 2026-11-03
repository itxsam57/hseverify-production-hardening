import {getDatabaseClient} from "@/lib/database/database";
import {WorkerEvidenceService} from "@/lib/worker-evidence/worker-evidence-service";
import Link from "next/link";
import {requirePortalAuthorization} from "@/lib/authorization/authorization-service";
import {CaseAppealService} from "@/lib/assurance/case-appeal-service";
import {findWorkerAssuranceCase} from "@/lib/assurance-orders/worker-assurance-case-service";
import {submitCaseAppealAction,respondCaseAppealEvidenceAction} from "./actions";
import {CaseAppealEvidenceFollowupService} from "@/lib/assurance/case-appeal-evidence-followup-service";
export const dynamic="force-dynamic";
export default async function WorkerCaseAppealsPage({searchParams}:{searchParams:Promise<{caseId?:string;status?:string;error?:string}>}):Promise<React.JSX.Element>{
 const principal=await requirePortalAuthorization("worker"),params=await searchParams;
 const cases=new CaseAppealService(),history=await cases.listForWorker(principal);
 const evidence=await new WorkerEvidenceService(getDatabaseClient()).listCurrent(principal);
 const supporting=evidence.filter(item=>item.lifecycleStatus!=="inactive"&&item.currentVersion.status==="submitted");
 const snapshots=new Map(await Promise.all(history.map(async a=>[a.appealId,await cases.listEvidence(principal,a.appealId)] as const)));
 const followups=new CaseAppealEvidenceFollowupService(),requests=new Map(await Promise.all(history.map(async a=>[a.appealId,await followups.list(principal,a.appealId)] as const)));
 const interviews=new Map(await Promise.all(history.map(async a=>[a.appealId,await followups.listInterviews(principal,a.appealId)] as const)));
 const caseId=typeof params.caseId==="string"?params.caseId.trim():"";
 const record=caseId?await findWorkerAssuranceCase(principal,caseId):null;
 const eligible=record?.status==="Rejected"&&!record.credentialReference;
 return <section className="page-stack">
  <header className="page-heading"><div><p className="eyebrow">Worker</p><h1>Assurance Case appeals</h1>
   <p>Request an independent review of a rejected case without an issued credential. The original decision remains preserved. This is separate from <Link href="/worker/appeals">credential appeals</Link>.</p></div></header>
  {params.status==="submitted"?<p role="status" className="status-banner status-success">Case appeal submitted for independent Admin review.</p>:null}
  {params.status==="evidence-submitted"?<p role="status" className="status-banner status-success">Additional scanned evidence submitted for independent review.</p>:null}
  {params.error?<p role="alert" className="status-banner status-error">{params.error==="conflict"?"An appeal is already open or the appeal grounds are invalid.": "The rejected case is unavailable or not yours."}</p>:null}
  <section className="panel content-stack"><h2>Request independent review</h2>
   {eligible?<form action={submitCaseAppealAction} className="form-grid">
    <p>Rejected case: <code>{record.caseId}</code></p><input type="hidden" name="caseId" value={record.caseId}/>
    <label>Appeal grounds<textarea name="grounds" required minLength={10} maxLength={4000} rows={5} placeholder="Explain what should be reconsidered and why."/></label>
    <fieldset><legend>Supporting evidence from existing submitted Worker records (optional)</legend>
     {supporting.length===0?<p>No submitted Worker evidence records are available. You can submit grounds without files.</p>:supporting.map(item=><label key={item.recordId}>
      <input type="checkbox" name="evidenceRecordIds" value={item.recordId}/>
      {item.kind.replaceAll("_"," ")} · {item.recordId}
     </label>)}
     <p>Only your submitted, available scanned files can be attached. The selected version and file hashes are retained for independent review.</p>
    </fieldset>
    <button type="submit">Submit case appeal</button>
   </form>:<p>Select a rejected case without an issued credential from your assurance history to open its appeal form.</p>}
  </section>
  <section className="content-stack"><h2>Case appeal history</h2>
   {history.length===0?<p>No case appeals yet.</p>:history.map(a=><article className="panel content-stack" key={a.appealId} id={a.appealId}>
    <h3><Link href={"/worker/assurance-cases/"+a.caseId}>{a.caseId}</Link></h3>
    <p>Status: {a.status.replaceAll("_"," ")} · Version {a.version}</p>
    <p>Grounds: {a.grounds}</p>
    <p>Supporting scanned files: {snapshots.get(a.appealId)?.length??0}</p>
    {(interviews.get(a.appealId)??[]).map(interview=><section className="content-stack" key={interview.interviewRequestId}>
     <h4>Independent appeal interview requested</h4><p>{interview.reason}</p>
     {interview.recommendation?<p>Assessor recommendation: {interview.recommendation}</p>:interview.assessorId?
      <Link href={"/worker/interviews/"+encodeURIComponent(interview.interviewRequestId)}>Open independent appeal interview</Link>:
      <p>Waiting for an eligible Assessor assignment.</p>}
    </section>)}
    {(requests.get(a.appealId)??[]).map(req=><section key={req.requestId} className="content-stack">
      <h4>Additional evidence requested</h4><p>{req.reason}</p>
      <p>{req.responded?"Response received":"Response required"}</p>
      {req.responseReason?<p>Response: {req.responseReason}</p>:null}
      {!req.responded&&a.status==="under_review"?<form action={respondCaseAppealEvidenceAction} className="form-grid"
       aria-label={"Respond to additional evidence "+req.requestId}>
        <input type="hidden" name="appealId" value={a.appealId}/>
        <input type="hidden" name="requestId" value={req.requestId}/>
        <input type="hidden" name="expectedVersion" value={a.version}/>
        <label>Evidence response explanation<textarea name="reason" minLength={10} maxLength={4000} rows={4} required/></label>
        <fieldset><legend>Additional submitted scanned evidence (required)</legend>
          {supporting.length===0?<p>No submitted evidence is ready. Submit and scan your evidence in the Worker Evidence section first.</p>:
           supporting.filter(item=>!(snapshots.get(a.appealId)??[]).some(file=>file.recordId===item.recordId)).map(item=><label key={item.recordId}>
             <input type="checkbox" name="evidenceRecordIds" value={item.recordId}/>
             {item.kind.replaceAll("_"," ")} · {item.recordId}
           </label>)}
        </fieldset>
        <button type="submit">Submit additional evidence response</button>
      </form>:null}
    </section>)}
    {a.reviewReason?<p>Independent review outcome: {a.reviewReason}</p>:null}
    {a.status==="accepted"?<>
      <p>Appeal accepted. A new reassessment is required under current eligibility and funding policy. The rejected case remains preserved.</p>
      <Link className="button button-primary" href={"/worker/assessment-applications?sourceCaseAppealId="+encodeURIComponent(a.appealId)}>Continue linked reassessment</Link>
     </>:null}
   </article>)}
  </section>
 </section>;
}
