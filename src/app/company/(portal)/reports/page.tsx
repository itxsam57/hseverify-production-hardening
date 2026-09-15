import { queueReport } from "./actions";

export default function CompanyReportsPage(): React.JSX.Element {
  return <section className="page-stack">
    <div className="page-heading"><div><p className="eyebrow">Company operations</p><h1>Reports</h1><p>Create authorized workforce, readiness and assurance report delivery requests.</p></div></div>
    <div className="card">
      <h2>Export report</h2>
      <form action={queueReport} className="form-grid">
        <label>Report ID<input name="reportId" placeholder="report_workforce001" required /></label>
        <label>Format<select name="format" defaultValue="csv"><option value="csv">CSV</option><option value="pdf">PDF</option><option value="print">Print</option></select></label>
        <button className="button button-primary" type="submit">Queue report</button>
      </form>
    </div>
  </section>;
}
