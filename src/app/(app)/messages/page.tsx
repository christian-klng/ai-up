import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MessageCircle } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { areContacts, getOrCreateDirectConversation } from "@/server/domain/messenger";

export default async function MessagesIndexPage({ searchParams }: PageProps<"/messages">) {
  const me = await requireUser();
  const sp = await searchParams;
  const withUser = typeof sp.with === "string" ? sp.with : null;
  if (withUser && (await areContacts(me.id, withUser))) {
    const conv = await getOrCreateDirectConversation(me.id, withUser);
    redirect(`/messages/${conv.id}`);
  }
  const t = await getTranslations("messages");
  return (
    <div className="hidden flex-col items-center gap-2 p-8 text-center text-muted-foreground md:flex">
      <MessageCircle className="size-8 opacity-40" />
      <p className="text-sm">{t("selectConversation")}</p>
    </div>
  );
}
