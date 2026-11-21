"use client";

export default function WorkerDashboardError({
  error,
  retry
}: {
  error: Error & { digest?: string };
  retry: () => void;
}): React.JSX.Element {
  return (
    <section className="route-error" role="alert">
      <p className="eyebrow">Worker Dashboard</p>
      <h1>We could not load your dashboard.</h1>
      <p>Your session is still protected. Retry the dashboard request; no form input was lost.</p>
      {error.digest ? <p className="error-reference">Reference: {error.digest}</p> : null}
      <button className="button button-primary" onClick={retry} type="button">
        Retry dashboard
      </button>
    </section>
  );
}
