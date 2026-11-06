import Link from "next/link";
import { notFound } from "next/navigation";
import { randomBytes } from "node:crypto";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getCredentialConcernReviewService } from "@/lib/credential-concerns/credential-concern-review-service";
import { formatDateTime } from "@/lib/format";
import { reviewCredentialConcern } from "../actions";

export default async function ConcernDetailPage({params,searchParams}:{params:Promise<{concernId:string}>;searchParams:Promise<{result?:string}>}):Promise<React.JSX.Element>{
 const principal=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
 const {concernId}=await params;
 if(!/^public_concern_[A-Za-z0-9_-]{24}$/.test(concernId))notFound();
 const concern=await(await getCredentialConcernReviewService()).get(principal,concernId);
 if(!concern)notFound();
 const result=(await searchParams).result;
 const latest=concern.reviews.at(-1);
 return <section className="page-stack credential-concern-detail">
 <Link href="/admin/credential-concerns">Back to credential concerns</Link>
 <h1>Credential concern review</h1><p>{concern.concernId}</p>
 {result?<p role="status">{result==="recorded"?"Concern review recorded.":result==="conflict"?"This concern changed. Reload and review the latest history before recording an amendment.":result==="invalid"?"Check the review fields; nothing was recorded.":"Concern review is unavailable."}</p>:null}
 <section className="card"><h2>Original intake</h2><p>{concern.category.replaceAll("_"," ")}</p><p>{concern.description}</p><p>Received {formatDateTime(concern.createdAt)}</p>
 <dl><dt>Reporter</dt><dd>{concern.contactName||"Name not supplied"}</dd><dt>Email</dt><dd>{concern.contactEmail||"Not supplied"}</dd><dt>Phone</dt><dd>{concern.contactPhone||"Not supplied"}</dd></dl>
 <h3>Subject binding</h3>{concern.subject?<><p>{concern.subject.kind}: {concern.subject.identifier}</p><p>Worker reference: {concern.subject.workerReference}</p></>:<p>Legacy intake — subject unlinked. No credential or Worker has been inferred from the original hash.</p>}
 </section>
 <section className="card"><h2>Private evidence</h2>{concern.evidence.length===0?<p>No evidence supplied.</p>:<ul>{concern.evidence.map(file=><li key={file.fileId}>
 {file.available?<a href={"/admin/credential-concerns/"+concernId+"/evidence/"+file.fileId}>Download scanned evidence: {file.filename}</a>:<span>{file.filename}: {file.status.replaceAll("_"," ")} — download unavailable</span>}
 </li>)}</ul>}</section>
 <section className="card"><h2>Retained review history</h2>{concern.reviews.length===0?<p>No review recorded.</p>:<ol>{concern.reviews.map(review=><li key={review.version}>
 <h3>Review {review.version}: {review.outcome.replaceAll("_"," ")}</h3><p>{formatDateTime(review.createdAt)} · {review.actorAccountId}</p>
 <p><strong>Reason:</strong> {review.reason}</p><p><strong>Methods:</strong> {review.methods}</p><p><strong>Limitations:</strong> {review.limitations}</p>
 </li>)}</ol>}</section>
 <section className="card"><h2>{latest?"Record an amendment":"Record review"}</h2>
 <p>State what was checked and what remains uncertain. This records a review only; credential status remains unchanged.</p>
 <form action={reviewCredentialConcern} className="form-stack">
 <input type="hidden" name="concernId" value={concernId}/><input type="hidden" name="expectedVersion" value={latest?.version??0}/>
 <input type="hidden" name="requestId" value={"concern_review_"+randomBytes(18).toString("base64url")}/>
 <label>Review outcome<select name="outcome" required defaultValue="follow_up_needed"><option value="follow_up_needed">Follow-up needed</option><option value="reviewed_no_further_action">Reviewed — no further action</option></select></label>
 <label>Reason<textarea name="reason" required minLength={10} maxLength={4000} rows={4}/></label>
 <label>Methods used<textarea name="methods" required minLength={10} maxLength={2000} rows={3}/></label>
 <label>Limitations<textarea name="limitations" required minLength={10} maxLength={2000} rows={3}/></label>
 <button className="button button-primary" type="submit">{latest?"Record amendment":"Record review"}</button>
 </form></section>
 </section>;
}
