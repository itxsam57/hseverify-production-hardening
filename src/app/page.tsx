import Link from "next/link";

export default function PublicHomePage(): React.JSX.Element {
  return (
    <main className="public-home">
      <header className="public-header">
        <Link className="brand-mark" href="/">
          <span className="brand-symbol" aria-hidden="true">HV</span>
          <span>HSE Verify</span>
        </Link>
        <Link className="button button-secondary" href="/worker/login">
          Worker sign in
        </Link>
      </header>

      <section className="public-hero">
        <p className="eyebrow">Workforce Trust Platform</p>
        <h1>Independent verification of identity, evidence and current competency.</h1>
        <p>
          HSE Verify connects worker records, assessments, structured review, interviews and live credentials in one auditable assurance workflow.
        </p>
        <div className="public-hero-actions">
          <Link className="button button-primary" href="/worker/login">
            Open Worker Portal
          </Link>
        </div>
      </section>
    </main>
  );
}
