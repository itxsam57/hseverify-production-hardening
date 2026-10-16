import Link from "next/link";
import {IntegrityReviewForm} from "@/components/review/integrity-review-form";
import {requirePlatformPermission} from "@/lib/authorization/authorization-service";
import {getDatabaseClient} from "@/lib/database/database";
import {IntegrityReviewService} from "@/lib/integrity/integrity-review-service";
import {returnIntegrityEscalationAction} from "./actions";
export default async function IntegrityEscalations({searchParams}:{searchParams:Promise<{result?:string}>}){
 const principal=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
 const rows=await new IntegrityReviewService(await getDatabaseClient()).listEscalations(principal),{result}=await searchParams;
 return <section className="page-stack"><h1>Integrity review escalations</h1><Link href="/admin/operations">Back to operations</Link>
 <p>Review retained signals and the Verifier reason. Returning a case preserves the concern and requires a new calibrated review; it does not clear integrity or issue a credential. Sign in with MFA within five minutes before returning it.</p>
 {result==="returned"?<p role="status">Integrity escalation returned for independent review.</p>:null}
 {result==="invalid"?<p role="alert">Provide a valid reason and current history reference.</p>:null}
 {rows.length===0?<p>No integrity review escalations.</p>:rows.map(row=><article key={row.review_id} id={row.review_id} className="panel content-stack" aria-label={"Integrity escalation "+row.review_id}>
 <h2>{row.worker_name}</h2><p>Case: {row.case_id}</p><p><strong>{row.disposition}</strong> — {row.reason}</p>
 <ul>{row.events.map((event,index)=><li key={index}>{event.at} — {event.type} — {event.classification} — {event.state} — Provider: {event.providerState??"Not supplied"}</li>)}</ul>
 <IntegrityReviewForm admin action={returnIntegrityEscalationAction} reviewId={row.review_id} revision={row.revision} eventCount={row.event_count}/></article>)}</section>;
}
