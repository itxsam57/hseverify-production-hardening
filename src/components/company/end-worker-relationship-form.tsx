"use client";

import { useActionState } from "react";
import {
  endWorkerRelationshipAction,
  type EndWorkerRelationshipState
} from "@/app/company/(portal)/workers/[linkId]/actions";

const INITIAL_END_WORKER_RELATIONSHIP_STATE: EndWorkerRelationshipState = {
  status: "idle", message: null
};

export function EndWorkerRelationshipForm({
  linkId,
  today
}: {
  linkId: string;
  today: string;
}): React.JSX.Element {
  const [state, action, pending] = useActionState(
    endWorkerRelationshipAction.bind(null, linkId),
    INITIAL_END_WORKER_RELATIONSHIP_STATE
  );
  return (
    <section className="surface-card" aria-label="End Company Worker relationship">
      <h2>End Company relationship</h2>
      <p>
        This removes the current Company link immediately. It does not delete the Worker identity,
        their evidence, or the historical Company audit record.
      </p>
      {state.message ? (
        <p role={state.status === "success" ? "status" : "alert"}>{state.message}</p>
      ) : null}
      {state.status !== "success" ? (
        <form action={action} className="form-grid">
          <label>
            Effective date
            <input type="date" name="effectiveDate" max={today} defaultValue={today} required />
          </label>
          <label>
            Reason for ending relationship
            <textarea name="reason" minLength={10} maxLength={1000} required rows={3} />
          </label>
          <label className="checkbox-row">
            <input type="checkbox" name="confirm" required />
            I confirm the Company relationship will end immediately.
          </label>
          <button className="button button-secondary" type="submit" disabled={pending}>
            {pending ? "Ending relationship…" : "End relationship"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
