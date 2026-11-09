import Link from "next/link";
import {ReviewQualityForm} from "@/components/review/review-quality-form";
import {requirePlatformPermission} from "@/lib/authorization/authorization-service";
import {getDatabaseClient} from "@/lib/database/database";
import {ReviewQualityService} from "@/lib/review/review-quality-service";
import {requireIndependentReviewAction,saveReviewerCapacityAction} from "./actions";

export default async function ReviewQualityPage(){
 const actor=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
 const data=await new ReviewQualityService(await getDatabaseClient()).list(actor);
 return <section className="page-stack">
  <h1>Review quality and workload</h1>
  <p>Require an independent second review for selected high-risk evidence. Published case policies may also require a second review or select a retained quality sample. A first review alone cannot verify a selected source.</p>
  <p><Link href="/admin/frameworks">Published policy</Link> · <Link href="/admin/operations/review-escalations">Resolve review disagreements</Link> · <Link href="/admin/operations/scoring-assignments">Assessment review assignments</Link> · <Link href="/admin/operations">Operations</Link></p>
  <h2>Evidence review controls</h2>
  {data.tasks.length===0?<p>No open evidence reviews.</p>:data.tasks.map(task=><article key={task.task_id} id={task.task_id} className="surface-card">
   <h3>{task.evidence_kind.replaceAll("_"," ")} review</h3><p>Task: <code>{task.task_id}</code></p><p>Case: {task.case_id??"Independent Worker evidence"}</p><p>Status: {task.task_status}</p>
   {task.selected?<p>Independent second review required.</p>:task.task_status==="QUEUED"?<ReviewQualityForm action={requireIndependentReviewAction} mode="selection" reference={task.task_id}/>:<p>The current first review is assigned. Select quality review when it returns unclaimed or use the pinned published policy.</p>}
   {task.rounds.length?<ol aria-label="Retained independent review rounds">{task.rounds.map(round=><li key={round.round_no}>Round {round.round_no}: {round.outcome} · {round.verifier_account_id} — {round.reason}</li>)}</ol>:null}
  </article>)}
  <h2>Reviewer workload limits</h2>
  <p>The explicit default is 25 open evidence and scoring reviews combined. Lowering a limit preserves existing assignments and blocks new claims until capacity is available.</p>
  {data.reviewers.map(reviewer=><article key={reviewer.account_id} id={reviewer.account_id} className="surface-card">
   <h3>{reviewer.display_name}</h3><p>Open reviews: {reviewer.capacity?.open??"Unavailable"} / {reviewer.capacity?.limit??"Unavailable"}</p>
   {reviewer.capacity?<ReviewQualityForm action={saveReviewerCapacityAction} mode="capacity" reference={reviewer.account_id} revision={reviewer.capacity.revision} limit={reviewer.capacity.limit}/>:null}
  </article>)}
 </section>;
}
