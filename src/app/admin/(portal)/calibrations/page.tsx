import { recordStaffCalibrationAction } from "./actions";
import Link from "next/link";
import { getEvidenceReviewFrameworkService } from "@/lib/review/evidence-review-framework-service";

import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { getStaffCalibrationService } from "@/lib/review/staff-calibration-service";

export default async function AdminCalibrationsPage({
  searchParams
}: {
  searchParams: Promise<{ result?: string; error?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const principal = await requirePortalAuthorization("admin");
  const service = getStaffCalibrationService();
  const [staff, calibrations, frameworks] = await Promise.all([
    service.listStaff(principal),
    service.listAll(principal),
    getEvidenceReviewFrameworkService().listFrameworks(principal)
  ]);
  return (
    <div className="dashboard-page">
      <header className="page-heading-row"><div>
        <p className="eyebrow">Review quality</p>
        <h1>Staff calibration</h1>
        <p className="page-intro">
          Record framework-specific calibration for Verifiers and Assessors. Expired, failed or suspended calibration is not current assignment authority.
        </p>
      </div></header>
      {params.result === "recorded" ? <p className="status-banner status-success" role="status">Calibration recorded.</p> : null}
      {params.error ? <p className="status-banner status-error" role="alert">{params.error}</p> : null}
      <p><Link href="/admin/review-frameworks">Resolve evidence-review framework bindings</Link></p>
      <section className="surface-card">
        <h2>Record calibration</h2>
        <form action={recordStaffCalibrationAction} className="form-grid">
          <label>Staff member<select name="accountId" required defaultValue="">
            <option value="" disabled>Select staff</option>
            {staff.map((item) => <option key={item.accountId + item.role} value={item.accountId}>{item.displayName} · {item.role} · {item.email}</option>)}
          </select></label>
          <label>Role<select name="role" defaultValue="verifier"><option value="verifier">Verifier</option><option value="assessor">Assessor</option></select></label>
          <label>Framework reference<select name="frameworkReference" required defaultValue=""><option value="" disabled>Select authoritative framework</option>{Array.from(new Set(frameworks.map(item=>item.frameworkReference))).map(reference=><option key={reference} value={reference}>{reference}</option>)}</select></label>
          <label>Framework revision<select name="frameworkVersionId" required defaultValue=""><option value="" disabled>Select revision</option>{frameworks.map(item=><option key={item.frameworkVersionId} value={item.frameworkVersionId}>{item.frameworkReference} · version {item.versionNo} · {item.title}</option>)}</select></label>
          <label>Status<select name="status" defaultValue="CURRENT"><option value="CURRENT">Current</option><option value="FAILED">Failed</option><option value="SUSPENDED">Suspended</option><option value="EXPIRED">Expired</option></select></label>
          <label>Valid from<input name="validFrom" type="datetime-local" required /></label>
          <label>Valid until<input name="validUntil" type="datetime-local" required /></label>
          <label>Calibration evidence / note<textarea name="note" minLength={5} maxLength={2000} rows={4} required /></label>
          <button className="button button-primary" type="submit">Record calibration</button>
        </form>
      </section>
      <section className="surface-card">
        <h2>Calibration history</h2>
        {calibrations.length === 0 ? <p>No calibration records yet.</p> : (
          <div className="data-table-wrap"><table className="data-table">
            <thead><tr><th>Staff</th><th>Role</th><th>Framework</th><th>Status</th><th>Valid until</th><th>Recorded by</th></tr></thead>
            <tbody>{calibrations.map((item) => <tr key={item.calibrationId}>
              <td>{item.displayName}</td><td>{item.role}</td><td>{item.frameworkReference}</td>
              <td>{item.status}</td><td>{new Date(item.validUntil).toLocaleString()}</td><td>{item.recordedBy}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
