import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/server/db/client";
import {
  contactRequests,
  conversationMembers,
  conversations,
  messages,
  users,
  type ContactRequest,
  type Conversation,
  type Message,
  type MessageAttachment,
  type User,
} from "@/server/db/schema";
import { publishToUser, publishToUsers } from "@/server/realtime/publish";
import { createNotification, localized, resolveNotifications } from "./notifications";
import type { ChatMessageDto } from "@/lib/realtime-events";

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export type ContactState =
  | { status: "none" }
  | { status: "pending_out"; requestId: string }
  | { status: "pending_in"; requestId: string; message: string | null }
  | { status: "accepted"; requestId: string; conversationId: string | null }
  | { status: "declined"; requestId: string; byMe: boolean }
  | { status: "blocked"; requestId: string; byMe: boolean };

/** Finds the (single) contact row between two users regardless of direction. */
export async function findContactRow(a: string, b: string): Promise<ContactRequest | undefined> {
  return db.query.contactRequests.findFirst({
    where: or(and(eq(contactRequests.requesterId, a), eq(contactRequests.addresseeId, b)), and(eq(contactRequests.requesterId, b), eq(contactRequests.addresseeId, a))),
  });
}

export async function getContactState(meId: string, otherId: string): Promise<ContactState> {
  if (meId === otherId) return { status: "none" };
  const row = await findContactRow(meId, otherId);
  if (!row) return { status: "none" };
  switch (row.status) {
    case "pending":
      return row.requesterId === meId ? { status: "pending_out", requestId: row.id } : { status: "pending_in", requestId: row.id, message: row.message };
    case "accepted": {
      const conv = await findDirectConversation(meId, otherId);
      return { status: "accepted", requestId: row.id, conversationId: conv?.id ?? null };
    }
    case "declined":
      return { status: "declined", requestId: row.id, byMe: row.addresseeId === meId };
    case "blocked":
      return { status: "blocked", requestId: row.id, byMe: row.blockedBy === meId };
  }
}

export async function areContacts(a: string, b: string): Promise<boolean> {
  const row = await findContactRow(a, b);
  return row?.status === "accepted";
}

async function publicUser(id: string) {
  return db.query.users.findFirst({ where: eq(users.id, id), columns: { id: true, name: true, locale: true, avatarMediaId: true, status: true } });
}

export type ContactError = "self" | "notFound" | "blocked" | "alreadyContacts" | "alreadyPending";

export async function sendContactRequest(meId: string, otherId: string, message: string | null, me: Pick<User, "name">): Promise<{ ok: true } | { ok: false; error: ContactError }> {
  if (meId === otherId) return { ok: false, error: "self" };
  const other = await publicUser(otherId);
  if (!other || other.status !== "active") return { ok: false, error: "notFound" };
  const existing = await findContactRow(meId, otherId);
  if (existing) {
    if (existing.status === "blocked") return { ok: false, error: "blocked" };
    if (existing.status === "accepted") return { ok: false, error: "alreadyContacts" };
    if (existing.status === "pending") {
      // The other side already asked us – accepting is the sensible interpretation.
      if (existing.requesterId === otherId) {
        await respondContactRequest(meId, existing.id, "accept", me);
        return { ok: true };
      }
      return { ok: false, error: "alreadyPending" };
    }
    // declined → allow a new request (re-open, swap direction to me)
    await db
      .update(contactRequests)
      .set({ requesterId: meId, addresseeId: otherId, status: "pending", message, respondedAt: null, blockedBy: null })
      .where(eq(contactRequests.id, existing.id));
  } else {
    await db.insert(contactRequests).values({ requesterId: meId, addresseeId: otherId, status: "pending", message });
  }
  await createNotification({
    userId: otherId,
    type: "contact.request",
    title: localized(other.locale, { de: `${me.name} möchte Kontakt aufnehmen`, en: `${me.name} wants to connect` }),
    body: message,
    data: { href: `/members/${meId}`, fromUserId: meId },
  });
  await publishToUsers([meId, otherId], "contact.changed", { otherUserId: meId, status: "pending" });
  return { ok: true };
}

