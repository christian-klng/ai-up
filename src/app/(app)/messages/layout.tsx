import { getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { listContacts, listConversations } from "@/server/domain/messenger";
import { MessagesShell } from "@/components/messenger/messages-shell";

export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  const [t, conversations, contacts] = await Promise.all([getTranslations("messages"), listConversations(me.id), listContacts(me.id)]);
  return (
    <MessagesShell
      meId={me.id}
      conversations={conversations.map((c) => ({
        id: c.id,
        other: c.other,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        lastMessagePreview: c.lastMessagePreview,
        lastMessageSenderId: c.lastMessageSenderId,
        unreadCount: c.unreadCount,
      }))}
      contacts={contacts.filter((c) => !c.conversationId).map((c) => ({ id: c.id, name: c.name, avatarMediaId: c.avatarMediaId, online: c.online }))}
      labels={{ title: t("title"), empty: t("empty"), emptyHint: t("emptyHint"), contacts: t("contacts"), you: t("you"), startChat: t("startChat"), bot: t("bot") }}
    >
      {children}
    </MessagesShell>
  );
}
