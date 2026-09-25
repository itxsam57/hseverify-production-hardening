import Link from "next/link";

import { requireRoleSession } from "@/lib/auth/auth-session-service";
import { getDatabaseClient } from "@/lib/database/database";
import { getNotificationMenu } from "@/lib/notifications/notification-service";

type MembershipRow = {
  tenant_id: string;
  display_name: string;
  tenant_status: string;
  verification_status: string | null;
};

type SummaryRow = {
  active_workers: number | string;
  total_orders: number | string;
  active_orders: number | string;
  active_cases: number | string;
  attention_cases: number | string;
  open_actions: number | string;
  sites: number | string;
  departments: number | string;
};

type RecentOrderRow = {
  order_id: string;
  order_reference: string;
  order_name: string;
  order_status: string;
  updated_at: string | Date;
};

type RecentCaseRow = {
  case_id: string;
  order_id: string;
  order_reference: string;
  order_name: string;
  permanent_worker_id: string | null;
  case_status: string;
  owner_kind: string | null;
  next_action: string | null;
  updated_at: string | Date;
};

function count(value: number | string | undefined): number {
  return Number(value ?? 0);
}

function verificationTone(status: string | null): string {
  if (status === "verified") return "status-positive";
  if (status === "rejected" || status === "changes_requested") return "status-critical";
  if (status === "submitted" || status === "under_review") return "status-warning";
  return "status-neutral";
}

