import { listCompanyReports, queueReport } from "./actions";

export default async function CompanyReportsPage(): Promise<React.JSX.Element> {
  const deliveries = await listCompanyReports();
  return <section className="page-stack">
    <div className="page-heading"><div><p className="eyebrow">Company operations</p><h1>Reports</h1><p>Create authorized workforce, readiness and assurance report delivery requests.</p></div></div>
    <div className="card">
      <h2>Export report</h2>
      <form action={queueReport} className="form-grid">
        <label>Report ID<input name="reportId" placeholder="report_workforce001" required /></label>
        <label>Format<select name="format" defaultValue="csv"><option value="csv">CSV</option><option value="pdf">PDF</option><option value="print">Print</option></select></label>
        <label>Schedule (optional)<input name="scheduleAt" type="datetime-local" /></label>
        <button className="button button-primary" type="submit">Queue report delivery</button>
      </form>
      <p>Queued deliveries are stored for the company tenant and processed by the delivery boundary.</p>
    </div>
    <div className="card">
      <h2>Delivery queue</h2>
      {deliveries.length === 0 ? <p>No report deliveries queued.</p> : <ul>{deliveries.map((delivery) => <li key={delivery.deliveryKey}>{delivery.reportId} · {delivery.format} · {delivery.status}</li>)}</ul>}
    </div>
  </section>;
}
