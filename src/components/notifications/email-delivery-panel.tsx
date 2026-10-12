import "server-only";

import type { AuthRole } from "@/lib/auth/auth-domain";
import { requirePortalAuthorization } from "@/lib/authorization/authorization-service";
import { describeInterviewEmailDelivery } from "@/lib/email-delivery/email-delivery-domain";
import { listEmailDeliveriesForPrincipal } from "@/lib/email-delivery/email-delivery-service";
import {assuranceEventEmailContent} from "@/lib/notifications/notification-domain";
import { formatDateTime } from "@/lib/format";

export async function EmailDeliveryPanel({ role }: { role: AuthRole }): Promise<React.JSX.Element> {
  const principal = await requirePortalAuthorization(role);
  const deliveries = await listEmailDeliveriesForPrincipal({
    principal,
    options: { limit: 10 }
  });

  return (
    <section aria-labelledby="email-delivery-heading">
      <h2 id="email-delivery-heading">Email delivery</h2>
      <p>Your recent portal email updates.</p>
      {deliveries.length === 0 ? <p>No email updates yet.</p> : (
        <ul className="notification-center-list">
          {deliveries.map((delivery) => {
            const status = describeInterviewEmailDelivery(delivery);
            return (
              <li className="email-delivery-item" key={delivery.deliveryId}>
                <div className="notification-center-copy">
                  <div className="notification-center-title-row">
                    <h3>{delivery.deliveryType==="platform.foundation.email" ? "Portal test email" : delivery.deliveryType==="interview.scheduled" ? "Interview scheduled" : delivery.deliveryType==="interview.reminder" ? "Interview reminder" : assuranceEventEmailContent(delivery.deliveryType).title}</h3>
                    <span className="status-badge">{status.label}</span>
                  </div>
                  <p>{status.description}</p>
                  <time dateTime={delivery.createdAt}>{formatDateTime(delivery.createdAt)}</time>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
