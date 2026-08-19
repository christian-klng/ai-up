import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { firstUnreadAt, getConversationForUser, listMessages, markConversationRead } from "@/server/domain/messenger";
import { env } from "@/server/env";
import { ChatThread } from "@/components/messenger/chat-thread";

export default async function ConversationPage({ params }: PageProps<"/messages/[conversationId]">) {
  const me = await requireUser();
  const { conversationId } = await params;
  const conv = await getConversationForUser(me.id, conversationId);
  if (!conv) notFound();
  const [{ items, hasMore }, unreadFrom] = await Promise.all([listMessages(conv.id, { limit: 50 }), firstUnreadAt(me.id, conv.id)]);
  // Opening the thread marks it read (server side, so the counter is right on the very first render).
  await markConversationRead(me.id, conv.id);
  const others = conv.members.filter((m) => m.id !== me.id);

  return (
    <ChatThread
      conversationId={conv.id}
      me={{ id: me.id, name: me.name, avatarMediaId: me.avatarMediaId }}
      other={conv.other}
      otherLastReadAt={others[0]?.lastReadAt?.toISOString() ?? null}
      initialMessages={items}
      initialHasMore={hasMore}
      unreadFrom={unreadFrom?.toISOString() ?? null}
      maxUploadMb={env.MAX_UPLOAD_MB}
    />
  );
}
