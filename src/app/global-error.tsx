"use client";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  return (
    <html lang="en">
      <body>
        <main>
          <section role="alert">
            <p>Temporary problem</p>
            <h1>HSE Verify could not start correctly.</h1>
            <p>No internal error details or protected records have been exposed.</p>
            {error.digest ? <p>Reference: {error.digest}</p> : null}
            <button onClick={reset} type="button">
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
