import Link from "next/link";

export default function WorkersPublicPage(): React.JSX.Element {
  return (
    <main className="public-page" id="main-content">
      <section className="public-card">
        <p className="eyebrow">For Workers</p>
        <h1>Your identity and evidence remain yours across employers.</h1>
        <p className="page-intro">
          Build a durable Worker record, submit evidence, complete assessments and interviews,
          receive decisions and share only the approved information you choose.
        </p>
        <div className="public-hero-actions">
          <Link className="button button-primary" href="/worker/register">Create Worker account</Link>
          <Link className="button button-secondary" href="/worker/login">Worker sign in</Link>
        </div>
      </section>
      <section className="public-card">
        <h2>What you can do</h2>
        <ul>
          <li>Verify email and phone, identity evidence and permanent Worker ID.</li>
          <li>Maintain qualifications, experience, skills and employment history.</li>
          <li>Take eligible assessments with safe save, exit and recovery controls.</li>
          <li>Attend assigned interviews and see current assurance/credential state.</li>
          <li>Create revocable scoped share links without exposing private evidence.</li>
        </ul>
      </section>
    </main>
  );
}
