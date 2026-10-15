import {ScoringAssignmentForm} from "@/components/review/scoring-assignment-form";
import Link from "next/link";
import {requirePlatformPermission} from "@/lib/authorization/authorization-service";
import {getDatabaseClient} from "@/lib/database/database";
import {WrittenReviewAssignmentService} from "@/lib/scoring/written-review-assignment-service";
import {assignScoringReviewAction} from "./actions";

export default async function ScoringAssignmentsPage(){
 const actor=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
 const rows=await new WrittenReviewAssignmentService(await getDatabaseClient()).list(actor);
 return <section className="page-stack">
  <h1>Assessment review assignments</h1>
  <p>Assign an independent Verifier calibrated for the case’s exact framework revision. Reassignment preserves prior marks and the assignment audit; the new reviewer must score independently.</p>
  <p><Link href="/admin/calibrations">Staff calibration</Link> · <Link href="/admin/operations">Operations</Link></p>
  {rows.length===0?<p>No pending assessment reviews.</p>:rows.map(row=><article key={row.caseId} className="surface-card">
   <h2>{row.workerName}</h2><p>Case: <code>{row.caseId}</code></p>
   <p>{row.reviewerAccountId?"Assigned reviewer: "+row.reviewerAccountId:"Waiting for an eligible reviewer."}</p>
   <ScoringAssignmentForm action={assignScoringReviewAction} caseId={row.caseId} reviewId={row.reviewId} revision={row.revision} candidates={row.candidates.filter(candidate=>candidate.accountId!==row.reviewerAccountId)}/>
   {row.candidates.length===0?<p>No eligible Verifier. Resolve staffing or calibration first; the submitted answers remain retained.</p>:null}
  </article>)}
 </section>;
}
