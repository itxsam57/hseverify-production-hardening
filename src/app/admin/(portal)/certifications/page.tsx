import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { CertificationRecordRepository } from "@/lib/credential/certification-record-repository";
import { createCertificationRecordAction } from "./actions";

export default async function CertificationsPage(): Promise<React.JSX.Element> {
  await requirePlatformPermission({ expectedRole: "admin", permission: "platform.operations.manage" });
  const records = await new CertificationRecordRepository().list();
  return <section className="page-stack">
    <h1>Certification records</h1>
    <form action={createCertificationRecordAction}>
      <input name="credentialId" placeholder="Credential ID" />
      <input name="workerId" placeholder="Worker ID" />
      <input name="qualification" placeholder="Qualification" />
      <input name="reason" placeholder="Decision reason" />
      <button type="submit">Create certification record</button>
    </form>
    <ul>{records.map((record) => <li key={record.certificationId}>{record.qualification} — {record.status}</li>)}</ul>
  </section>;
}
