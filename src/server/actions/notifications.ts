"use server";

import { revalidatePath } from "next/cache";
import { assertUser } from "@/server/auth/session";
import { markAllNotificationsRead, markNotificationRead } from "@/server/domain/notifications";

export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await assertUser();
  await markAllNotificationsRead(user.id, user.communityId);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

export async function markNotificationReadAction(id: string): Promise<void> {
  const user = await assertUser();
  await markNotificationRead(user.id, user.communityId, id);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}
