import { NotificationCenter } from "@/components/notifications/notification-center";

export const metadata = { title: "Root Notifications" };

export default async function RootNotificationsPage({
  searchParams
}: {
  searchParams: Promise<{ notice?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return <NotificationCenter role="root" notice={params.notice} />;
}
