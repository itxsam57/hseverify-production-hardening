import Link from "next/link";

export default function NotFoundPage(): React.JSX.Element {
  return (
    <main className="public-verification-page">
      <Link className="brand-mark" href="/">
        <span className="brand-symbol" aria-hidden="true">HV</span>
        <span>HSE Verify</span>
      </Link>
      <section className="public-verification-card">
        <p className="eyebrow">Not available</p>
        <h1>The requested record could not be shown.</h1>
        <p>
          The identifier may be invalid, private, unavailable or no longer approved for public display.
        </p>
        <Link className="button button-primary" href="/">
          Return to HSE Verify
        </Link>
      </section>
    </main>
  );
}
