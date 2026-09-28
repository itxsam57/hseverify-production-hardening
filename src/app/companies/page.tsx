import Link from "next/link";

export default function CompaniesPublicPage(): React.JSX.Element {
  return (
    <main className="public-page" id="main-content">
      <section className="public-card">
        <p className="eyebrow">For Companies</p>
        <h1>Request and monitor assurance without owning Worker identity.</h1>
        <p className="page-intro">
          Organize your workforce, invite Workers, submit Assurance Orders, fund activity,
          track exact next actions and receive only company-authorized results.
        </p>
        <div className="public-hero-actions">
          <Link className="button button-primary" href="/company/register">Register a company</Link>
          <Link className="button button-secondary" href="/company/login">Company sign in</Link>
        </div>
      </section>
      <section className="public-card">
        <h2>Company operations</h2>
        <ul>
          <li>Sites, departments, team permissions and Worker invitations.</li>
          <li>Assurance Orders, one Worker-specific Assurance Case per target and Action Centre ownership.</li>
          <li>Assessment/interview progress, company-scoped workforce readiness and reports.</li>
          <li>Credits, invoices, refunds and reconciliation through verified payment state.</li>
        </ul>
      </section>
    </main>
  );
}
