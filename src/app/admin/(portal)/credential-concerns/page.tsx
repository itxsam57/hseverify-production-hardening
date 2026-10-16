import Link from "next/link";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getCredentialConcernReviewService } from "@/lib/credential-concerns/credential-concern-review-service";
import { formatDateTime } from "@/lib/format";

export default async function ConcernQueue({searchParams}:{searchParams:Promise<{page?:string}>}):Promise<React.JSX.Element> {
 const principal=await requirePlatformPermission({expectedRole:"admin",permission:"platform.operations.manage"});
 const raw=(await searchParams).page;
 const page=raw&&/^\d{1,6}$/.test(raw)?Math.max(1,Math.min(100000,Number(raw))):1;
 const queue=await (await getCredentialConcernReviewService()).list(principal,page);
 return <section className="page-stack">
 <header className="page-heading"><h1>Credential concerns</h1><p>Review public reports with their original intake and retained review history.</p></header>
 <div className="card"><p>Reports describe concerns; they do not establish fraud. Review does not change credential status.</p></div>
 {queue.items.length===0?<p>No concerns on this page.</p>:<div className="card"><ul>{queue.items.map(item=><li key={item.concernId}>
 <Link href={"/admin/credential-concerns/"+item.concernId}>{item.concernId}</Link>
 <p>{item.category.replaceAll("_"," ")} · {formatDateTime(item.createdAt)} · {item.outcome?item.outcome.replaceAll("_"," "):"Awaiting review"} · {item.linked?"Subject linked":"Legacy intake — subject unlinked"}</p>
 </li>)}</ul></div>}
 <nav aria-label="Concern queue pages">{page>1?<Link className="button button-secondary" href={"/admin/credential-concerns?page="+(page-1)}>Previous</Link>:null}
 {queue.hasNext?<Link className="button button-secondary" href={"/admin/credential-concerns?page="+(page+1)}>Next</Link>:null}</nav>
 </section>;
}