export default async function CompanyDashboardPage(): Promise<React.JSX.Element> {
  const session = await requireRoleSession("company");
  const database = await getDatabaseClient();

  const membershipResult = await database.query<MembershipRow>(
    `SELECT memberships.tenant_id,
            tenants.display_name,
            tenants.tenant_status,
            verification.case_status AS verification_status
       FROM auth_tenant_memberships AS memberships
       JOIN platform_tenants AS tenants
         ON tenants.tenant_id=memberships.tenant_id
       LEFT JOIN company_verification_cases AS verification
         ON verification.tenant_id=memberships.tenant_id
      WHERE memberships.account_id=$1
        AND memberships.portal_role='company'
        AND memberships.membership_status='active'
      ORDER BY memberships.activated_at DESC NULLS LAST, memberships.created_at DESC
      LIMIT 1`,
    [session.accountId]
  );
  const membership = membershipResult.rows[0] ?? null;
  const notificationMenu = await getNotificationMenu("company");

  if (!membership) {
    return (
      <div className="dashboard-page">
        <header className="page-heading-row">
          <div>
            <p className="eyebrow">Company Portal</p>
            <h1>Welcome, {session.displayName}</h1>
            <p className="page-intro">
              This account has no active Company tenant membership. Complete or recover Company verification before operating workforce assurance.
            </p>
          </div>
        </header>
        <section className="dashboard-section">
          <h2>Company access is not active</h2>
          <Link className="button button-primary" href="/company/settings/profile">
            Open Company verification
          </Link>
        </section>
      </div>
    );
  }

  const tenantId = membership.tenant_id;
  const [summaryResult, ordersResult, casesResult] = await Promise.all([
    database.query<SummaryRow>(
      `SELECT
         (SELECT COUNT(*) FROM company_worker_links WHERE tenant_id=$1 AND link_status='active')::int AS active_workers,
         (SELECT COUNT(*) FROM assurance_orders WHERE tenant_id=$1)::int AS total_orders,
         (SELECT COUNT(*) FROM assurance_orders WHERE tenant_id=$1 AND order_status NOT IN ('COMPLETED','CANCELLED','CLOSED'))::int AS active_orders,
         (SELECT COUNT(*) FROM assurance_cases WHERE tenant_id=$1 AND case_status <> 'Closed')::int AS active_cases,
         (SELECT COUNT(*) FROM assurance_cases WHERE tenant_id=$1 AND case_status IN ('Reassessment required','Rejected','Suspended'))::int AS attention_cases,
         (SELECT COUNT(*) FROM assurance_action_items WHERE tenant_id=$1 AND action_status <> 'resolved')::int AS open_actions,
         (SELECT COUNT(*) FROM company_sites WHERE tenant_id=$1 AND site_status='active')::int AS sites,
         (SELECT COUNT(*) FROM company_departments WHERE tenant_id=$1 AND department_status='active')::int AS departments`,
      [tenantId]
    ),
    database.query<RecentOrderRow>(
      `SELECT order_id,order_reference,order_name,order_status,updated_at
         FROM assurance_orders
        WHERE tenant_id=$1
        ORDER BY updated_at DESC, order_id DESC
        LIMIT 6`,
      [tenantId]
    ),
    database.query<RecentCaseRow>(
      `SELECT cases.case_id,
              cases.order_id,
              orders.order_reference,
              orders.order_name,
              cases.permanent_worker_id,
              cases.case_status,
              cases.owner_kind,
              cases.next_action,
              cases.updated_at
         FROM assurance_cases AS cases
         JOIN assurance_orders AS orders
           ON orders.order_id=cases.order_id
          AND orders.tenant_id=cases.tenant_id
        WHERE cases.tenant_id=$1
        ORDER BY
          CASE WHEN cases.case_status IN ('Approved','Conditionally approved','Rejected','Closed') THEN 1 ELSE 0 END,
          cases.updated_at DESC
        LIMIT 8`,
      [tenantId]
    )
  ]);

  const summary = summaryResult.rows[0] ?? {
    active_workers: 0,
    total_orders: 0,
    active_orders: 0,
    active_cases: 0,
    attention_cases: 0,
    open_actions: 0,
    sites: 0,
    departments: 0
  };

  return (
    <div className="dashboard-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Company Portal</p>
          <h1>{membership.display_name}</h1>
          <p className="page-intro">
            Live workforce, assurance-case and Action Centre data for this Company tenant.
          </p>
        </div>
        <span className={`status-badge ${verificationTone(membership.verification_status)}`}>
          Company verification: {membership.verification_status?.replaceAll("_", " ") ?? membership.tenant_status}
        </span>
      </header>

      <section className="metric-grid" aria-label="Company assurance summary">
        <article className="metric-card">
          <div className="metric-card-heading"><span>Workers</span><span>Active links</span></div>
          <strong>{count(summary.active_workers)}</strong>
          <p>Workers currently linked to this Company tenant.</p>
          <Link className="button button-secondary button-small" href="/company/invitations">Manage workforce</Link>
        </article>
        <article className="metric-card">
          <div className="metric-card-heading"><span>Assurance Orders</span><span>{count(summary.total_orders)} total</span></div>
          <strong>{count(summary.active_orders)} active</strong>
          <p>Submitted or in-progress formal assurance requests.</p>
          <Link className="button button-secondary button-small" href="/company/assurance-orders">Open orders</Link>
        </article>
        <article className="metric-card">
          <div className="metric-card-heading"><span>Worker cases</span><span>Live</span></div>
          <strong>{count(summary.active_cases)}</strong>
          <p>{count(summary.attention_cases)} case(s) currently require attention or have an adverse state.</p>
        </article>
        <article className="metric-card">
          <div className="metric-card-heading"><span>Action Centre</span><span>Open</span></div>
          <strong>{count(summary.open_actions)}</strong>
          <p>Exact tenant-scoped obligations and next actions.</p>
          <Link className="button button-secondary button-small" href="/company/action-centre">Open Action Centre</Link>
        </article>
        <article className="metric-card">
          <div className="metric-card-heading"><span>Organization</span><span>Active</span></div>
          <strong>{count(summary.sites)} sites</strong>
          <p>{count(summary.departments)} active departments.</p>
          <Link className="button button-secondary button-small" href="/company/organization">Open organization</Link>
        </article>
        <article className="metric-card">
          <div className="metric-card-heading"><span>Notifications</span><span>Portal scoped</span></div>
          <strong>{notificationMenu.unreadCount} unread</strong>
          <p>{notificationMenu.notifications.length} recent persisted notifications.</p>
          <Link className="button button-secondary button-small" href="/company/notifications">View notifications</Link>
        </article>
      </section>

      {membership.verification_status !== "verified" ? (
        <section className="dashboard-section" aria-labelledby="verification-heading">
          <p className="section-kicker">Company verification</p>
          <h2 id="verification-heading">Complete the Company verification case</h2>
          <p>
            Workforce and assurance operations remain server-gated until the Company verification state permits them.
          </p>
          <Link className="button button-primary" href="/company/settings/profile">
            Open Company verification
          </Link>
        </section>
      ) : null}

      <div className="dashboard-layout">
        <div className="dashboard-primary-column">
          <section className="dashboard-section" aria-labelledby="recent-cases-heading">
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Assurance workflow</p>
                <h2 id="recent-cases-heading">Recent worker cases</h2>
              </div>
              <Link className="button button-secondary button-small" href="/company/assurance-orders">All orders</Link>
            </div>
            {casesResult.rows.length === 0 ? (
              <div className="empty-state compact-empty-state">
                <h3>No Assurance Cases yet</h3>
                <p>Cases appear after a validated Assurance Order is submitted.</p>
              </div>
            ) : (
              <div className="record-list">
                {casesResult.rows.map((item) => (
                  <article className="record-row" key={item.case_id}>
                    <div>
                      <h3>{item.order_name}</h3>
                      <p>
                        {item.permanent_worker_id ?? "Worker account"} · {item.order_reference}
                      </p>
                      <p className="muted-copy">{item.next_action ?? "No pending action."}</p>
                    </div>
                    <div className="record-row-actions">
                      <span className="status-badge status-neutral">{item.case_status}</span>
                      <Link className="button button-secondary button-small" href={`/company/assurance-orders/${item.order_id}#${item.case_id}`}>
                        Open case
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="dashboard-secondary-column" aria-label="Company dashboard activity">
          <section className="dashboard-section" aria-labelledby="recent-orders-heading">
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Orders</p>
                <h2 id="recent-orders-heading">Recent Assurance Orders</h2>
              </div>
            </div>
            {ordersResult.rows.length === 0 ? (
              <div className="empty-state compact-empty-state">
                <p>No Assurance Orders have been created.</p>
              </div>
            ) : (
              <div className="side-stack">
                {ordersResult.rows.map((order) => (
                  <article className="side-record-card" key={order.order_id}>
                    <span className="status-badge status-neutral">{order.order_status}</span>
                    <h3>{order.order_name}</h3>
                    <p>{order.order_reference}</p>
                    <Link className="button button-secondary button-small" href={`/company/assurance-orders/${order.order_id}`}>
                      Open
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="dashboard-section" aria-labelledby="company-notifications-heading">
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">Updates</p>
                <h2 id="company-notifications-heading">Notifications</h2>
              </div>
            </div>
            {notificationMenu.notifications.length === 0 ? (
              <div className="empty-state compact-empty-state"><p>No persisted notifications.</p></div>
            ) : (
              <ul className="dashboard-notification-list">
                {notificationMenu.notifications.slice(0, 5).map((notification) => (
                  <li key={notification.notificationId}>
                    <div>
                      <strong>{notification.title}</strong>
                      <span>{notification.body}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
