import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { getInterviewEmailHealth } from "@/lib/email-delivery/interview-email-health-service";
import { getServerEnvironment } from "@/lib/config/server-environment";
import { listAuthorizedPlatformAuditEvents } from "@/lib/audit/audit-service";
import { requirePlatformPermission } from "@/lib/authorization/authorization-service";
import { getOperationalHealthSnapshot } from "@/lib/admin/operational-health-service";
import { getProviderHealth } from "@/lib/integrations/provider-health-domain";
import { buildCertificationSnapshot, buildEmptyCertificationSnapshot } from "@/lib/operations/certification-readiness-domain";
import { CertificationReadinessRepository } from "@/lib/operations/certification-readiness-repository";
import { getProductionLaunchService } from "@/lib/operations/production-launch-service";
import { updateProductionLaunchCheckAction, retryInterviewEmailsAction } from "./actions";

export default async function AdminOperationsPage({
  searchParams
}: {
  searchParams: Promise<{ result?: string; emailRetry?: string }>;
}): Promise<React.JSX.Element> {
  const principal = await requirePlatformPermission({
    expectedRole: "admin",
    permission: "platform.operations.manage"
  });
  const { result, emailRetry } = await searchParams;
  const events = await listAuthorizedPlatformAuditEvents({
    expectedRole: "admin",
    options: { limit: 10 }
  });
  const health = await getOperationalHealthSnapshot();
  const environment = getServerEnvironment();
  const providers = getProviderHealth(environment);
  const registrationProviders = environment.registrationOtpProviders;
  const emailConfigured = Boolean(registrationProviders?.emailApiKey && registrationProviders?.emailFrom && environment.publicBaseUrl);
  const emailHealth = await getInterviewEmailHealth(principal);
  const certificationRows = await new CertificationReadinessRepository().list();
  const certification = certificationRows.length > 0
    ? buildCertificationSnapshot(certificationRows)
    : buildEmptyCertificationSnapshot();
  const release = await (await getProductionLaunchService()).getReadiness(principal);

  return (
    <section className="page-stack">
      <h1>Admin operations health</h1>
      <p>Operational visibility uses existing authorization and audit boundaries.</p>
      <nav aria-label="Admin operational areas">
        <ul>
          <li><a href="/admin/staff">Users</a></li>
          <li><Link href="/admin/operations/integrity-reviews">Integrity review escalations</Link> <Link href="/admin/operations/review-escalations">Evidence review escalations</Link></li>
          <li><Link href="/admin/operations/scoring-assignments">Assessment review assignments</Link></li>
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
      <p>Configuration and local test adapters do not confirm live availability or delivery. No provider check is performed by this page.</p>
      <p>Email and SMS configuration covers registration delivery; interview email also requires the public site URL. Foundation email uses a separate local test adapter. Video uses built-in browser calling; camera, microphone and network/TURN connectivity require a separate check. Preview and production scanning selects ClamAV; executable and signature availability require a scan.</p>
      <ul aria-label="Provider integrations">
        {providers.map((provider) => (
          <li key={provider.provider}>
            {provider.provider}: {provider.status} ({provider.mode}) — {provider.reason}. Live availability: not checked.
          </li>
        ))}
      </ul>
      <section aria-labelledby="interview-email-health-heading">
        <h2 id="interview-email-health-heading">Interview email delivery</h2>
        <p>Configuration: {emailConfigured ? "Configured" : "Not configured"} (Resend)</p>
        <p>Configuration does not confirm provider availability or inbox delivery.</p>
        <ul aria-label="Interview email queue">
          <li>Queued: {emailHealth.queued}</li>
          <li>Sending: {emailHealth.processing}</li>
          <li>Retrying: {emailHealth.retrying}</li>
          <li>Sent: {emailHealth.sent}</li>
          <li>Failed: {emailHealth.failed}</li>
          <li>Suppressed: {emailHealth.suppressed}</li>
          <li>Queue depth: {emailHealth.queueDepth}</li>
        </ul>
        <dl className="compact-definition-list">
          <div><dt>Last provider acceptance</dt><dd>{emailHealth.lastAcceptedAt ? formatDateTime(emailHealth.lastAcceptedAt) : "None recorded"}</dd></div>
          <div><dt>Completed send attempts (accepted or failed) in the last 24 hours</dt><dd>{emailHealth.completedAttempts24h}</dd></div>
          <div><dt>Failed attempts in the last 24 hours</dt><dd>{emailHealth.failedAttempts24h}</dd></div>
          <div><dt>Attempt failure rate in the last 24 hours</dt><dd>{emailHealth.failureRate24h === null ? "No completed attempts" : Math.round(emailHealth.failureRate24h * 100) + "%"}</dd></div>
          <div><dt>Next scheduled retry</dt><dd>{emailHealth.nextRetryAt ? formatDateTime(emailHealth.nextRetryAt) : "None scheduled"}</dd></div>
          <div><dt>Delivery confirmation</dt><dd>Unavailable</dd></div>
          <div><dt>Credential expiry</dt><dd>Not reported by provider</dd></div>
          <div><dt>Circuit breaker</dt><dd>Not configured</dd></div>
        </dl>
        <p>Attempt totals count accepted and failed outcomes, excluding suppressed and expired-lease attempts. Failed attempts can include missing configuration or unconfirmed sends.</p>
        <p>Sent records show provider acceptance. Inbox delivery is not confirmed. Retries follow the outbox schedule.</p>
        <p>Eligible delayed retries: {emailHealth.eligibleRetries}. Manual retry keeps the original job, provider key and attempt limit. The worker checks current recipient access before sending.</p>
        <form action={retryInterviewEmailsAction}>
          <button type="submit" disabled={!emailConfigured || emailHealth.eligibleRetries === 0}>Retry interview emails now</button>
        </form>
        {!emailConfigured ? <p>Configure email delivery before requesting a retry.</p> : null}
        {emailRetry === "retry-requested" ? <p role="status">Eligible retries are available to the worker now.</p> : null}
        {emailRetry === "retry-idle" ? <p role="status">No eligible delayed retries remain.</p> : null}
        {emailRetry === "retry-unavailable" ? <p role="alert">Email delivery is not configured. No retry was requested.</p> : null}
      </section>
      <h2>Registration verification delivery</h2>
      <ul aria-label="Registration delivery configuration">
        <li>Email: {registrationProviders?.emailApiKey && registrationProviders.emailFrom ? "Configured" : "Unavailable"}</li>
        <li>SMS: {registrationProviders?.smsAccountSid && registrationProviders.smsAuthToken && registrationProviders.smsFrom ? "Configured" : "Unavailable"}</li>
      </ul>
      <p>Provider configuration enables queued verification messages. Delivery to a real inbox or phone requires a separate delivery check.</p>
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
