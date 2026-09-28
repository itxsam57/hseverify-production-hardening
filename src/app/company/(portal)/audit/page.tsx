import { listCurrentTenantAuditEvents } from "@/lib/audit/audit-service";

export default async function CompanyAuditPage(): Promise<React.JSX.Element> {
  const events = await listCurrentTenantAuditEvents({ options: { limit: 100 } });
  return (
    <div className="dashboard-page">
      <header className="page-heading-row"><div>
        <p className="eyebrow">Company governance</p>
        <h1>Company audit</h1>
        <p className="page-intro">
          Tenant-scoped operational history only. Platform security logs, other tenants and private reviewer notes are never exposed here.
        </p>
      </div></header>
      <section className="surface-card">
        {events.length === 0 ? <p>No company audit events recorded yet.</p> : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Time</th><th>Action</th><th>Outcome</th><th>Target</th><th>Reason</th></tr></thead>
              <tbody>{events.map((event) => (
                <tr key={event.auditEventId}>
                  <td>{new Date(event.occurredAt).toLocaleString()}</td>
                  <td>{event.action}</td>
                  <td>{event.outcome}</td>
                  <td>{event.target.type}{event.target.reference ? ` · ${event.target.reference}` : ""}</td>
                  <td>{event.reason ?? "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
