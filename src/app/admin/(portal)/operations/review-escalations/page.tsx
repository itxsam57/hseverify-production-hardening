import Link from "next/link";
import {requirePlatformPermission} from "@/lib/authorization/authorization-service";
import {getEvidenceReviewService} from "@/lib/review/evidence-review-service";
import {returnEvidenceEscalationAction} from "./actions";
export default async function ReviewEscalations({searchParams}:{searchParams:Promise<{result?:string}>}):Promise<React.JSX.Element>{
 const principal=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
 const rows=await(await getEvidenceReviewService()).listEscalations(principal);const {result}=await searchParams;
 return <section className="page-stack"><h1>Evidence review escalations</h1><Link href="/admin/operations">Back to operations</Link>
 {result==="returned"?<p role="status">Escalation reviewed and returned to the Verifier queue.</p>:null}
 {result==="conflict"?<p role="alert">This escalation changed. Review the latest queue before trying again.</p>:null}
 {result==="invalid"?<p role="alert">Provide a valid reason before returning the escalation.</p>:null}
 {rows.length===0?<p>No evidence review escalations.</p>:rows.map(row=><article className="panel content-stack" key={row.taskId} aria-label={"Escalation "+row.taskId}>
 <h2>{row.evidenceLabel}</h2><dl className="detail-grid"><div><dt>Worker</dt><dd>{row.workerAccountId}</dd></div><div><dt>Source version</dt><dd>{row.sourceVersionId}</dd></div><div><dt>Reason for escalation</dt><dd>{row.reason}</dd></div></dl>
 <form action={returnEvidenceEscalationAction}><input type="hidden" name="taskId" value={row.taskId}/><input type="hidden" name="revision" value={row.revision}/>
 <label htmlFor={"return-"+row.taskId}>Review and return reason</label><textarea id={"return-"+row.taskId} name="reason" minLength={5} maxLength={4000} required/>
 <button type="submit">Return to Verifier queue</button></form></article>)}</section>;
}
