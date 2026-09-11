"use client";

export function NotificationError({
  reset
}: {
  reset: () => void;
}): React.JSX.Element {
  return (
    <div className="notification-center-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Current portal</p>
          <h1>Notifications</h1>
          <p className="page-intro">
            Your notification records could not be loaded safely.
          </p>
        </div>
      </header>
      <div className="empty-state notification-failure-state" role="alert">
        <h2>Notifications are temporarily unavailable</h2>
        <p>No notification was changed. Try loading this portal view again.</p>
        <button className="button button-secondary" type="button" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}
