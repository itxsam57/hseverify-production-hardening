import Link from "next/link";

const portals = [
  ["Worker", "/worker/login", "Own profile, evidence, assessments, interviews and credentials."],
  ["Company", "/company/login", "Tenant workforce, Assurance Orders, funding, reports and billing."],
  ["Verifier", "/verifier/login", "Assigned evidence and written-answer review."],
  ["Assessor", "/assessor/login", "Assigned interview scheduling and live interview workflow."],
  ["Admin", "/admin/login", "Platform operations, policy, decisions and health."],
  ["Root", "/root/login", "Privileged access and security recovery only."]
] as const;

export default function PortalSelectionPage(): React.JSX.Element {
  return (
    <main className="public-page" id="main-content">
      <section className="public-card">
        <p className="eyebrow">Sign in</p>
        <h1>Choose your HSE Verify portal</h1>
        <p className="page-intro">
          Sessions are role-bound. Opening another protected portal requires a fresh authorized login.
        </p>
      </section>
      <section className="public-card">
        <div className="record-list">
          {portals.map(([label, href, detail]) => (
            <article className="record-row" key={href}>
              <div><h2>{label}</h2><p>{detail}</p></div>
              <Link className="button button-secondary" href={href}>Open {label}</Link>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
