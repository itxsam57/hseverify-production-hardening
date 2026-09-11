"use client";

export default function RootError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  return (
    <main className="public-verification-page">
      <section className="public-verification-card" role="alert">
        <p className="eyebrow">Temporary problem</p>
        <h1>HSE Verify could not complete this request.</h1>
        <p>No internal error details or protected records have been exposed.</p>
        {error.digest ? <p className="error-reference">Reference: {error.digest}</p> : null}
        <button className="button button-primary" onClick={reset} type="button">
          Try again
        </button>
      </section>
    </main>
  );
}
