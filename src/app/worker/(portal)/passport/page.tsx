import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { requireWorkerSession } from "@/lib/auth/worker-session";
import { getDatabaseClient } from "@/lib/database/database";
import {
  buildDigitalPassport,
  currentLivingCompetencyVersion,
  livingCompetencyFromWorkerSkill,
  type PassportEmployment,
  type PassportQualification,
  type PassportSkill
} from "@/lib/living-record/living-record-domain";
import type {
  EmploymentDetails,
  QualificationDetails,
  SkillDetails,
  WorkerEvidenceRecord
} from "@/lib/worker-evidence/worker-evidence-domain";
import { WorkerEvidenceService } from "@/lib/worker-evidence/worker-evidence-service";
import { LivingRecordRepository } from "@/lib/living-record/living-record-repository";

export const dynamic = "force-dynamic";

function qualification(record: WorkerEvidenceRecord): PassportQualification | null {
  if (record.kind !== "qualification") return null;
  const details = record.currentVersion.details as QualificationDetails;
  if (!details.title) return null;
  return {
    recordId: record.recordId,
    title: details.title,
    issuingOrganization: details.issuingOrganization,
    level: details.level,
    issueDate: details.issueDate,
    expiryDate: details.expiryDate,
    recordStatus: record.currentVersion.status
  };
}

function skill(record: WorkerEvidenceRecord): PassportSkill | null {
  if (record.kind !== "skill") return null;
  const details = record.currentVersion.details as SkillDetails;
  if (!details.skillName) return null;
  return {
    recordId: record.recordId,
    name: details.skillName,
    category: details.category,
    assuranceStatus: details.assuranceStatus
  };
}

function employment(record: WorkerEvidenceRecord): PassportEmployment | null {
  if (record.kind !== "employment") return null;
  const details = record.currentVersion.details as EmploymentDetails;
  if (!details.companyName) return null;
  return {
    recordId: record.recordId,
    companyName: details.companyName,
    roleTitle: details.roleTitle,
    startDate: details.startDate,
    endDate: details.endDate,
    status: details.status
  };
}

function compact<T>(values: readonly (T | null)[]): T[] {
  return values.filter((value): value is T => value !== null);
}

