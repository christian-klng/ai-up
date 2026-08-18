"use server";

import { revalidatePath } from "next/cache";
import { assertUser } from "@/server/auth/session";
import { markAllNotificationsRead, markNotificationRead } from "@/server/domain/notifications";

export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await assertUser();
  await markAllNotificationsRead(user.id);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

export async function markNotificationReadAction(id: string): Promise<void> {
  const user = await assertUser();
  await markNotificationRead(user.id, id);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}
