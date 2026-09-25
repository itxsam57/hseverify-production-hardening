import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { CertificationRecordRepository } from "@/lib/credential/certification-record-repository";
import { createCertificationRecordAction } from "./actions";

export default async function CertificationsPage(): Promise<React.JSX.Element> {
  await requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.operations.manage"
  });
  const records = await new CertificationRecordRepository().list();

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Credential operations</p>
          <h1>Certification records</h1>
          <p>
            Record the auditable certification outcome linked to a Worker and Credential.
          </p>
        </div>
      </div>

      <form action={createCertificationRecordAction}>
        <h2>Create certification record</h2>
        <label>
          Credential ID
          <input
            name="credentialId"
            placeholder="Credential ID"
            required
            minLength={3}
            maxLength={240}
          />
        </label>
        <label>
          Worker ID
          <input
            name="workerId"
            placeholder="Worker ID"
            required
            minLength={3}
            maxLength={240}
          />
        </label>
        <label>
          Qualification
          <input
            name="qualification"
            placeholder="Qualification"
            required
            minLength={2}
            maxLength={240}
          />
        </label>
        <label>
          Decision reason
          <textarea
            name="reason"
            placeholder="Decision reason"
            required
            minLength={5}
            maxLength={4000}
            rows={4}
          />
        </label>
        <button type="submit">Create certification record</button>
      </form>

      <section aria-labelledby="certification-history-heading">
        <h2 id="certification-history-heading">Recorded certifications</h2>
        {records.length === 0 ? (
          <div className="empty-state">
            <h3>No certification records</h3>
            <p>Finalized certification decisions will appear here.</p>
          </div>
        ) : (
          <div className="record-list">
            {records.map((record) => (
              <article className="record-row" key={record.certificationId}>
                <div>
                  <h3>{record.qualification}</h3>
                  <p>Credential: {record.credentialId} · Worker: {record.workerId}</p>
                </div>
                <span className="status-badge status-positive">{record.status}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
