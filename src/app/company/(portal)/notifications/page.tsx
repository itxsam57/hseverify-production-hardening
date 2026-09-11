import { NotificationCenter } from "@/components/notifications/notification-center";

export const metadata = { title: "Company Notifications" };

export default async function CompanyNotificationsPage({
  searchParams
}: {
  searchParams: Promise<{ notice?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return <NotificationCenter role="company" notice={params.notice} />;
}
