import { redirect } from "next/navigation";

export default async function LegacyPublicWorkerProjectionRoute({
  params
}: {
  params: Promise<{ workerId: string }>;
}): Promise<never> {
  void (await params);
  redirect("/verify");
}