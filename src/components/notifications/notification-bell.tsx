import Link from "next/link";

import { openNotificationAction } from "@/app/notifications/actions";
import { formatDateTime } from "@/lib/format";
import {
  notificationListPath,
  resolveNotificationHref,
  type NotificationRecord
} from "@/lib/notifications/notification-domain";
import type { AuthRole } from "@/lib/auth/auth-domain";

export function NotificationBell({
  role,
  unreadCount,
  notifications
}: {
  role: AuthRole;
  unreadCount: number;
  notifications: readonly NotificationRecord[];
}): React.JSX.Element {
  return (
    <details className="header-menu notification-menu">
      <summary aria-label={`${unreadCount} unread notifications`}>
        <span aria-hidden="true">♢</span>
        {unreadCount > 0 ? (
          <span className="notification-count">{unreadCount}</span>
        ) : null}
      </summary>
      <div className="menu-panel notification-panel">
        <div className="menu-heading">
          <strong>Notifications</strong>
          <span>{unreadCount} unread</span>
        </div>
        {notifications.length === 0 ? (
          <p className="menu-empty">No notifications.</p>
        ) : (
          <ul className="notification-list persisted-notification-list">
            {notifications.map((notification) => (
              <li key={notification.notificationId}>
                <form action={openNotificationAction}>
                  <input
                    name="notificationId"
                    type="hidden"
                    value={notification.notificationId}
                  />
                  <button
                    className="notification-link-button"
                    type="submit"
                    aria-label={`${notification.readAt ? "Read" : "Unread"}: ${notification.title}. Open ${resolveNotificationHref({
                      role,
                      target: notification.target,
                      targetReference: notification.targetReference
                    })}`}
                  >
                    <strong>{notification.title}</strong>
                    <span>{notification.body}</span>
                    <time dateTime={notification.createdAt}>
                      {formatDateTime(notification.createdAt)}
                    </time>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <Link className="notification-view-all" href={notificationListPath(role)}>
          View all notifications
        </Link>
      </div>
    </details>
  );
}
