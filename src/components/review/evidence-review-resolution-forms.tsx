import {resolveEvidenceReviewAction} from "@/app/verifier/(portal)/reviews/actions";
export function EvidenceReviewResolutionForms({taskId,expectedRevision}:{taskId:string;expectedRevision:number}):React.JSX.Element{
 return <section className="page-stack" aria-label="Other review outcomes">
 <form action={resolveEvidenceReviewAction} className="panel content-stack">
 <h2>Unable to verify</h2><p>Record what you checked and why the evidence remains unverified.</p>
 <input type="hidden" name="taskId" value={taskId}/><input type="hidden" name="resolutionRevision" value={expectedRevision}/><input type="hidden" name="resolution" value="UNABLE_TO_VERIFY"/>
 <label htmlFor="unable-reason">Unable to verify reason</label><textarea id="unable-reason" name="resolutionReason" minLength={5} maxLength={4000} required/>
 <label htmlFor="attempted-methods">Attempted verification methods</label><textarea id="attempted-methods" name="attemptedMethods" minLength={5} maxLength={4000} required/>
 <label htmlFor="verification-limitations">Verification limitations</label><textarea id="verification-limitations" name="limitations" minLength={5} maxLength={4000} required/>
 <button type="submit">Record unable to verify</button>
 </form>
 <form action={resolveEvidenceReviewAction} className="panel content-stack">
 <h2>Escalate review</h2><input type="hidden" name="taskId" value={taskId}/><input type="hidden" name="resolutionRevision" value={expectedRevision}/><input type="hidden" name="resolution" value="ESCALATED"/>
 <label htmlFor="escalation-reason">Escalation reason</label><textarea id="escalation-reason" name="resolutionReason" minLength={5} maxLength={4000} required/>
 <label htmlFor="escalation-destination">Escalation destination</label><select id="escalation-destination" name="destination"><option value="admin">Admin review</option></select>
 <button type="submit">Escalate review</button>
 </form></section>;
}
