"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createDevelopmentNotificationFixture,
  markCurrentNotificationRead,
  openCurrentNotification
} from "@/lib/notifications/notification-service";
import { notificationListPath } from "@/lib/notifications/notification-domain";

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function markNotificationReadAction(
  formData: FormData
): Promise<void> {
  const result = await markCurrentNotificationRead(
    formText(formData, "notificationId")
  );
  if (!result) return;
  const role = result.notification.recipientRole;
  revalidatePath(notificationListPath(role));
  revalidatePath(`/${role}/dashboard`);
}

export async function openNotificationAction(
  formData: FormData
): Promise<void> {
  const result = await openCurrentNotification(
    formText(formData, "notificationId")
  );
  revalidatePath(notificationListPath(result.role));
  revalidatePath(`/${result.role}/dashboard`);
  if (!result.href) {
    redirect(`${notificationListPath(result.role)}?notice=unavailable`);
  }
  redirect(result.href);
}

export async function createNotificationFixtureAction(): Promise<void> {
  const created = await createDevelopmentNotificationFixture();
  revalidatePath(notificationListPath(created.role));
  revalidatePath(`/${created.role}/dashboard`);
  redirect(`${notificationListPath(created.role)}?notice=fixture-ready`);
}
