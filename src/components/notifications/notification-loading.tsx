export function NotificationLoading(): React.JSX.Element {
  return (
    <div className="notification-center-page" aria-busy="true" aria-live="polite">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Current portal</p>
          <h1>Notifications</h1>
          <p className="page-intro">Loading persisted notifications…</p>
        </div>
      </header>
      <div className="empty-state notification-empty-state">
        <p>Loading your notification records.</p>
      </div>
    </div>
  );
}
