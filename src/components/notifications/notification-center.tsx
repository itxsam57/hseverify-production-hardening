import {
  createNotificationFixtureAction,
  markNotificationReadAction,
  openNotificationAction
} from "@/app/notifications/actions";
import { formatDateTime } from "@/lib/format";
import type { AuthRole } from "@/lib/auth/auth-domain";
import { getServerEnvironment } from "@/lib/config/server-environment";
import { getNotificationCenter } from "@/lib/notifications/notification-service";

export async function NotificationCenter({
  role,
  notice
}: {
  role: AuthRole;
  notice?: string;
}): Promise<React.JSX.Element> {
  const projection = await getNotificationCenter(role);
  const { notifications, unreadCount } = projection;
  const environment = getServerEnvironment();
  const fixtureEnabled = environment.appEnvironment !== "production";

  return (
    <div className="notification-center-page">
      <header className="page-heading-row">
        <div>
          <p className="eyebrow">Current portal</p>
          <h1>Notifications</h1>
          <p className="page-intro">
            Persisted updates for this account and this fixed portal role only.
          </p>
        </div>
        <div className="notification-center-summary" aria-live="polite">
          <strong>{unreadCount}</strong>
          <span>unread</span>
        </div>
      </header>

      {notice === "fixture-ready" ? (
        <div className="feedback-banner feedback-success" role="status">
          The real outbox worker projected the test notification successfully.
        </div>
      ) : notice === "unavailable" ? (
        <div className="feedback-banner feedback-warning" role="status">
          That notification is unavailable in this portal or you no longer have access to it.
        </div>
      ) : null}

      {fixtureEnabled ? (
        <section className="notification-test-control" aria-labelledby="notification-test-heading">
          <div>
            <h2 id="notification-test-heading">Owner test fixture</h2>
            <p>
              Development and test only. This uses the same committed outbox, worker,
              persistence and authorization path as normal notifications.
            </p>
          </div>
          <form action={createNotificationFixtureAction}>
            <button className="button button-secondary" type="submit">
              Create persisted test notification
            </button>
          </form>
        </section>
      ) : null}

      {notifications.length === 0 ? (
        <section className="empty-state notification-empty-state" aria-live="polite">
          <h2>No notifications</h2>
          <p>There are no persisted notifications for this portal role.</p>
        </section>
      ) : (
        <section aria-label="Persisted notifications">
          <ul className="notification-center-list">
            {notifications.map((notification) => (
              <li
                className={notification.readAt ? "notification-center-item" : "notification-center-item notification-unread"}
                key={notification.notificationId}
              >
                <div className="notification-center-copy">
                  <div className="notification-center-title-row">
                    <h2>{notification.title}</h2>
                    <span className="status-badge">
                      {notification.readAt ? "Read" : "Unread"}
                    </span>
                  </div>
                  <p>{notification.body}</p>
                  <time dateTime={notification.createdAt}>
                    {formatDateTime(notification.createdAt)}
                  </time>
                </div>
                <div className="notification-center-actions">
                  <form action={openNotificationAction}>
                    <input
                      name="notificationId"
                      type="hidden"
                      value={notification.notificationId}
                    />
                    <button className="button button-primary button-small" type="submit">
                      Open
                    </button>
                  </form>
                  {notification.readAt === null ? (
                    <form action={markNotificationReadAction}>
                      <input
                        name="notificationId"
                        type="hidden"
                        value={notification.notificationId}
                      />
                      <button className="button button-secondary button-small" type="submit">
                        Mark read
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
