import { NotificationCenter } from "@/components/notifications/notification-center";

export const metadata = { title: "Administrator Notifications" };

export default async function AdminNotificationsPage({
  searchParams
}: {
  searchParams: Promise<{ notice?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return <NotificationCenter role="admin" notice={params.notice} />;
}
