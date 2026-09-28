import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { getStaffCalibrationService } from "@/lib/review/staff-calibration-service";

export default async function VerifierCalibrationPage(): Promise<React.JSX.Element> {
  const principal = await requirePortalAuthorization("verifier");
  const items = await getStaffCalibrationService().listOwn(principal);
  return (
    <div className="dashboard-page">
      <header className="page-heading-row"><div><p className="eyebrow">Quality control</p><h1>Calibration</h1><p className="page-intro">Only current framework calibration represents live assignment eligibility.</p></div></header>
      <section className="surface-card">
        {items.length === 0 ? <p className="status-banner status-warning">No calibration record is assigned to this Verifier account.</p> : (
          <div className="record-list">{items.map((item) => <article className="record-row" key={item.calibrationId}><div><h2>{item.frameworkReference}</h2><p>{item.status} · valid until {new Date(item.validUntil).toLocaleString()}</p><p>{item.note}</p></div></article>)}</div>
        )}
      </section>
    </div>
  );
}
