"use client";

export default function WorkerProfileError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  return (
    <section className="dashboard-section profile-route-error" role="alert">
      <p className="section-kicker">Worker Profile</p>
      <h1>Profile could not be loaded</h1>
      <p>The profile request failed without discarding any previously committed version.</p>
      {error.digest ? <p className="muted-copy">Reference: {error.digest}</p> : null}
      <button className="button button-primary" type="button" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
