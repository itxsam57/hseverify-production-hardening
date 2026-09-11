import Link from "next/link";

import { signOutCurrentPortal } from "@/app/auth/actions";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { AuthRole } from "@/lib/auth/auth-domain";
import type { AuthenticatedSession } from "@/lib/auth/auth-session-service";
import { getNotificationMenu } from "@/lib/notifications/notification-service";

const ROLE_LABELS: Record<AuthRole, string> = {
  worker: "Worker",
  company: "Company",
  assessor: "Assessor",
  verifier: "Verifier",
  admin: "Administrator",
  root: "Root administrator"
};

export async function RolePortalShell({
  session,
  children
}: {
  session: AuthenticatedSession;
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const label = ROLE_LABELS[session.role];
  const basePath = `/${session.role}`;
  const notificationMenu = await getNotificationMenu(session.role);

  return (
    <div className="portal-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="portal-sidebar" aria-label={`${label} Portal navigation`}>
        <Link
          className="brand-mark brand-mark-light portal-brand"
          href={`${basePath}/dashboard`}
        >
          <span className="brand-symbol" aria-hidden="true">
            HV
          </span>
          <span>
            HSE Verify<small>{label} Portal</small>
          </span>
        </Link>
        <nav className="portal-navigation" aria-label={`${label} Portal`}>
          <Link href={`${basePath}/dashboard`}>Dashboard</Link>
          {session.role === "worker" ? (
            <Link href="/worker/available-assessments">Available assessments</Link>
          ) : null}
          {session.role === "company" ? (
            <>
              <Link href="/company/settings/profile">Company profile</Link>
              <Link href="/company/organization">Sites &amp; departments</Link>
              <Link href="/company/team">Company Team</Link>
              <Link href="/company/invitations">Worker invitations &amp; codes</Link>
              <Link href="/company/assurance-orders">Assurance Orders</Link>
              <Link href="/company/action-centre">Action Centre</Link>
            </>
          ) : null}
          {session.role === "admin" ? (
            <>
              <Link href="/admin/company-verifications">Company verifications</Link>
              <Link href="/admin/frameworks">Frameworks &amp; policy</Link>
              <Link href="/admin/question-bank">Question Bank</Link>
              <Link href="/admin/assessment-blueprints">Assessment blueprints</Link>
              <Link href="/admin/assessment-catalogue">Assessment catalogue</Link>
            </>
          ) : null}
          <Link href={`${basePath}/notifications`}>Notifications</Link>
          <Link href="/account/sessions">Active sessions</Link>
          {session.role === "admin" || session.role === "root" ? (
            <Link href={`${basePath}/staff`}>Staff invitations</Link>
          ) : null}
        </nav>
        <div className="portal-sidebar-note">
          <strong>Portal isolation</strong>
          <p>This session grants {label} Portal access only.</p>
        </div>
      </aside>

      <div className="portal-main-column">
        <header className="portal-header">
          <div className="header-context">
            <span className="role-chip">{label} Portal</span>
          </div>
          <div className="header-actions">
            <NotificationBell
              role={session.role}
              unreadCount={notificationMenu.unreadCount}
              notifications={notificationMenu.notifications}
            />
            <details className="header-menu profile-menu">
              <summary aria-label={`Open ${label} account menu`}>
                <span className="avatar" aria-hidden="true">
                  {session.displayName.slice(0, 1).toUpperCase()}
                </span>
                <span className="profile-summary-text">
                  <strong>{session.displayName}</strong>
                  <small>{label} account</small>
                </span>
              </summary>
              <div className="menu-panel profile-panel">
                <div className="profile-panel-identity">
                  <strong>{session.displayName}</strong>
                  <span>{session.email}</span>
                </div>
                {session.role === "worker" ? (
                  <Link href="/worker/available-assessments">Available assessments</Link>
                ) : null}
                {session.role === "company" ? (
                  <>
                    <Link href="/company/settings/profile">Company profile</Link>
                    <Link href="/company/organization">Sites &amp; departments</Link>
                    <Link href="/company/team">Company Team</Link>
                    <Link href="/company/invitations">Worker invitations &amp; codes</Link>
                    <Link href="/company/assurance-orders">Assurance Orders</Link>
                    <Link href="/company/action-centre">Action Centre</Link>
                  </>
                ) : null}
                {session.role === "admin" ? (
                  <>
                    <Link href="/admin/company-verifications">Company verifications</Link>
                    <Link href="/admin/assessment-catalogue">Assessment catalogue</Link>
                  </>
                ) : null}
                <Link href="/account/sessions">Active sessions</Link>
                <Link href="/">Exit portal</Link>
                <ConfirmDialog
                  action={signOutCurrentPortal}
                  confirmLabel="Sign out"
                  danger
                  description={`Your ${label} Portal session will end.`}
                  title={`Sign out of the ${label} Portal?`}
                  triggerLabel="Sign out"
                />
              </div>
            </details>
          </div>
        </header>
        <main className="portal-content" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
