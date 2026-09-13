import type {
  CompanyActionCentreAnalytics,
  CompanyReadinessSlice
} from "@/lib/assurance/company-action-centre-analytics-service";

function ReadinessTable({
  title,
  rows
}: {
  title: string;
  rows: readonly CompanyReadinessSlice[];
}): React.JSX.Element {
  return (
    <section className="detail-card">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p>No active scoped assurance cases yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Scope</th>
                <th>Readiness</th>
                <th>Assured</th>
                <th>Conditional</th>
                <th>In progress</th>
                <th>Needs attention</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.scopeId}>
                  <td>{row.scopeName}</td>
                  <td>{row.readinessPercent}%</td>
                  <td>{row.assured}/{row.total}</td>
                  <td>{row.conditional}</td>
                  <td>{row.inProgress}</td>
                  <td>{row.attention}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function CompanyActionCentreAnalyticsPanel({
  analytics
}: {
  analytics: CompanyActionCentreAnalytics;
}): React.JSX.Element {
  const { summary } = analytics;
  return (
    <div className="page-stack">
      <section className="metric-grid" aria-label="Live Company assurance summary">
        <article className="metric-card"><strong>Active orders</strong><p>{summary.activeOrders}</p></article>
        <article className="metric-card"><strong>Active cases</strong><p>{summary.activeCases}</p></article>
        <article className="metric-card"><strong>Company approvals</strong><p>{summary.companyApprovalsRequired}</p></article>
        <article className="metric-card"><strong>Overdue actions</strong><p>{summary.overdueActions}</p></article>
      </section>

      <section className="detail-card">
        <h2>Live workflow status</h2>
        {analytics.workflowStages.length === 0 ? <p>No active assurance cases yet.</p> : (
          <ul>
            {analytics.workflowStages.map((stage) => <li key={stage.status}>{stage.status}: {stage.count}</li>)}
          </ul>
        )}
        {analytics.pendingOwners.length > 0 ? (
          <p>Pending by owner: {analytics.pendingOwners.map((item) => `${item.owner} ${item.count}`).join(" · ")}</p>
        ) : null}
      </section>

      <ReadinessTable title="Site readiness" rows={analytics.siteReadiness} />
      <ReadinessTable title="Department readiness" rows={analytics.departmentReadiness} />

      <section className="detail-card">
        <h2>Competency gaps</h2>
        {analytics.competencyGaps.length === 0 ? <p>No active credential-target gaps are recorded.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Target</th><th>Assured</th><th>Gap</th><th>Gap rate</th></tr></thead>
              <tbody>
                {analytics.competencyGaps.map((gap) => (
                  <tr key={gap.credentialTarget}>
                    <td>{gap.credentialTarget}</td>
                    <td>{gap.assured}/{gap.total}</td>
                    <td>{gap.gap}</td>
                    <td>{gap.gapPercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
