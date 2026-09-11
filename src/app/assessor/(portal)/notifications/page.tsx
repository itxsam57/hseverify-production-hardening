import { NotificationCenter } from "@/components/notifications/notification-center";

export const metadata = { title: "Assessor Notifications" };

export default async function AssessorNotificationsPage({
  searchParams
}: {
  searchParams: Promise<{ notice?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return <NotificationCenter role="assessor" notice={params.notice} />;
}
