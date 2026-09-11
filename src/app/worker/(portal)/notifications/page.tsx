import { NotificationCenter } from "@/components/notifications/notification-center";

export const metadata = { title: "Worker Notifications" };

export default async function WorkerNotificationsPage({
  searchParams
}: {
  searchParams: Promise<{ notice?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return <NotificationCenter role="worker" notice={params.notice} />;
}
