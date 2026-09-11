import Link from "next/link";

export default function WorkerDashboardNotFound(): React.JSX.Element {
  return (
    <section className="route-error">
      <p className="eyebrow">Worker Dashboard</p>
      <h1>The requested worker record is not available.</h1>
      <p>Return to the dashboard without exposing whether another private record exists.</p>
      <Link className="button button-primary" href="/worker/dashboard">
        Return to dashboard
      </Link>
    </section>
  );
}
