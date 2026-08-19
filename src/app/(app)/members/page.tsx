import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Search } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { listActiveMembers } from "@/server/domain/users";
import { PageHeader } from "@/components/common/page-header";
import { UserAvatar } from "@/components/shell/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export default async function MembersPage({ searchParams }: PageProps<"/members">) {
  await requireUser();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const [t, tCommon, format, members] = await Promise.all([
    getTranslations("members"),
    getTranslations("common"),
    getFormatter(),
    listActiveMembers(q || undefined),
  ]);

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("count", { count: members.length })}
        actions={
          <form className="relative" role="search">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input name="q" defaultValue={q} placeholder={t("searchPlaceholder")} className="w-64 pl-8" aria-label={tCommon("search")} />
          </form>
        }
      />

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {members.map((m) => {
            return (
              <li key={m.id}>
                <Link href={`/members/${m.id}`} className="flex h-full items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/40">
                <span className="relative">
                  <UserAvatar user={m} size={44} variant="thumb" />
                  {m.online && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-emerald-500 ring-2 ring-card" title={tCommon("online")} />}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{m.name}</span>
                    {m.role === "admin" && <Badge variant="secondary">{t("adminBadge")}</Badge>}
                  </div>
                  {m.bio ? (
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{m.bio}</p>
                  ) : (
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("memberSince", { date: format.dateTime(m.createdAt, { dateStyle: "medium" }) })}</p>
                  )}
                </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
