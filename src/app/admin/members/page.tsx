import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAdmin } from "@/server/auth/session";
import { inviteSourcesForUsers } from "@/server/domain/invites";
import { countMembersByStatus, listMembers } from "@/server/domain/users";
import { getCommunityInvite } from "@/server/domain/community-invites";
import { PageHeader } from "@/components/common/page-header";
import { UserAvatar } from "@/components/shell/user-avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MemberActions } from "./member-actions";
import { JoinLinkCard } from "./join-link-card";

const STATUSES = ["pending", "active", "suspended"] as const;
type Status = (typeof STATUSES)[number];

export default async function AdminMembersPage({ searchParams }: PageProps<"/admin/members">) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const status: Status = STATUSES.includes(params.status as Status) ? (params.status as Status) : "pending";
  const [t, tRole, format, counts, members, joinLink] = await Promise.all([
    getTranslations("admin.members"),
    getTranslations("role"),
    getFormatter(),
    countMembersByStatus(admin.communityId),
    listMembers(admin.communityId, { status }),
    getCommunityInvite(admin.communityId),
  ]);
  const inviteSources = await inviteSourcesForUsers(admin.communityId, members.filter((m) => m.membership.invitedViaId).map((m) => m.id));

  const tabLabel: Record<Status, string> = { pending: t("tabPending"), active: t("tabActive"), suspended: t("tabSuspended") };

  return (
    <div>
      <PageHeader title={t("title")} description={t("intro")} />

      <JoinLinkCard initial={{ url: joinLink?.enabled ? joinLink.url : null, enabled: joinLink?.enabled ?? false, useCount: joinLink?.useCount ?? 0 }} />

      <div className="mb-4 flex gap-1 border-b">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/members?status=${s}`}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm",
              s === status ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            aria-current={s === status ? "page" : undefined}
          >
            {tabLabel[s]}
            <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{counts[s]}</span>
          </Link>
        ))}
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
              <UserAvatar user={m} size={40} variant="thumb" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.name}</span>
                  {m.role === "admin" && <Badge variant="secondary">{tRole("admin")}</Badge>}
                  {m.id === admin.id && <Badge variant="outline">you</Badge>}
                </div>
                <div className="text-sm text-muted-foreground">{m.email}</div>
                <div className="text-xs text-muted-foreground">
                  {t("registeredAt", { date: format.dateTime(m.joinedAt, { dateStyle: "medium", timeStyle: "short" }) })}
                  {inviteSources.has(m.id) && (
                    <>
                      {" · "}
                      {t("invitedVia")}{" "}
                      <Link href={inviteSources.get(m.id)!.href} className="underline-offset-4 hover:underline">
                        {inviteSources.get(m.id)!.meetingTitle}
                      </Link>
                    </>
                  )}
                </div>
                {status === "pending" && (
                  <p className="mt-1 text-sm">
                    <span className="text-muted-foreground">{t("registrationMessage")}: </span>
                    {m.membership.registrationMessage ? <span className="whitespace-pre-line">{m.membership.registrationMessage}</span> : <span className="text-muted-foreground">{t("noMessage")}</span>}
                  </p>
                )}
              </div>
              <MemberActions userId={m.id} name={m.name} status={m.status} role={m.role} isSelf={m.id === admin.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
