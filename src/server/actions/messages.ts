"use server";

import { z } from "zod";
import { assertUser } from "@/server/auth/session";
import {
  areContacts,
  getOrCreateDirectConversation,
  isConversationMember,
  listMessages,
  markConversationRead,
  publishTyping,
  sendMessage,
  unreadMessagesCount,
} from "@/server/domain/messenger";
import { getMedia } from "@/server/media/storage";
import type { MessageAttachment } from "@/server/db/schema";
import type { ChatMessageDto } from "@/lib/realtime-events";

const sendSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().max(10_000),
  attachmentIds: z.array(z.string().uuid()).max(6).default([]),
});

export async function sendMessageAction(input: { conversationId: string; body: string; attachmentIds?: string[] }): Promise<{ ok: true; message: ChatMessageDto } | { ok: false }> {
  const me = await assertUser();
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const { conversationId, body, attachmentIds } = parsed.data;
  if (!body.trim() && attachmentIds.length === 0) return { ok: false };
  const attachments: MessageAttachment[] = [];
  for (const id of attachmentIds) {
    const m = await getMedia(id);
    if (!m || m.uploadedBy !== me.id || m.purpose !== "message") continue;
    attachments.push({ mediaId: m.id, kind: m.kind === "image" ? "image" : "file", name: m.originalName, mime: m.mime, size: m.size, width: m.width, height: m.height });
  }
  const message = await sendMessage(me, conversationId, body.replace(/\r\n?/g, "\n"), attachments);
  return message ? { ok: true, message } : { ok: false };
}

/** Marks the conversation read and returns the caller's total unread count (used to sync the topbar dot). */
export async function markConversationReadAction(conversationId: string): Promise<{ unreadMessages: number }> {
  const me = await assertUser();
  await markConversationRead(me.id, z.string().uuid().parse(conversationId));
  return { unreadMessages: await unreadMessagesCount(me.id) };
}

export async function typingAction(conversationId: string): Promise<void> {
  const me = await assertUser();
  await publishTyping(me, z.string().uuid().parse(conversationId));
}

export async function loadOlderMessagesAction(conversationId: string, beforeIso: string): Promise<{ items: ChatMessageDto[]; hasMore: boolean }> {
  const me = await assertUser();
  const id = z.string().uuid().parse(conversationId);
  if (!(await isConversationMember(me.id, id))) return { items: [], hasMore: false };
  return listMessages(id, { before: new Date(beforeIso), limit: 50 });
}

/** Opens (or creates) the direct conversation with a contact and returns its id. */
export async function openDirectConversationAction(otherUserId: string): Promise<{ ok: true; conversationId: string } | { ok: false }> {
  const me = await assertUser();
  if (!(await areContacts(me.id, otherUserId))) return { ok: false };
  const conv = await getOrCreateDirectConversation(me.id, otherUserId);
  return { ok: true, conversationId: conv.id };
}
