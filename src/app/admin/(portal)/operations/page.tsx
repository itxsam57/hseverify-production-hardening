import Link from "next/link";
import { listAuthorizedPlatformAuditEvents } from "@/lib/audit/audit-service";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getOperationalHealthSnapshot } from "@/lib/admin/operational-health-service";
import { getProviderHealth } from "@/lib/integrations/provider-health-domain";
import { runLocalRecoveryCertificationFixture } from "@/lib/operations/certification-readiness-domain";
import { getProductionLaunchService } from "@/lib/operations/production-launch-service";
import { updateProductionLaunchCheckAction } from "./actions";

export default async function AdminOperationsPage({
  searchParams
}: {
  searchParams: Promise<{ result?: string }>;
}): Promise<React.JSX.Element> {
  const principal = await requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.operations.manage"
  });
  const { result } = await searchParams;
  const events = await listAuthorizedPlatformAuditEvents({
    expectedRole: "admin",
    options: { limit: 10 }
  });
  const health = await getOperationalHealthSnapshot();
  const providers = getProviderHealth();
  const certification = runLocalRecoveryCertificationFixture();
  const release = await (await getProductionLaunchService()).getReadiness(principal);

  return (
    <section className="page-stack">
      <h1>Admin operations health</h1>
      <p>Operational visibility uses existing authorization and audit boundaries.</p>
      <nav aria-label="Admin operational areas">
        <ul>
          <li><a href="/admin/staff">Users</a></li>
          <li><Link href="/admin/company-verifications">Companies and cases</Link></li>
          <li><a href="/admin/frameworks">Rules and policy</a></li>
          <li><a href="/admin/question-bank">Calibration inputs</a></li>
          <li><a href="/admin/notifications">Audit and notifications</a></li>
          <li><a href="/admin/certifications">Certification records</a></li>
        </ul>
      </nav>
      <h2>Platform health</h2>
      <p aria-label="platform-health-status">Status: {health.status}</p>
      <ul>
        <li>Users: {health.users}</li>
        <li>Companies: {health.companies}</li>
        <li>Cases: {health.cases}</li>
        <li>Rules: {health.rules}</li>
        <li>Calibrations: {health.calibrations}</li>
        <li>Integrations: {health.integrations}</li>
        <li>Audit events: {health.auditEvents}</li>
      </ul>
      <h2>Load, security and recovery certification</h2>
      <p aria-label="certification-status">Certification: {certification.status}</p>
      <ul>
        {certification.drills.map((drill) => (
          <li key={drill.name}>{drill.name}: {drill.status} — {drill.evidence}</li>
        ))}
      </ul>
      <h2>Provider integrations</h2>
      <ul>
        {providers.map((provider) => (
          <li key={provider.provider}>
            {provider.provider}: {provider.status} ({provider.mode}) — {provider.reason}
          </li>
        ))}
      </ul>
      <h2>Production launch and operational handover</h2>
      <p aria-label="release-readiness-status">Release readiness: {release.status}</p>
      {result === "updated" ? <p role="status">Handover check saved.</p> : null}
      {result === "conflict" ? (
        <p role="alert">Handover state changed in another session. Review the latest values and try again.</p>
      ) : null}
      {result === "invalid" ? <p role="alert">Handover update was invalid.</p> : null}
      <ul aria-label="Production handover checks">
        {release.checks.map((check) => (
          <li key={check.name} data-handover-check={check.name}>
            <form action={updateProductionLaunchCheckAction}>
              <strong>{check.name}</strong>{" "}
              <span aria-label={`${check.name} current status`}>{check.status}</span>{" "}
              <span aria-label={`${check.name} revision`}>Revision {check.revision}</span>
              <input type="hidden" name="checkName" value={check.name} />
              <input type="hidden" name="expectedRevision" value={check.revision} />
              <label>
                Status
                <select name="status" aria-label={`${check.name} handover status`} defaultValue={check.status}>
                  <option value="pending">Pending</option>
                  <option value="passed">Passed</option>
                  <option value="failed">Failed</option>
                </select>
              </label>
              <button type="submit">Save {check.name} handover</button>
            </form>
          </li>
        ))}
      </ul>
      <h2>Recent platform audit events</h2>
      <ul>
        {events.map((event) => (
          <li key={event.auditEventId}>
            {event.sourceKind} — {event.action} — {event.outcome}
          </li>
        ))}
      </ul>
    </section>
  );
}
