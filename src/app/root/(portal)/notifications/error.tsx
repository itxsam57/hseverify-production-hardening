"use client";

import { NotificationError } from "@/components/notifications/notification-error";

export default function Error({ retry }: { retry: () => void }): React.JSX.Element {
  return <NotificationError retry={retry} />;
}
