"use client";

import { NotificationError } from "@/components/notifications/notification-error";

export default function Error({ reset }: { reset: () => void }): React.JSX.Element {
  return <NotificationError reset={reset} />;
}
