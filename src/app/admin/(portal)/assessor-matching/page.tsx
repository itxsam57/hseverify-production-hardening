import {
  runAssessorMatchingAction,
  saveAssessorMatchingProfileAction
} from "./actions";

import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getInterviewAssignmentService } from "@/lib/interview/interview-assignment-service";
import { getStaffCalibrationService } from "@/lib/review/staff-calibration-service";

export default async function AdminAssessorMatchingPage({
  searchParams
}: {
  searchParams: Promise<{ result?: string; error?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const principal = await requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.operations.manage"
  });
  const assignment = await getInterviewAssignmentService();
  const [staff, profiles, unassigned] = await Promise.all([
    getStaffCalibrationService().listStaff(principal),
    assignment.listProfiles(principal),
    assignment.listUnassigned(principal)
  ]);
  const assessors = staff.filter((item) => item.role === "assessor");

  return (
    <div className="dashboard-page">
      <header className="page-heading-row"><div>
        <p className="eyebrow">Interview operations</p>
        <h1>Assessor matching</h1>
        <p className="page-intro">
          Automatic matching requires scope, language, jurisdiction, risk, availability, workload,
          current framework calibration and no active Worker conflict. Every candidate decision is persisted.
        </p>
      </div></header>

      {params.result ? (
        <p className={`status-banner ${params.result === "no-eligible-assessor" ? "status-warning" : "status-success"}`} role="status">
          {params.result === "profile-saved"
            ? "Assessor matching profile saved."
            : params.result === "assigned"
              ? "Interview assigned to the highest-ranked eligible Assessor."
              : "No eligible Assessor matched. The interview remains unassigned for Admin action."}
        </p>
      ) : null}
      {params.error ? <p className="status-banner status-error" role="alert">{params.error}</p> : null}

      <section className="surface-card">
        <h2>Configure Assessor matching profile</h2>
        <form action={saveAssessorMatchingProfileAction} className="form-grid">
          <label>Assessor<select name="assessorAccountId" required defaultValue="">
            <option value="" disabled>Select Assessor</option>
            {assessors.map((item) => (
              <option value={item.accountId} key={item.accountId}>{item.displayName} · {item.email}</option>
            ))}
          </select></label>
          <label>Trade scopes<textarea name="tradeScopes" rows={3} placeholder="HSE, Electrical, Welding or *" required /></label>
          <label>Qualification scopes<textarea name="qualificationScopes" rows={3} placeholder="NEBOSH, IOSH or *" required /></label>
          <label>Languages<textarea name="languages" rows={2} defaultValue="English" required /></label>
          <label>Jurisdictions<textarea name="jurisdictions" rows={2} defaultValue="GLOBAL" required /></label>
          <label>Risk levels<textarea name="riskLevels" rows={2} defaultValue={"STANDARD\nHIGH\nCRITICAL"} required /></label>
          <label>Available weekdays (0–6, comma separated)<input name="availableWeekdays" placeholder="1,2,3,4,5" /></label>
          <label>Unavailable until<input name="unavailableUntil" type="datetime-local" /></label>
          <label><input name="unavailable" value="yes" type="checkbox" /> Temporarily unavailable</label>
          <label>Maximum active interviews<input name="maxActiveInterviews" type="number" min={1} max={100} defaultValue={8} required /></label>
          <label>Status<select name="status" defaultValue="ACTIVE"><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option></select></label>
          <button className="button button-primary" type="submit">Save matching profile</button>
        </form>
        <p className="muted-copy">
          A current framework calibration is still required separately under Staff calibration. A matching profile alone cannot make an Assessor eligible.
        </p>
      </section>

      <section className="surface-card">
        <h2>Current matching profiles</h2>
        {profiles.length === 0 ? <p>No matching profiles are configured.</p> : (
          <div className="data-table-wrap"><table className="data-table">
            <thead><tr><th>Assessor</th><th>Status</th><th>Languages</th><th>Jurisdictions</th><th>Risk</th><th>Capacity</th></tr></thead>
            <tbody>{profiles.map((row) => (
              <tr key={row.assessorAccountId}>
                <td>{row.displayName}<br /><span className="muted-copy">{row.email}</span></td>
                <td>{row.status}</td>
                <td>{row.languages.join(", ")}</td>
                <td>{row.jurisdictions.join(", ")}</td>
                <td>{row.riskLevels.join(", ")}</td>
                <td>{row.maxActiveInterviews}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className="surface-card">
        <h2>Unassigned interview requests</h2>
        {unassigned.length === 0 ? <p>No interview request is waiting for assignment.</p> : (
          <div className="record-list">
            {unassigned.map((row) => (
              <article className="record-row" key={row.interviewRequestId}>
                <div>
                  <h3>{row.workerName}</h3>
                  <p>{row.riskLevel} · {row.language} · {row.jurisdiction}</p>
                  <p className="muted-copy"><code>{row.interviewRequestId}</code></p>
                </div>
                <form action={runAssessorMatchingAction}>
                  <input type="hidden" name="interviewRequestId" value={row.interviewRequestId} />
                  <button className="button button-primary" type="submit">Run automatic match</button>
                </form>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
