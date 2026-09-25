import Link from "next/link";

import { signOutCurrentPortal } from "@/app/auth/actions";
import { RoleNavigation } from "@/components/auth/role-navigation";
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
  const navigationRole = session.role as Exclude<AuthRole, "worker">;

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
            HSE Verify
            <small>{label} Portal</small>
          </span>
        </Link>

        <RoleNavigation role={navigationRole} />

        <div className="portal-sidebar-note">
          <strong>Portal isolation</strong>
          <p>This session grants {label} Portal access only.</p>
        </div>
      </aside>

      <div className="portal-main-column">
        <header className="portal-header">
          <div className="mobile-brand">
            <Link className="brand-mark" href={`${basePath}/dashboard`}>
              <span className="brand-symbol" aria-hidden="true">HV</span>
              <span>HSE Verify</span>
            </Link>
          </div>

          <details className="mobile-nav-menu">
            <summary
              className="button button-secondary"
              aria-label={`Open ${label} Portal navigation`}
            >
              Menu
            </summary>
            <div className="mobile-nav-panel">
              <RoleNavigation role={navigationRole} />
            </div>
          </details>

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
                <Link href={`${basePath}/dashboard`}>Dashboard</Link>
                <Link href={`${basePath}/notifications`}>Notifications</Link>
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
