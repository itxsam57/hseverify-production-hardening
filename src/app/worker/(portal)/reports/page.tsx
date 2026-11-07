import Link from "next/link";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { getDatabaseClient } from "@/lib/database/database";
import { ReportDefinitionService, type SavedReportDefinition } from "@/lib/reports/report-definition-service";
import { REPORT_TITLES, WORKER_REPORT_TYPES, type WorkerReportType } from "@/lib/reports/report-types";
import { getWorkerReportService, type WorkerReportRecord } from "@/lib/reports/worker-report-service";
import { queueSavedWorkerReport, queueWorkerReport, retryWorkerReport, saveWorkerReportDefinition } from "./actions";

export const dynamic = "force-dynamic";

function ReportFields({ definition }: { definition?: SavedReportDefinition }): React.JSX.Element {
  return <>
    <label>Report type
      <select aria-label="Report type" name="reportType" defaultValue={definition?.reportType ?? "identity-verification-summary"}>
        {WORKER_REPORT_TYPES.map(kind => <option key={kind} value={kind}>{REPORT_TITLES[kind]}</option>)}
      </select>
    </label>
    <label>Format
      <select aria-label="Format" name="format" defaultValue={definition?.format ?? "csv"}>
        <option value="csv">CSV</option><option value="pdf">PDF</option><option value="print">Printable HTML</option>
      </select>
    </label>
    <label>From (UTC)<input type="datetime-local" name="fromAt" defaultValue={definition?.filters.from?.slice(0,16) ?? ""} /></label>
    <label>To (UTC)<input type="datetime-local" name="toAt" defaultValue={definition?.filters.to?.slice(0,16) ?? ""} /></label>
    <label><input type="checkbox" name="queueEmail" defaultChecked={definition?.queueEmail ?? false} /> Email my verified address when ready</label>
  </>;
}
function displayedStatus(report: WorkerReportRecord): string {
  if (report.status === "delivered") return "ready";
  if (report.jobStatus === "retry_wait") return "retrying";
  if (report.jobStatus === "leased") return "processing";
  if (report.jobStatus === "terminal_failed") return "failed";
  return report.status;
}
function EmailStatus({ report }: { report: WorkerReportRecord }): React.JSX.Element | null {
  if (!report.queueEmail) return null;
  const message = report.emailStatus === "sent" ? "Report email was sent." :
    report.emailStatus === "failed" ? "Report email failed." :
    report.emailStatus === "queued" ? "Report email is queued." :
    report.emailStatus === "processing" ? "Report email is being sent." :
    report.emailStatus === "retry_wait" ? "Report email is retrying." :
    "Email waits for the report to be generated.";
  return <p>{message}</p>;
}
export default async function WorkerReportsPage({ searchParams }: {
  searchParams: Promise<{ notice?: string; error?: string }>
}): Promise<React.JSX.Element> {
  const query = await searchParams, principal = await requirePortalAuthorization("worker");
  const { reports } = await getWorkerReportService().workspace(principal);
  const definitions = await new ReportDefinitionService(await getDatabaseClient()).listWorker(principal);
  const message = query.notice === "queued" ? "Your report is queued." :
    query.notice === "saved" ? "Your saved report settings are updated." :
    query.notice === "retried" ? "The report retry is queued." : null;
  return <div className="dashboard-page page-stack">
    <div className="page-heading"><div>
      <p className="eyebrow">Worker records</p><h1>Reports</h1>
      <p>Create a private snapshot of your records. Use live verification for current credential validity.</p>
    </div><Link href="/worker/reports">Refresh reports</Link></div>
    {message ? <p role="status">{message}</p> : null}
    {query.error ? <p role="alert">{query.error}</p> : null}
    <section className="panel page-section content-stack" aria-labelledby="create-report-heading">
      <h2 id="create-report-heading">Create report</h2>
      <p>Date filters apply to the record dates in the selected report. Leave them empty for all your records.</p>
      <form action={queueWorkerReport} aria-label="Create report" className="form-grid">
        <ReportFields />
        <label>Generate at (UTC, optional)<input type="datetime-local" name="scheduleAt" /></label>
        <p>A scheduled report captures your records now and generates the file at the chosen time. Refresh this page to check progress.</p>
        <button type="submit">Queue report</button>
      </form>
    </section>
    <section className="panel page-section content-stack" aria-labelledby="saved-report-heading">
      <h2 id="saved-report-heading">Saved report settings</h2>
      <details><summary>Save report settings</summary>
        <form action={saveWorkerReportDefinition} aria-label="Save report settings" className="form-grid">
          <label>Settings name<input name="definitionName" required maxLength={120} /></label>
          <ReportFields /><button type="submit">Save settings</button>
        </form>
      </details>
      {definitions.length === 0 ? <p>No saved settings yet.</p> : definitions.map(definition => <article key={definition.definitionId}
        data-definition-id={definition.definitionId} className="content-stack">
        <h3>{definition.name}</h3>
        <p>Version {definition.version} · {REPORT_TITLES[definition.reportType as WorkerReportType]} · {definition.format.toUpperCase()}</p>
        <p>{definition.filters.from ? "From " + definition.filters.from : "No start date"} · {definition.filters.to ? "To " + definition.filters.to : "No end date"}</p>
        <form action={queueSavedWorkerReport} aria-label={"Queue saved " + definition.name} className="form-grid">
          <input type="hidden" name="definitionId" value={definition.definitionId} />
          <input type="hidden" name="definitionVersion" value={definition.version} />
          <label>Generate saved report at (UTC, optional)<input type="datetime-local" name="scheduleAt" /></label>
          <button type="submit">Queue saved report</button>
        </form>
        <details><summary>Edit saved settings</summary>
          <p>Saving creates a new version. Existing requests keep their captured settings and records.</p>
          <form action={saveWorkerReportDefinition} aria-label={"Edit saved " + definition.name} className="form-grid">
            <input type="hidden" name="editDefinitionId" value={definition.definitionId} />
            <input type="hidden" name="expectedVersion" value={definition.version} />
            <label>Settings name<input name="definitionName" required maxLength={120} defaultValue={definition.name} /></label>
            <ReportFields definition={definition} /><button type="submit">Save new version</button>
          </form>
        </details>
      </article>)}
    </section>
    <section className="panel page-section content-stack" aria-labelledby="report-history-heading">
      <h2 id="report-history-heading">Report history</h2>
      {reports.length === 0 ? <p>No report requests yet.</p> : reports.map(report => <article key={report.reportId}
        data-report-id={report.reportId} className="content-stack">
        <h3>{REPORT_TITLES[report.reportType]}</h3>
        <p>{report.format.toUpperCase()} · <span>{displayedStatus(report)}</span></p>
        <p>Requested {report.requestedAt}{report.scheduleAt ? " · Generate at " + report.scheduleAt : ""}</p>
        {report.definitionVersion ? <p>Saved settings version {report.definitionVersion}</p> : null}
        <details><summary>Preview captured report</summary>
          <p>{report.rows.length} matching records{report.rows.length > 100 ? "; showing the first 100" : ""}.</p>
          <div style={{ overflowX: "auto" }}><table><thead><tr>
            {report.headers.map(header => <th key={header} scope="col">{header}</th>)}
          </tr></thead><tbody>
            {report.rows.length === 0 ? <tr><td colSpan={report.headers.length}>No records match this report.</td></tr> :
              report.rows.slice(0,100).map((row, index) => <tr key={index}>{report.headers.map(header => <td key={header}>{row[header]}</td>)}</tr>)}
          </tbody></table></div>
        </details>
        <EmailStatus report={report} />
        {report.status === "delivered" ? <a href={"/api/worker/reports/" + report.reportId + "/export"}
          target={report.format === "print" ? "_blank" : undefined} rel={report.format === "print" ? "noopener noreferrer" : undefined}>
          {report.format === "print" ? "Open printable report" : "Download " + report.format.toUpperCase()}
        </a> : null}
        {report.jobStatus === "terminal_failed" && report.generationVersion < 5 ? <form action={retryWorkerReport}>
          <input type="hidden" name="reportId" value={report.reportId} /><button type="submit">Retry report</button>
        </form> : null}
        {report.jobStatus === "terminal_failed" && report.generationVersion >= 5 ?
          <p>This report has reached its retry limit. Create a new request to try again.</p> : null}
      </article>)}
    </section>
  </div>;
}
