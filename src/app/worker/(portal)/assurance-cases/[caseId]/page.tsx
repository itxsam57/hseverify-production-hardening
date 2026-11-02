import Link from "next/link";
import {notFound} from "next/navigation";
import {requirePortalAuthorization} from "@/lib/authorization/authorization-service";
import {findWorkerAssuranceCase} from "@/lib/assurance-orders/worker-assurance-case-service";
import {formatDateTime} from "@/lib/format";

export const dynamic="force-dynamic";
export default async function WorkerAssuranceCasePage({params}:{params:Promise<{caseId:string}>}):Promise<React.JSX.Element>{
 const principal=await requirePortalAuthorization("worker"),{caseId}=await params;
 const record=await findWorkerAssuranceCase(principal,caseId);
 if(!record)notFound();
 return <section className="page-stack">
  <header className="page-heading"><div><p className="eyebrow">Worker assurance</p><h1>Assurance case</h1></div></header>
  <article className="panel content-stack" id={record.caseId}>
   <p>Case: {record.caseId}</p>
   <p><strong>Status:</strong> {record.status}</p>
   {record.nextAction?<p><strong>Next action:</strong> {record.nextAction}</p>:null}
   <p>Updated {formatDateTime(record.updatedAt)}</p>
   {record.credentialReference?<Link className="button button-primary" href={"/worker/passport#"+encodeURIComponent(record.credentialReference)}>Open issued credential</Link>:null}
   {record.status==="Evidence pending"?<Link className="button button-primary" href="/worker/evidence">Add or correct requested evidence</Link>:null}
   {record.status==="Reassessment required"?<>
    <p>Reassessment requires a new eligible assessment application. Current policy, attempt limits, waiting periods and funding rules still apply; the original case stays in your history.</p>
    <Link className="button button-primary" href="/worker/assessment-applications">Check reassessment eligibility</Link>
   </>:null}
   {record.status==="Rejected"?<>
    <p>This decision closed the case. You may request an independent review. The original rejected decision stays preserved during review; reassessment still requires separate approval and policy checks.</p>
    <Link className="button button-primary" href={"/worker/case-appeals?caseId="+encodeURIComponent(record.caseId)}>Appeal this rejected case</Link>
    <Link className="button button-secondary" href="/contact">Contact support about this case</Link>
    <Link className="button button-secondary" href="/worker/assessment-applications">Check new assessment eligibility</Link>
   </>:null}
   <Link className="button button-secondary" href="/worker/available-assessments">Available assessments</Link>
  </article>
 </section>;
}
