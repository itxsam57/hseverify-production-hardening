import Link from "next/link";

export default function HowItWorksPage(): React.JSX.Element {
  return (
    <main className="public-page" id="main-content">
      <section className="public-card">
        <p className="eyebrow">How HSE Verify works</p>
        <h1>One assurance record from identity to current competency.</h1>
        <p className="page-intro">
          HSE Verify connects identity, evidence, assessment, independent review,
          interview, decision and credential status without giving an employer
          ownership of a Worker&apos;s global identity.
        </p>
      </section>
      <section className="public-card" aria-labelledby="workflow-heading">
        <h2 id="workflow-heading">The assurance workflow</h2>
        <ol>
          <li>Worker verifies contact information and completes identity/evidence.</li>
          <li>Independent Verifiers review submitted evidence and exact versions.</li>
          <li>Eligible Workers complete unseen assessments with server-owned recovery.</li>
          <li>Written work, integrity signals and interviews are reviewed when required.</li>
          <li>The Decision Engine records an explainable final outcome.</li>
          <li>Approved outcomes can issue a live credential and Digital Passport record.</li>
        </ol>
        <p><Link href="/auth/select">Choose a portal</Link> · <Link href="/verify">Verify a record</Link></p>
      </section>
    </main>
  );
}
