import { acknowledgeObservationAction } from "./actions";

import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { getSupervisorObservationService } from "@/lib/review/supervisor-observation-service";

export default async function WorkerObservationsPage({
  searchParams
}: {
  searchParams: Promise<{ result?: string }>;
}): Promise<React.JSX.Element> {
  const { result } = await searchParams;
  const principal = await requirePortalAuthorization("worker");
  const observations = await getSupervisorObservationService().listForWorker(principal);

  return (
    <div className="dashboard-page">
      <header className="page-heading-row"><div>
        <p className="eyebrow">Practical evidence</p>
        <h1>Supervisor observations</h1>
        <p className="page-intro">
          Acknowledgement confirms you have seen the supervisor record. Your comment cannot change the supervisor&apos;s signed evidence.
        </p>
      </div></header>
      {result === "acknowledged" ? <p className="status-banner status-success" role="status">Observation acknowledged and queued for independent verification.</p> : null}
      <section className="surface-card">
        {observations.length === 0 ? <p>No supervisor observations have been submitted for you.</p> : (
          <div className="record-list">
            {observations.map((item) => (
              <article id={item.observationId} className="surface-card" key={item.observationId}>
                <h2>{item.competencyReference}</h2>
                <p>{item.frameworkReference} · {item.taskReference}</p>
                <p><strong>Supervisor:</strong> {item.supervisorName}</p>
                <p><strong>Observed:</strong> {new Date(item.observedAt).toLocaleString()}</p>
                <p><strong>Outcome:</strong> {item.outcome.replaceAll("_", " ")}</p>
                <p>{item.observationText}</p>
                {item.restrictions ? <p><strong>Restrictions:</strong> {item.restrictions}</p> : null}
                {item.workerAcknowledgedAt ? (
                  <p className="status-banner status-success">Acknowledged {new Date(item.workerAcknowledgedAt).toLocaleString()}{item.workerComment ? ` · ${item.workerComment}` : ""}</p>
                ) : (
                  <form action={acknowledgeObservationAction} className="form-grid">
                    <input type="hidden" name="observationId" value={item.observationId} />
                    <label>Your comment (optional)<textarea name="comment" rows={3} maxLength={2000} /></label>
                    <button className="button button-primary" type="submit">Acknowledge observation</button>
                  </form>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