export async function respondContactRequest(meId: string, requestId: string, decision: "accept" | "decline", me: Pick<User, "name">): Promise<{ ok: boolean; conversationId?: string }> {
  const row = await db.query.contactRequests.findFirst({ where: and(eq(contactRequests.id, requestId), eq(contactRequests.addresseeId, meId), eq(contactRequests.status, "pending")) });
  if (!row) return { ok: false };
  const status = decision === "accept" ? "accepted" : "declined";
  await db.update(contactRequests).set({ status, respondedAt: new Date() }).where(eq(contactRequests.id, requestId));
  await resolveNotifications(meId, "contact.request", "fromUserId", row.requesterId);
  let conversationId: string | undefined;
  if (decision === "accept") {
    const conv = await getOrCreateDirectConversation(meId, row.requesterId);
    conversationId = conv.id;
    const requester = await publicUser(row.requesterId);
    if (requester) {
      await createNotification({
        userId: requester.id,
        type: "contact.accepted",
        title: localized(requester.locale, { de: `${me.name} hat deine Kontaktanfrage angenommen`, en: `${me.name} accepted your contact request` }),
        data: { href: `/messages/${conv.id}`, userId: meId, conversationId: conv.id },
      });
    }
  }
  await publishToUsers([meId, row.requesterId], "contact.changed", { otherUserId: meId, status });
  return { ok: true, conversationId };
}

export async function blockContact(meId: string, otherId: string): Promise<void> {
  const existing = await findContactRow(meId, otherId);
  if (existing) {
    await db.update(contactRequests).set({ status: "blocked", blockedBy: meId, respondedAt: new Date() }).where(eq(contactRequests.id, existing.id));
  } else {
    await db.insert(contactRequests).values({ requesterId: meId, addresseeId: otherId, status: "blocked", blockedBy: meId, respondedAt: new Date() });
  }
  await publishToUsers([meId, otherId], "contact.changed", { otherUserId: meId, status: "blocked" });
}

export async function unblockContact(meId: string, otherId: string): Promise<void> {
  const existing = await findContactRow(meId, otherId);
  if (!existing || existing.status !== "blocked" || existing.blockedBy !== meId) return;
  // Unblocking removes the relation entirely; a new request is needed to chat again.
  await db.delete(contactRequests).where(eq(contactRequests.id, existing.id));
  await publishToUsers([meId, otherId], "contact.changed", { otherUserId: meId, status: "none" });
}

export type ContactUser = { id: string; name: string; avatarMediaId: string | null; bio: string | null; online: boolean; conversationId: string | null };

/** Accepted contacts of a user, with the direct conversation id if one exists. */
export async function listContacts(meId: string): Promise<ContactUser[]> {
  const rows = await db.query.contactRequests.findMany({
    where: and(eq(contactRequests.status, "accepted"), or(eq(contactRequests.requesterId, meId), eq(contactRequests.addresseeId, meId))),
  });
  const otherIds = rows.map((r) => (r.requesterId === meId ? r.addresseeId : r.requesterId));
  if (!otherIds.length) return [];
  const people = await db
    .select({ id: users.id, name: users.name, avatarMediaId: users.avatarMediaId, bio: users.bio, online: sql<boolean>`coalesce(${users.lastSeenAt} > now() - interval '3 minutes', false)` })
    .from(users)
    .where(and(inArray(users.id, otherIds), eq(users.status, "active")))
    .orderBy(asc(users.name));
  const convs = await listDirectConversationPartners(meId);
  return people.map((p) => ({ ...p, conversationId: convs.get(p.id) ?? null }));
}

/** Pending incoming requests (for the notification center / profile). */
export async function listIncomingRequests(meId: string): Promise<(ContactRequest & { requester: { id: string; name: string; avatarMediaId: string | null } })[]> {
  const rows = await db
    .select({ req: contactRequests, requester: { id: users.id, name: users.name, avatarMediaId: users.avatarMediaId } })
    .from(contactRequests)
    .innerJoin(users, eq(users.id, contactRequests.requesterId))
    .where(and(eq(contactRequests.addresseeId, meId), eq(contactRequests.status, "pending")))
    .orderBy(desc(contactRequests.createdAt));
  return rows.map((r) => ({ ...r.req, requester: r.requester }));
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

const cmA = alias(conversationMembers, "cm_a");
const cmB = alias(conversationMembers, "cm_b");

export async function findDirectConversation(a: string, b: string): Promise<Conversation | undefined> {
  const rows = await db
    .select({ conv: conversations })
    .from(conversations)
    .innerJoin(cmA, and(eq(cmA.conversationId, conversations.id), eq(cmA.userId, a)))
    .innerJoin(cmB, and(eq(cmB.conversationId, conversations.id), eq(cmB.userId, b)))
    .where(eq(conversations.kind, "direct"))
    .limit(1);
  return rows[0]?.conv;
}

async function listDirectConversationPartners(meId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ conversationId: cmA.conversationId, otherId: cmB.userId })
    .from(cmA)
    .innerJoin(cmB, and(eq(cmB.conversationId, cmA.conversationId), ne(cmB.userId, meId)))
    .innerJoin(conversations, and(eq(conversations.id, cmA.conversationId), eq(conversations.kind, "direct")))
    .where(eq(cmA.userId, meId));
  return new Map(rows.map((r) => [r.otherId, r.conversationId]));
}

