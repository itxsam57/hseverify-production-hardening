import Link from "next/link";
import {companyReportWorkspace,queueReport,retryReport,saveReportDefinition} from "./actions";
import {REPORT_TITLES,type CompanyReportType} from "@/lib/reports/report-types";
import type {SavedReportDefinition} from "@/lib/reports/report-definition-service";
type Workspace=Awaited<ReturnType<typeof companyReportWorkspace>>;
const local=(value:string|null):string=>value?new Date(value).toISOString().slice(0,16):"";
function Fields({workspace,saved}:{workspace:Workspace;saved?:SavedReportDefinition}):React.JSX.Element{
 const suffix=saved?" for "+saved.name:"",scope=saved?.scope??workspace.restriction;
 return <>
  <label>Report type{suffix}<select aria-label={"Report type"+suffix} name="reportType" defaultValue={saved?.reportType??"workforce-status"}>
   {workspace.reportTypes.map(kind=><option key={kind} value={kind}>{REPORT_TITLES[kind]}</option>)}
  </select></label>
  <label>Format{suffix}<select aria-label={"Format"+suffix} name="format" defaultValue={saved?.format??"csv"}>
   <option value="csv">CSV</option><option value="pdf">PDF</option><option value="print">Print</option>
  </select></label>
  <label>Site{suffix}<select aria-label={"Site"+suffix} name="siteId" defaultValue={scope.siteId??""}>
   {!workspace.restriction.siteId?<option value="">All permitted sites</option>:null}
   {workspace.sites.map(site=><option key={site.site_id} value={site.site_id}>{site.name}</option>)}
  </select></label>
  <label>Department{suffix}<select aria-label={"Department"+suffix} name="departmentId" defaultValue={scope.departmentId??""}>
   {!workspace.restriction.departmentId?<option value="">All permitted departments</option>:null}
   {workspace.departments.map(department=><option key={department.department_id} value={department.department_id}>{department.name}</option>)}
  </select></label>
  <label>From UTC{suffix}<input name="fromAt" type="datetime-local" defaultValue={local(saved?.filters.from??null)}/></label>
  <label>Through UTC{suffix}<input name="toAt" type="datetime-local" defaultValue={local(saved?.filters.to??null)}/></label>
  <label>Expiry window in days{suffix}<input name="expiryDays" type="number" min="1" max="365" defaultValue={saved?.filters.expiryDays??30}/></label>
  <label><input type="checkbox" name="queueEmail" defaultChecked={saved?.queueEmail??false}/> Email my verified address when ready{suffix}</label>
 </>;
}
export default async function CompanyReportsPage({searchParams}:{searchParams:Promise<{notice?:string;error?:string}>}):Promise<React.JSX.Element>{
 const [workspace,messages]=await Promise.all([companyReportWorkspace(),searchParams]);
 return <section className="page-stack">
  <div className="page-heading"><div><p className="eyebrow">Company operations</p><h1>Reports</h1>
   <p>Capture a report for your permitted Company scope, then export it as CSV, PDF or a printable page.</p></div>
   <Link className="button button-secondary" href="/company/reports">Refresh report status</Link>
  </div>
  {["queued","retried","saved"].includes(messages.notice??"")?<p role="status">
   {messages.notice==="saved"?"Your report definition is saved.":messages.notice==="retried"?"The report retry is queued.":"Your report is queued."}
   {messages.notice!=="saved"?" Refresh the status to see when it is ready.":null}
  </p>:null}
  {messages.error?<p role="alert">{messages.error.slice(0,240)}</p>:null}
  <div className="card"><h2>New report</h2>
   <p>Reports use fixed fields and capture the data available at request time. Date filters use UTC. The expiry window applies to expiring credentials. Credit and billing usage requires unrestricted billing access.</p>
   {workspace.canExport && workspace.reportTypes.length?<form action={queueReport} className="form-grid" data-report-request-form>
    <Fields workspace={workspace}/>
    <label>Schedule in UTC (optional)<input name="scheduleAt" type="datetime-local"/></label>
    <label>Definition name (for saving)<input name="definitionName" maxLength={120}/></label>
    <button className="button button-primary" type="submit">Queue report</button>
    <button className="button button-secondary" type="submit" formAction={saveReportDefinition}>Save report definition</button>
   </form>:<p>Your current access does not permit requesting or downloading these reports. Report export and the relevant source permission are required.</p>}
  </div>
  <div className="card"><h2>Saved report definitions</h2>
   {workspace.definitions.length?<ul className="page-stack">{workspace.definitions.map(saved=><li key={saved.definitionId} data-definition-id={saved.definitionId}>
    <p><strong>{saved.name}</strong> · Version {saved.version} · {REPORT_TITLES[saved.reportType]} · {saved.format.toUpperCase()}</p>
    <form action={queueReport} className="form-grid" data-saved-report-queue>
     <input type="hidden" name="definitionId" value={saved.definitionId}/><input type="hidden" name="definitionVersion" value={saved.version}/>
     <label>Schedule saved report in UTC (optional)<input name="scheduleAt" type="datetime-local"/></label>
     <button className="button button-secondary" type="submit">Queue saved report</button>
    </form>
    <details><summary>Edit saved definition</summary><p>Saving an edit creates a new version. Existing requests keep their captured version.</p>
     <form action={saveReportDefinition} className="form-grid">
      <input type="hidden" name="editDefinitionId" value={saved.definitionId}/><input type="hidden" name="expectedVersion" value={saved.version}/>
      <label>Definition name for {saved.name}<input name="definitionName" maxLength={120} required defaultValue={saved.name}/></label>
      <Fields workspace={workspace} saved={saved}/><button className="button button-secondary" type="submit">Save new definition version</button>
     </form>
    </details>
   </li>)}</ul>:<p>No saved report definitions are available in your current scope.</p>}
  </div>
  <div className="card"><h2>Your report requests</h2>
   {workspace.reports.length?<ul className="page-stack">{workspace.reports.map(delivery=>{
    const failed=delivery.jobStatus==="terminal_failed",status=delivery.status==="delivered"?"delivered":failed?"failed":
     delivery.jobStatus==="retry_wait"?"retrying":delivery.jobStatus==="leased"?"processing":delivery.status;
    return <li key={delivery.deliveryKey} data-report-id={delivery.reportId}>
     <p><strong>{REPORT_TITLES[delivery.reportType as CompanyReportType]}</strong> · {delivery.format.toUpperCase()} · <span>{status}</span></p>
     <p>Requested {new Date(delivery.requestedAt).toLocaleString("en-GB",{timeZone:"UTC"})} UTC
      {delivery.scheduleAt?" · Scheduled "+new Date(delivery.scheduleAt).toLocaleString("en-GB",{timeZone:"UTC"})+" UTC":""}
      {delivery.definitionVersion?" · Saved definition version "+delivery.definitionVersion:""}</p>
     {delivery.canAccessSnapshot?<details><summary>Preview captured report</summary>
      <p>{delivery.rows.length} matching records{delivery.rows.length>100?"; showing the first 100":""}. This snapshot remains as captured; use live verification for current credential validity.</p>
      <div className="table-wrap"><table><thead><tr>{delivery.headers.map(header=><th key={header} scope="col">{header}</th>)}</tr></thead>
       <tbody>{delivery.rows.slice(0,100).map((row,index)=><tr key={index}>{delivery.headers.map(header=><td key={header}>{row[header]}</td>)}</tr>)}
        {!delivery.rows.length?<tr><td colSpan={delivery.headers.length}>No records match this report.</td></tr>:null}</tbody></table></div>
     </details>:null}
     {workspace.canExport && delivery.canAccessSnapshot && delivery.status==="delivered"?<a className="button button-secondary"
      href={"/api/company/reports/"+delivery.reportId+"/export"} target={delivery.format==="print"?"_blank":undefined}
      rel={delivery.format==="print"?"noopener noreferrer":undefined}>{delivery.format==="print"?"Open printable report":"Download "+delivery.format.toUpperCase()}</a>:null}
     {delivery.queueEmail?<p role="status">{delivery.emailStatus==="sent"?"Report email sent.":delivery.emailStatus==="failed"?
      "Report email could not be delivered. Your generated report remains available while your access is active.":
      delivery.emailStatus==="retry_wait"?"Report email is retrying.":delivery.emailStatus?"Report email is queued.":"Report email will be queued after generation."}</p>:null}
     {failed?<p role="status">{delivery.generationVersion<5?"The report could not be generated. You can retry while your export access is active.":
      "This report has reached its retry limit. Create a new request to try again."}</p>:null}
     {workspace.canExport && delivery.canAccessSnapshot && failed && delivery.generationVersion<5?<form action={retryReport}>
      <input type="hidden" name="reportId" value={delivery.reportId}/><button className="button button-secondary" type="submit">Retry report</button>
     </form>:null}
    </li>;
   })}</ul>:<p>No report requests in your current scope.</p>}
  </div>
 </section>;
}
