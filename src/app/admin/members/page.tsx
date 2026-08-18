import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireAdmin } from "@/server/auth/session";
import { countUsersByStatus, listUsers } from "@/server/domain/users";
import { PageHeader } from "@/components/common/page-header";
import { UserAvatar } from "@/components/shell/user-avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MemberActions } from "./member-actions";

const STATUSES = ["pending", "active", "suspended"] as const;
type Status = (typeof STATUSES)[number];

export default async function AdminMembersPage({ searchParams }: PageProps<"/admin/members">) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const status: Status = STATUSES.includes(params.status as Status) ? (params.status as Status) : "pending";
  const [t, tRole, format, counts, members] = await Promise.all([
    getTranslations("admin.members"),
    getTranslations("role"),
    getFormatter(),
    countUsersByStatus(),
    listUsers({ status }),
  ]);

  const tabLabel: Record<Status, string> = { pending: t("tabPending"), active: t("tabActive"), suspended: t("tabSuspended") };

  return (
    <div>
      <PageHeader title={t("title")} description={t("intro")} />

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
                <div className="text-xs text-muted-foreground">{t("registeredAt", { date: format.dateTime(m.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}</div>
                {status === "pending" && (
                  <p className="mt-1 text-sm">
                    <span className="text-muted-foreground">{t("registrationMessage")}: </span>
                    {m.registrationMessage ? <span className="whitespace-pre-line">{m.registrationMessage}</span> : <span className="text-muted-foreground">{t("noMessage")}</span>}
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
