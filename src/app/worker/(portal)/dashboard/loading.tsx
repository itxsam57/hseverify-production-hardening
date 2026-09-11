export default function WorkerDashboardLoading(): React.JSX.Element {
  return (
    <div className="dashboard-page" aria-busy="true" aria-label="Loading Worker Dashboard">
      <div className="skeleton skeleton-heading" />
      <div className="skeleton skeleton-banner" />
      <div className="metric-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="skeleton skeleton-card" key={index} />
        ))}
      </div>
      <div className="dashboard-layout">
        <div className="skeleton skeleton-panel" />
        <div className="skeleton skeleton-panel" />
      </div>
    </div>
  );
}
