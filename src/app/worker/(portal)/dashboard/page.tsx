import Link from "next/link";

import { CopyWorkerId } from "@/components/worker/copy-worker-id";
import { StatusBadge } from "@/components/worker/status-badge";
import { requireWorkerSession } from "@/lib/auth/worker-session";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { getNotificationMenu } from "@/lib/notifications/notification-service";
import { getWorkerDashboardProjection } from "@/lib/worker/dashboard-repository";
import type {
  DashboardTone,
  VerificationStatus,
  WorkerDashboardProjection
} from "@/lib/worker/dashboard-types";

export const metadata = {
  title: "Worker Dashboard"
};

function identityTone(status: VerificationStatus): DashboardTone {
  switch (status) {
    case "verified":
      return "positive";
    case "pending":
      return "warning";
    case "changes_requested":
    case "unable_to_verify":
    case "rejected":
      return "critical";
    default:
      return "neutral";
  }
}

function countExpiringCredentials(projection: WorkerDashboardProjection): number {
  return projection.credentials.filter((credential) => credential.status === "expiring").length;
}

function assessmentStatusLabel(status: WorkerDashboardProjection["assessments"][number]["status"]): string {
  return status.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

export default async function WorkerDashboardPage(): Promise<React.JSX.Element> {
  const session = await requireWorkerSession();
  const [dashboard, notificationMenu] = await Promise.all([
    getWorkerDashboardProjection(session),
    getNotificationMenu("worker")
  ]);
  const unreadNotifications = notificationMenu.unreadCount;
  const expiringCredentials = countExpiringCredentials(dashboard);
  const primaryCase = dashboard.assuranceCases[0] ?? null;

  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Worker Dashboard</p>
          <h1>Welcome, {dashboard.worker.displayName}</h1>
          <p className="page-intro">
            Review your verified record, active assurance work and the next action required from you.
          </p>
        </div>
        <p className="projection-time">
          Updated <time dateTime={dashboard.generatedAt}>{formatDateTime(dashboard.generatedAt)}</time>
        </p>
      </header>

      <section className="worker-identity-banner" aria-labelledby="worker-id-heading">
        <div>
          <p className="section-kicker" id="worker-id-heading">Permanent Worker ID</p>
          <p className="worker-id-value">{dashboard.worker.id}</p>
          <p className="muted-copy">Use this identifier when linking with an employer or verifying an approved public record.</p>
        </div>
        <div className="worker-id-actions">
          <CopyWorkerId workerId={dashboard.worker.id} />
          {dashboard.worker.publicProfileAvailable ? (
            <Link
              className="button button-secondary button-small"
              href={`/verify/worker/${encodeURIComponent(dashboard.worker.id)}`}
              target="_blank"
              rel="noreferrer"
            >
              View public profile
            </Link>
          ) : null}
        </div>
      </section>

      <section className="metric-grid" aria-label="Worker status summary">
        <article className="metric-card">
          <div className="metric-card-heading">
            <span>Identity</span>
            <StatusBadge label={dashboard.identity.label} tone={identityTone(dashboard.identity.status)} />
          </div>
          <strong>{dashboard.identity.label}</strong>
          <p>{dashboard.identity.explanation}</p>
        </article>

        <article className="metric-card">
          <div className="metric-card-heading">
            <span>Profile completion</span>
            <span>{dashboard.worker.profileCompletion}%</span>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={dashboard.worker.profileCompletion}
            aria-label="Profile completion"
          >
            <span style={{ width: `${dashboard.worker.profileCompletion}%` }} />
          </div>
          <p>
            {dashboard.worker.profileCompletion === 100
              ? "All required profile fields are complete."
              : "The Worker Profile module will expose the exact incomplete fields in its build unit."}
          </p>
        </article>

        <article className="metric-card">
          <div className="metric-card-heading">
            <span>Current company</span>
            <StatusBadge
              label={dashboard.employment.linkStatus.replaceAll("_", " ")}
              tone={dashboard.employment.linkStatus === "active" ? "positive" : "neutral"}
            />
          </div>
          <strong>{dashboard.employment.companyName ?? "Not linked"}</strong>
          <p>
            {dashboard.employment.siteName
              ? `${dashboard.employment.siteName}${dashboard.employment.departmentName ? ` · ${dashboard.employment.departmentName}` : ""}`
              : "No active company, site or department relationship is recorded."}
          </p>
        </article>

        <article className="metric-card">
          <div className="metric-card-heading">
            <span>Qualifications</span>
            <span>{dashboard.evidence.verifiedQualifications} verified</span>
          </div>
          <strong>{dashboard.evidence.pendingQualifications} pending review</strong>
          <p>{dashboard.evidence.changesRequested} submission(s) currently need changes.</p>
          <Link className="button button-secondary button-small" href="/worker/evidence">
            Manage evidence
          </Link>
        </article>

        <article className="metric-card">
          <div className="metric-card-heading">
            <span>Credentials</span>
            <span>{dashboard.credentials.length} total</span>
          </div>
          <strong>{expiringCredentials} expiring</strong>
          <p>Credential status is shown from the current Living Record projection.</p>
        </article>

        <article className="metric-card">
          <div className="metric-card-heading">
            <span>Notifications</span>
            <StatusBadge label={`${unreadNotifications} unread`} tone={unreadNotifications > 0 ? "warning" : "neutral"} />
          </div>
          <strong>{notificationMenu.notifications.length} recent</strong>
          <p>Notifications are persisted and scoped to this Worker Portal session.</p>
        </article>
      </section>

      <div className="dashboard-layout">
        <div className="dashboard-primary-column">
          <section className="dashboard-section" id="next-action" aria-labelledby="next-action-heading">
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Priority</p>
                <h2 id="next-action-heading">Next required action</h2>
              </div>
            </div>

            {primaryCase ? (
              <article className="next-action-card">
                <div>
                  <StatusBadge label={primaryCase.statusLabel} tone="warning" />
                  <h3>{primaryCase.title}</h3>
                  <p>{primaryCase.nextAction}</p>
                </div>
                <dl className="compact-definition-list">
                  <div>
                    <dt>Case</dt>
                    <dd>{primaryCase.reference}</dd>
                  </div>
                  <div>
                    <dt>Action owner</dt>
                    <dd>{primaryCase.nextActionOwner}</dd>
                  </div>
                  <div>
                    <dt>Last updated</dt>
                    <dd>{formatDateTime(primaryCase.updatedAt)}</dd>
                  </div>
                </dl>
                <p className="implementation-boundary-note">
                  The action destination is intentionally not exposed until its assessment, evidence or interview module has a complete backend contract.
                </p>
              </article>
            ) : (
              <div className="empty-state">
                <h3>No active Assurance Case</h3>
                <p>There is currently no worker-specific assurance workflow requiring action.</p>
              </div>
            )}
          </section>

          <section className="dashboard-section" id="cases" aria-labelledby="cases-heading">
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Assurance workflow</p>
                <h2 id="cases-heading">Status timeline</h2>
              </div>
            </div>

            {primaryCase ? (
              <ol className="timeline-list">
                {primaryCase.timeline.map((event) => (
                  <li className={`timeline-item timeline-${event.state}`} key={event.id}>
                    <span className="timeline-marker" aria-hidden="true" />
                    <div>
                      <div className="timeline-title-row">
                        <h3>{event.title}</h3>
                        {event.occurredAt ? (
                          <time dateTime={event.occurredAt}>{formatDate(event.occurredAt)}</time>
                        ) : (
                          <span>Upcoming</span>
                        )}
                      </div>
                      <p>{event.explanation}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="empty-state compact-empty-state">
                <p>A timeline appears after an individual application or company Assurance Order creates a case.</p>
              </div>
            )}
          </section>

          <section className="dashboard-section" id="assessments" aria-labelledby="assessments-heading">
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Knowledge and judgment</p>
                <h2 id="assessments-heading">Assessments</h2>
              </div>
            </div>

            {dashboard.assessments.length > 0 ? (
              <div className="record-list">
                {dashboard.assessments.map((assessment) => (
                  <article className="record-row" key={assessment.id}>
                    <div>
                      <h3>{assessment.title}</h3>
                      <p>{assessment.detail}</p>
                    </div>
                    <StatusBadge label={assessmentStatusLabel(assessment.status)} tone={assessment.tone} />
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state compact-empty-state">
                <h3>No available or assigned assessments</h3>
                <p>Eligibility will be calculated from verified qualifications, trade, experience, attempts, region and case policy.</p>
              </div>
            )}
          </section>

          <section className="dashboard-section" id="credentials" aria-labelledby="credentials-heading">
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Live outcomes</p>
                <h2 id="credentials-heading">Credentials and expiry</h2>
              </div>
            </div>

            {dashboard.credentials.length > 0 ? (
              <div className="record-list">
                {dashboard.credentials.map((credential) => (
                  <article className="record-row" key={credential.id}>
                    <div>
                      <h3>{credential.title}</h3>
                      <p>{credential.expiresAt ? `Expires ${formatDate(credential.expiresAt)}` : "No expiry recorded"}</p>
                    </div>
                    <StatusBadge
                      label={credential.status}
                      tone={credential.status === "active" ? "positive" : credential.status === "expiring" ? "warning" : "critical"}
                    />
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state compact-empty-state">
                <h3>No credentials issued</h3>
                <p>Credentials appear only after the relevant Assurance Case requirements are satisfied.</p>
              </div>
            )}
          </section>
        </div>

        <aside className="dashboard-secondary-column" aria-label="Additional worker status">
          <section className="dashboard-section" id="interview" aria-labelledby="interview-heading">
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Scheduled activity</p>
                <h2 id="interview-heading">Upcoming interview</h2>
              </div>
            </div>
            {dashboard.interview ? (
              <article className="side-record-card">
                <StatusBadge label={dashboard.interview.status.replaceAll("_", " ")} tone="warning" />
                <h3>{dashboard.interview.title}</h3>
                <p>{formatDateTime(dashboard.interview.startsAt)}</p>
                <p className="muted-copy">
                  The waiting-room control will become available only during the permitted schedule window.
                </p>
              </article>
            ) : (
              <div className="empty-state compact-empty-state">
                <p>No interview is currently scheduled.</p>
              </div>
            )}
          </section>

          <section className="dashboard-section" id="reassessment" aria-labelledby="reassessment-heading">
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Eligibility</p>
                <h2 id="reassessment-heading">Reassessment</h2>
              </div>
            </div>
            {dashboard.reassessments.length > 0 ? (
              <div className="side-stack">
                {dashboard.reassessments.map((reassessment) => (
                  <article className="side-record-card" key={reassessment.id}>
                    <StatusBadge label={reassessment.eligibleNow ? "Eligible now" : "Waiting period"} tone={reassessment.eligibleNow ? "positive" : "neutral"} />
                    <h3>{reassessment.title}</h3>
                    <p>Earliest date: {formatDate(reassessment.earliestDate)}</p>
                    <p className="muted-copy">
                      Attempts used: {reassessment.attemptsUsed}
                      {reassessment.attemptsRemaining === null ? "" : ` · Remaining: ${reassessment.attemptsRemaining}`}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state compact-empty-state">
                <p>No reassessment eligibility is currently recorded.</p>
              </div>
            )}
          </section>

          <section className="dashboard-section" id="notifications" aria-labelledby="notifications-heading">
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Recent updates</p>
                <h2 id="notifications-heading">Notifications</h2>
              </div>
              <Link className="button button-secondary button-small" href="/worker/notifications">
                View all
              </Link>
            </div>
            {notificationMenu.notifications.length > 0 ? (
              <ul className="dashboard-notification-list">
                {notificationMenu.notifications.map((notification) => (
                  <li key={notification.notificationId}>
                    <div>
                      <strong>{notification.title}</strong>
                      <span>{notification.body}</span>
                      <time dateTime={notification.createdAt}>{formatDateTime(notification.createdAt)}</time>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-state compact-empty-state">
                <p>No persisted notifications.</p>
              </div>
            )}
          </section>

          <section className="dashboard-section" id="appeals" aria-labelledby="appeals-heading">
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Decision review</p>
                <h2 id="appeals-heading">Appeals</h2>
              </div>
            </div>
            {dashboard.appeals.length > 0 ? (
              <div className="side-stack">
                {dashboard.appeals.map((appeal) => (
                  <article className="side-record-card" key={appeal.id}>
                    <StatusBadge label={appeal.status.replaceAll("_", " ")} />
                    <h3>{appeal.title}</h3>
                    <p>{appeal.reference}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state compact-empty-state">
                <p>No appeal is open or currently eligible.</p>
              </div>
            )}
          </section>

          <section className="dashboard-section" id="payments" aria-labelledby="payments-heading">
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Funding</p>
                <h2 id="payments-heading">Payments</h2>
              </div>
            </div>
            <article className="side-record-card">
              <StatusBadge
                label={dashboard.payments.recentStatus}
                tone={dashboard.payments.recentStatus === "failed" ? "critical" : dashboard.payments.recentStatus === "paid" ? "positive" : "neutral"}
              />
              <h3>{formatMoney(dashboard.payments.pendingAmount, dashboard.payments.currency)} pending</h3>
              <p className="muted-copy">Payment and company sponsorship details will be exposed by the dedicated funding module.</p>
            </article>
          </section>
        </aside>
      </div>
    </div>
  );
}
