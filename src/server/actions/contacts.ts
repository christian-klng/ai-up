"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertUser } from "@/server/auth/session";
import { blockContact, respondContactRequest, sendContactRequest, unblockContact, type ContactError } from "@/server/domain/messenger";

export async function sendContactRequestAction(otherUserId: string, message: string): Promise<{ ok: true } | { ok: false; error: ContactError }> {
  const me = await assertUser();
  const msg = z.string().trim().max(500).parse(message ?? "");
  const res = await sendContactRequest(me.id, otherUserId, msg || null, me);
  revalidatePath(`/members/${otherUserId}`);
  return res;
}

export async function respondContactRequestAction(requestId: string, decision: "accept" | "decline"): Promise<{ ok: boolean; conversationId?: string }> {
  const me = await assertUser();
  const res = await respondContactRequest(me.id, requestId, decision, me);
  revalidatePath("/notifications");
  revalidatePath("/members", "layout");
  return res;
}

export async function blockContactAction(otherUserId: string): Promise<void> {
  const me = await assertUser();
  await blockContact(me.id, otherUserId);
  revalidatePath(`/members/${otherUserId}`);
}

export async function unblockContactAction(otherUserId: string): Promise<void> {
  const me = await assertUser();
  await unblockContact(me.id, otherUserId);
  revalidatePath(`/members/${otherUserId}`);
}