export async function getOrCreateDirectConversation(a: string, b: string): Promise<Conversation> {
  const existing = await findDirectConversation(a, b);
  if (existing) return existing;
  return db.transaction(async (tx) => {
    const [conv] = await tx.insert(conversations).values({ kind: "direct" }).returning();
    await tx.insert(conversationMembers).values([
      { conversationId: conv.id, userId: a },
      { conversationId: conv.id, userId: b },
    ]);
    return conv;
  });
}

export type ConversationListItem = {
  id: string;
  kind: Conversation["kind"];
  other: { id: string; name: string; avatarMediaId: string | null; online: boolean } | null;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  lastMessageSenderId: string | null;
  unreadCount: number;
};

export async function listConversations(meId: string): Promise<ConversationListItem[]> {
  const rows = await db
    .select({
      conv: conversations,
      lastReadAt: cmA.lastReadAt,
      other: { id: users.id, name: users.name, avatarMediaId: users.avatarMediaId, online: sql<boolean>`coalesce(${users.lastSeenAt} > now() - interval '3 minutes', false)` },
      unreadCount: sql<number>`(select count(*)::int from ${messages} m where m.conversation_id = ${conversations}."id" and m.deleted_at is null and m.sender_id is distinct from ${cmA}."user_id" and (${cmA}."last_read_at" is null or m.created_at > ${cmA}."last_read_at"))`,
    })
    .from(cmA)
    .innerJoin(conversations, eq(conversations.id, cmA.conversationId))
    .leftJoin(cmB, and(eq(cmB.conversationId, cmA.conversationId), ne(cmB.userId, meId)))
    .leftJoin(users, eq(users.id, cmB.userId))
    .where(eq(cmA.userId, meId))
    .orderBy(desc(sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`));
  return rows.map((r) => ({
    id: r.conv.id,
    kind: r.conv.kind,
    other: r.other?.id ? r.other : null,
    lastMessageAt: r.conv.lastMessageAt,
    lastMessagePreview: r.conv.lastMessagePreview,
    lastMessageSenderId: r.conv.lastMessageSenderId,
    unreadCount: r.unreadCount,
  }));
}

export async function getConversationForUser(meId: string, conversationId: string): Promise<(ConversationListItem & { members: { id: string; name: string; avatarMediaId: string | null; lastReadAt: Date | null }[] }) | undefined> {
  const list = await listConversations(meId);
  const item = list.find((c) => c.id === conversationId);
  if (!item) return undefined;
  const members = await db
    .select({ id: users.id, name: users.name, avatarMediaId: users.avatarMediaId, lastReadAt: conversationMembers.lastReadAt })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(eq(conversationMembers.conversationId, conversationId));
  return { ...item, members };
}

/** Total unread messages across all conversations (topbar dot). */
export async function unreadMessagesCount(meId: string): Promise<number> {
  const [row] = await db
    .select({
      count: sql<number>`coalesce(sum((select count(*) from ${messages} m where m.conversation_id = ${conversationMembers}."conversation_id" and m.deleted_at is null and m.sender_id is distinct from ${meId} and (${conversationMembers}."last_read_at" is null or m.created_at > ${conversationMembers}."last_read_at"))), 0)::int`,
    })
    .from(conversationMembers)
    .where(eq(conversationMembers.userId, meId));
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function toDto(m: Message, sender: { id: string; name: string; avatarMediaId: string | null } | null): ChatMessageDto {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    senderName: sender?.name ?? "–",
    senderAvatarMediaId: sender?.avatarMediaId ?? null,
    body: m.deletedAt ? "" : m.body,
    attachments: m.deletedAt ? [] : m.attachments,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function listMessages(conversationId: string, opts: { before?: Date; limit?: number } = {}): Promise<{ items: ChatMessageDto[]; hasMore: boolean }> {
  const limit = opts.limit ?? 50;
  const conds = [eq(messages.conversationId, conversationId)];
  if (opts.before) conds.push(lt(messages.createdAt, opts.before));
  const rows = await db
    .select({ m: messages, sender: { id: users.id, name: users.name, avatarMediaId: users.avatarMediaId } })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.senderId))
    .where(and(...conds))
    .orderBy(desc(messages.createdAt))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = rows
    .slice(0, limit)
    .reverse()
    .map((r) => toDto(r.m, r.sender?.id ? r.sender : null));
  return { items, hasMore };
}

export async function isConversationMember(meId: string, conversationId: string): Promise<boolean> {
  const row = await db.query.conversationMembers.findFirst({ where: and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, meId)) });
  return !!row;
}

async function memberIds(conversationId: string): Promise<string[]> {
  const rows = await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
  return rows.map((r) => r.userId);
}

export async function sendMessage(me: Pick<User, "id" | "name" | "avatarMediaId">, conversationId: string, body: string, attachments: MessageAttachment[] = []): Promise<ChatMessageDto | undefined> {
  if (!(await isConversationMember(me.id, conversationId))) return undefined;
  const preview = body.trim() ? body.trim().slice(0, 140) : attachments.length ? `📎 ${attachments[0].name}` : "";
  const dto = await db.transaction(async (tx) => {
    const [m] = await tx.insert(messages).values({ conversationId, senderId: me.id, body: body.trim(), attachments }).returning();
    await tx.update(conversations).set({ lastMessageAt: m.createdAt, lastMessagePreview: preview, lastMessageSenderId: me.id }).where(eq(conversations.id, conversationId));
    // Sending implies having read everything so far.
    await tx.update(conversationMembers).set({ lastReadAt: m.createdAt }).where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, me.id)));
    return toDto(m, { id: me.id, name: me.name, avatarMediaId: me.avatarMediaId });
  });
  const ids = await memberIds(conversationId);
  await Promise.all(ids.map(async (uid) => publishToUser(uid, "message.created", { message: dto, unreadMessages: await unreadMessagesCount(uid) })));
  return dto;
}

export async function markConversationRead(meId: string, conversationId: string): Promise<void> {
  const now = new Date();
  // Only act when there is something unread – avoids event storms (page render → publish → refresh → …).
  const unread = await firstUnreadAt(meId, conversationId);
  const member = await db.query.conversationMembers.findFirst({ where: and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, meId)) });
  if (!member) return;
  if (!unread && member.lastReadAt) return;
  await db
    .update(conversationMembers)
    .set({ lastReadAt: now })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, meId)));
  const others = (await memberIds(conversationId)).filter((id) => id !== meId);
  await Promise.all([
    publishToUser(meId, "message.count", { unreadMessages: await unreadMessagesCount(meId) }),
    publishToUsers(others, "message.read", { conversationId, userId: meId, at: now.toISOString() }),
  ]);
}

export async function publishTyping(me: Pick<User, "id" | "name">, conversationId: string): Promise<void> {
  if (!(await isConversationMember(me.id, conversationId))) return;
  const others = (await memberIds(conversationId)).filter((id) => id !== me.id);
  await publishToUsers(others, "conversation.typing", { conversationId, userId: me.id, name: me.name });
}

/** Unread messages newer than the member's lastReadAt (used to place the "new" divider). */
export async function firstUnreadAt(meId: string, conversationId: string): Promise<Date | null> {
  const member = await db.query.conversationMembers.findFirst({ where: and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, meId)) });
  if (!member) return null;
  const conds = [eq(messages.conversationId, conversationId), ne(messages.senderId, meId), isNull(messages.deletedAt)];
  if (member.lastReadAt) conds.push(gt(messages.createdAt, member.lastReadAt));
  const first = await db.query.messages.findFirst({ where: and(...conds), orderBy: asc(messages.createdAt) });
  return first?.createdAt ?? null;
}
