import Link from "next/link";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { getServerEnvironment } from "@/lib/config/server-environment";
import { PublicInquiryRepository } from "@/lib/public-inquiry/public-inquiry-repository";
type InquiryRow={inquiry_id:string;kind:string;contact_name:string;email:string;company:string;message:string;received_at:string|Date};
export async function InquiryStaffPage({role,page}:{role:"admin"|"root";page:string|undefined}):Promise<React.JSX.Element>{
 const principal=await requirePlatformPermission({expectedRole:role,permission:"platform.security.read"});
 const pageNumber=page&&/^\d{1,5}$/.test(page)?Math.min(Number(page),10000):0;
 const rows=await new PublicInquiryRepository(await getDatabaseClient(),getServerEnvironment().sessionSecret)
  .listForStaff(principal,pageNumber) as InquiryRow[];
 return <section className="page-stack">
  <div className="page-heading"><div><p className="eyebrow">Private staff intake</p><h1>Contact & demo requests</h1><p>Follow up with the requester using the contact details provided. Demo requests do not represent confirmed appointments.</p></div></div>
  {rows.length===0?<p>No requests on this page.</p>:rows.slice(0,25).map(row=><article key={row.inquiry_id} className="panel content-stack">
   <h2>{row.kind==="demo"?"Demo request":"Contact request"}</h2>
   <p>Reference: {row.inquiry_id}</p><p>Received: {new Date(row.received_at).toISOString()}</p>
   <p>Name: {row.contact_name}</p><p>Email: {row.email}</p>{row.company?<p>Company: {row.company}</p>:null}
   <p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{row.message}</p>
  </article>)}
  <nav aria-label="Request pages">{pageNumber>0?<Link href={`/${role}/contact?page=${pageNumber-1}`}>Previous page</Link>:null}{" "}{rows.length>25?<Link href={`/${role}/contact?page=${pageNumber+1}`}>Next page</Link>:null}</nav>
 </section>;
}
