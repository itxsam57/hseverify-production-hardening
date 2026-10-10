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
   <p><strong>Next action:</strong> {record.nextAction}</p>
   <p>Updated {formatDateTime(record.updatedAt)}</p>
   {record.credentialReference?<Link className="button button-primary" href={"/worker/passport#"+encodeURIComponent(record.credentialReference)}>Open issued credential</Link>:null}
   <Link className="button button-secondary" href="/worker/available-assessments">Available assessments</Link>
  </article>
 </section>;
}
