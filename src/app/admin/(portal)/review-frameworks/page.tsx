import Link from "next/link";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { getEvidenceReviewFrameworkService } from "@/lib/review/evidence-review-framework-service";
import { bindReviewFrameworkAction, recordFrameworkRevisionAction } from "./actions";

export default async function ReviewFrameworksPage({searchParams}:{searchParams:Promise<{result?:string;error?:string}>}):Promise<React.JSX.Element>{
 const principal=await requirePortalAuthorization("admin"),params=await searchParams,service=getEvidenceReviewFrameworkService();
 const [frameworks,tasks]=await Promise.all([service.listFrameworks(principal),service.listTasks(principal)]);
 return <div className="dashboard-page">
  <header className="page-heading-row"><div><p className="eyebrow">Review quality</p><h1>Review framework applicability</h1><p className="page-intro">Resolve each queued task against an authoritative framework revision. A case with a pinned policy must keep its original framework. Unresolved tasks cannot be claimed or decided.</p></div></header>
  <p><Link href="/admin/calibrations">Staff calibration</Link> · <Link href="/admin/frameworks">Frameworks and policies</Link></p>
  {params.result==="bound"?<p role="status" className="status-banner status-success">Review framework binding recorded.</p>:null}
  {params.result==="revision"?<p role="status" className="status-banner status-success">Framework revision recorded. Earlier bindings and calibration are retained.</p>:null}
  {params.error?<p role="alert" className="status-banner status-error">{params.error}</p>:null}
  <section className="surface-card"><h2>Tasks needing applicability review</h2>
   {tasks.length===0?<p>No live review tasks.</p>:tasks.map(task=><section key={task.task_id} className="surface-card" aria-label={`Framework for ${task.task_id}`}>
    <h3>{task.evidence_kind.replaceAll("_"," ")}</h3><p><code>{task.task_id}</code> · {task.task_status} · {task.case_id?"Pinned case context":"Standalone Worker evidence"}</p>
    <p>{task.binding_id?`${task.framework_reference} · version ${task.version_no}`:"Framework unresolved"}</p>
    {task.task_status==="QUEUED"?<form action={bindReviewFrameworkAction} className="form-grid">
     <input type="hidden" name="taskId" value={task.task_id}/><input type="hidden" name="expectedBindingId" value={task.binding_id??""}/>
     <label>Review framework revision<select name="frameworkVersionId" required defaultValue={task.framework_version_id??""}><option value="" disabled>Select authoritative revision</option>{frameworks.map(item=><option key={item.frameworkVersionId} value={item.frameworkVersionId}>{item.frameworkReference} · version {item.versionNo} · {item.title}</option>)}</select></label>
     <label>Applicability reason<textarea name="reason" required minLength={5} maxLength={2000} rows={3}/></label><button type="submit" className="button button-primary">Bind review framework</button>
    </form>:<p>Assigned tasks retain their binding. Return the task to the queue before changing applicability.</p>}
   </section>)}
  </section>
  <section className="surface-card"><h2>Publish framework revision</h2><p>A revised standard needs its own calibration. Existing task bindings retain their original revision.</p>
   <form action={recordFrameworkRevisionAction} className="form-grid">
    <label>Framework<select name="frameworkId" required defaultValue=""><option value="" disabled>Select framework</option>{frameworks.filter((item,index,all)=>all.findIndex(other=>other.frameworkId===item.frameworkId)===index).map(item=><option key={item.frameworkId} value={item.frameworkId}>{item.frameworkReference}</option>)}</select></label>
    <label>Revision title<input name="title" required minLength={2} maxLength={200}/></label>
    <label>Effective from<input name="effectiveFrom" required type="datetime-local"/></label><button type="submit" className="button">Record framework revision</button>
   </form>
  </section>
 </div>;
}
