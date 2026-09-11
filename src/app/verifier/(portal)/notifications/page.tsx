import { NotificationCenter } from "@/components/notifications/notification-center";

export const metadata = { title: "Verifier Notifications" };

export default async function VerifierNotificationsPage({
  searchParams
}: {
  searchParams: Promise<{ notice?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  return <NotificationCenter role="verifier" notice={params.notice} />;
}
