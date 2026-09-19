import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { CertificationRecordRepository } from "@/lib/credential/certification-record-repository";
import { createCertificationRecordAction } from "./actions";

export default async function CertificationsPage(): Promise<React.JSX.Element> {
  await requirePlatformPermission({ expectedRole: "admin", permission: "platform.operations.manage" });
  const records = await new CertificationRecordRepository().list();
  return <section className="page-stack">
    <h1>Certification records</h1>
    <form action={createCertificationRecordAction}>
      <label>Credential ID<input name="credentialId" /></label>
      <label>Worker ID<input name="workerId" /></label>
      <label>Qualification<input name="qualification" /></label>
      <label>Decision reason<input name="reason" /></label>
      <button type="submit">Create certification record</button>
    </form>
    <ul>{records.map((record) => <li key={record.certificationId}>{record.qualification} — {record.status}</li>)}</ul>
  </section>;
}