export default async function WorkerPassportPage(): Promise<React.JSX.Element> {
  const [principal, session] = await Promise.all([
    requirePortalAuthorization("worker"),
    requireWorkerSession()
  ]);
  const evidence = new WorkerEvidenceService(getDatabaseClient());
  const records = await evidence.listCurrent(principal);
  const livingRecords = await new LivingRecordRepository().findByWorker(session.workerId);
  const passport = buildDigitalPassport({
    workerId: session.workerId,
    generatedAt: new Date().toISOString(),
    qualifications: compact(records.map(qualification)),
    skills: compact(records.map(skill)),
    employmentHistory: compact(records.map(employment)),
    competencies: [
      ...compact(records.map(livingCompetencyFromWorkerSkill)),
      ...livingRecords
    ]
  });

  return (
    <section className="profile-page" aria-labelledby="digital-passport-heading">
      <div className="profile-page-heading">
        <div>
          <p className="section-kicker">Digital competency passport</p>
          <h1 id="digital-passport-heading">Living Record</h1>
          <p className="profile-page-intro">
            Your passport brings together your Worker ID, qualification and skill records,
            employment history, current competency status, restrictions, expiry and reassessment.
            Historical Living Record versions are retained when status changes.
          </p>
        </div>
      </div>

      <section className="dashboard-section" aria-labelledby="passport-identity-heading">
        <h2 id="passport-identity-heading">Passport identity</h2>
        <dl className="compact-definition-list">
          <div><dt>Worker ID</dt><dd>{passport.workerId}</dd></div>
          <div><dt>Generated</dt><dd>{passport.generatedAt}</dd></div>
        </dl>
      </section>

      <section className="dashboard-section" aria-labelledby="passport-qualification-heading">
        <h2 id="passport-qualification-heading">Qualifications</h2>
        {passport.qualifications.length ? (
          <div className="table-scroll-region" role="region" aria-label="Qualification passport records" tabIndex={0}>
            <table>
              <thead><tr><th>Qualification</th><th>Issuer</th><th>Status</th><th>Expiry</th></tr></thead>
              <tbody>
                {passport.qualifications.map((item) => (
                  <tr key={item.recordId}>
                    <td>{item.title}</td>
                    <td>{item.issuingOrganization ?? "Not recorded"}</td>
                    <td>{item.recordStatus.replaceAll("_", " ")}</td>
                    <td>{item.expiryDate ?? "No expiry recorded"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty-state"><p>No qualification records yet.</p></div>}
      </section>

      <section className="dashboard-section" aria-labelledby="passport-competency-heading">
        <h2 id="passport-competency-heading">Skills and competencies</h2>
        {passport.skills.length ? (
          <ul className="timeline-list">
            {passport.skills.map((item) => (
              <li key={item.recordId}>
                <strong>{item.name}</strong>
                <p>{item.category ?? "Uncategorised"} · {item.assuranceStatus.replaceAll("_", " ")}</p>
              </li>
            ))}
          </ul>
        ) : <div className="empty-state"><p>No skill records yet.</p></div>}
        {passport.competencies.length ? (
          <ul className="timeline-list" aria-label="Assessed competencies">
            {passport.competencies.map((item) => {
              const current = currentLivingCompetencyVersion(item);
              return (
                <li key={item.competencyId}>
                  <strong>{item.title}</strong>
                  <p>
                    {current.status.replaceAll("_", " ")}
                    {current.expiresAt ? ` · expires ${current.expiresAt}` : " · no expiry recorded"}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="implementation-boundary-note">
            No issued competency Living Record is currently linked to this Worker account.
          </p>
        )}
      </section>

      <section className="dashboard-section" aria-labelledby="passport-status-heading">
        <h2 id="passport-status-heading">Restrictions, expiry and reassessment</h2>
        <dl className="compact-definition-list">
          <div>
            <dt>Current restrictions</dt>
            <dd>{passport.activeRestrictions.length ? passport.activeRestrictions.join(", ") : "None recorded"}</dd>
          </div>
          <div>
            <dt>Current conditions</dt>
            <dd>{passport.activeConditions.length ? passport.activeConditions.join(", ") : "None recorded"}</dd>
          </div>
          <div><dt>Next competency expiry</dt><dd>{passport.nextExpiryAt ?? "None recorded"}</dd></div>
          <div><dt>Reassessment items</dt><dd>{passport.reassessments.length}</dd></div>
        </dl>
      </section>

      <section className="dashboard-section" aria-labelledby="passport-employment-heading">
        <h2 id="passport-employment-heading">Employment history</h2>
        {passport.employmentHistory.length ? (
          <ul className="timeline-list">
            {passport.employmentHistory.map((item) => (
              <li key={item.recordId}>
                <strong>{item.companyName}</strong>
                <p>{item.roleTitle ?? "Role not recorded"} · {item.startDate ?? "Unknown start"} → {item.endDate ?? "Present"}</p>
              </li>
            ))}
          </ul>
        ) : <div className="empty-state"><p>No employment records yet.</p></div>}
      </section>

      <section className="dashboard-section" aria-labelledby="passport-history-heading">
        <h2 id="passport-history-heading">Living Record history</h2>
        {passport.history.length ? (
          <ol className="timeline-list">
            {passport.history.map((item) => (
              <li key={`${item.competencyId}-${item.version}`}>
                <strong>{item.title}</strong>
                <p>Version {item.version} · {item.status.replaceAll("_", " ")} · {item.effectiveAt}</p>
              </li>
            ))}
          </ol>
        ) : <div className="empty-state"><p>No Living Record status history yet.</p></div>}
      </section>
    </section>
  );
}
