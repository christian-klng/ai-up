import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getPublicUser } from "@/server/domain/users";
import { getContactState } from "@/server/domain/messenger";
import { UserAvatar } from "@/components/shell/user-avatar";
import { Badge } from "@/components/ui/badge";
import { ContactButton } from "@/components/messenger/contact-button";

export default async function MemberProfilePage({ params }: PageProps<"/members/[userId]">) {
  const me = await requireUser();
  const { userId } = await params;
  const member = await getPublicUser(userId);
  if (!member || member.status !== "active") notFound();
  const [t, tc, format, state] = await Promise.all([getTranslations("members"), getTranslations("common"), getFormatter(), getContactState(me.id, member.id)]);
  const isMe = me.id === member.id;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/members" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {t("title")}
      </Link>
      <div className="flex flex-col gap-6 rounded-lg border bg-card p-6 sm:flex-row sm:items-start">
        <span className="relative inline-block w-fit shrink-0 self-start">
          <UserAvatar user={member} size={96} />
          {member.online && <span className="absolute bottom-1 right-1 size-4 rounded-full bg-emerald-500 ring-2 ring-card" title={tc("online")} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{member.name}</h1>
            {member.role === "admin" && <Badge variant="secondary">{t("adminBadge")}</Badge>}
            {member.isBot && <Badge>{t("botBadge")}</Badge>}
            {member.online && <Badge variant="outline">{tc("online")}</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("memberSince", { date: format.dateTime(member.createdAt, { dateStyle: "long" }) })}</p>
          {member.bio && <p className="mt-4 whitespace-pre-line text-sm leading-relaxed">{member.bio}</p>}
          {!isMe && !member.isBot && (
            <div className="mt-6">
              <ContactButton otherUserId={member.id} otherName={member.name} state={state} />
            </div>
          )}
          {isMe && (
            <Link href="/profile" className="mt-6 inline-block text-sm text-primary hover:underline">
              {t("editOwnProfile")}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
