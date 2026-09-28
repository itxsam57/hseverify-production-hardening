import { createSupervisorObservationAction } from "./actions";

import { requireCurrentTenantPermission } from "@/lib/authorization/authorization-service";
import { getSupervisorObservationService } from "@/lib/review/supervisor-observation-service";

export default async function CompanyObservationsPage({
  searchParams
}: {
  searchParams: Promise<{ result?: string; error?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const principal = await requireCurrentTenantPermission("company.orders.manage");
  const context = await getSupervisorObservationService().listCompanyContext(principal);

  return (
    <div className="dashboard-page">
      <header className="page-heading-row"><div>
        <p className="eyebrow">Structured evidence</p>
        <h1>Supervisor observations</h1>
        <p className="page-intro">
          Record an observed task against a real Assurance Case. The Worker must acknowledge the signed observation before it enters the independent Verifier queue.
        </p>
      </div></header>
      {params.result === "created" ? <p className="status-banner status-success" role="status">Observation submitted to the Worker for acknowledgement.</p> : null}
      {params.error ? <p className="status-banner status-error" role="alert">{params.error}</p> : null}
      <section className="surface-card">
        <h2>Create observation</h2>
        {context.cases.length === 0 ? <p>No active Assurance Cases are available.</p> : (
          <form action={createSupervisorObservationAction} className="form-grid">
            <label>Worker / Assurance Case<select name="caseId" required defaultValue="">
              <option value="" disabled>Select case</option>
              {context.cases.map((item) => <option key={item.caseId} value={item.caseId}>{item.workerName} · {item.caseStatus} · {item.caseId}</option>)}
            </select></label>
            <label>Authorized supervisor<select name="observerMembershipId" required defaultValue="">
              <option value="" disabled>Select supervisor</option>
              {context.supervisors.map((item) => <option key={item.membershipId} value={item.membershipId}>{item.displayName} · {item.role}</option>)}
            </select></label>
            <label>Framework reference<input name="frameworkReference" required maxLength={180} /></label>
            <label>Competency reference<input name="competencyReference" required maxLength={160} /></label>
            <label>Observed task / event<input name="taskReference" required maxLength={240} /></label>
            <label>Observed at<input name="observedAt" type="datetime-local" required /></label>
            <label>Checklist items, one per line<textarea name="checklist" rows={5} placeholder={"PPE selected correctly\nIsolation checked\nPermit controls followed"} /></label>
            <label>Restrictions / conditions<textarea name="restrictions" rows={3} maxLength={2000} /></label>
            <label>Observation notes<textarea name="observationText" rows={7} minLength={20} maxLength={6000} required /></label>
            <label>Outcome<select name="outcome" defaultValue="demonstrated">
              <option value="demonstrated">Demonstrated</option>
              <option value="partially_demonstrated">Partially demonstrated</option>
              <option value="not_demonstrated">Not demonstrated</option>
            </select></label>
            <label>Supervisor declaration<textarea name="supervisorDeclaration" rows={3} minLength={10} maxLength={1000} required defaultValue="I confirm this observation is a truthful record of the task I personally observed." /></label>
            <label><input type="checkbox" name="signed" value="yes" required /> I sign this supervisor declaration.</label>
            <button className="button button-primary" type="submit">Submit observation for Worker acknowledgement</button>
          </form>
        )}
      </section>
    </div>
  );
}
