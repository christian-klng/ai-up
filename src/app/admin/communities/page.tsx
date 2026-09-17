import { getFormatter, getTranslations } from "next-intl/server";
import { requireRootAdmin } from "@/server/auth/session";
import { listSubCommunities, loadRootCommunity } from "@/server/domain/communities";
import { COMMUNITY_PURGE_GRACE_DAYS } from "@/server/workflows/queue";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { CommunityRowActions } from "./row-actions";
import { AllowSubcommunitiesSwitch } from "./allow-switch";

/**
 * The operator's view of every sub-community: who started it, how many members it has, and the
 * switch that decides whether ordinary members may start one at all.
 */
export default async function AdminCommunitiesPage() {
  await requireRootAdmin();
  const [t, format, communities, rootCommunity] = await Promise.all([
    getTranslations("admin.communities"),
    getFormatter(),
    listSubCommunities({ includeDeleted: true }),
    loadRootCommunity(),
  ]);

  return (
    <div>
      <PageHeader title={t("title")} description={t("intro")} />

      <AllowSubcommunitiesSwitch initial={rootCommunity.allowMemberSubcommunities} />

      {communities.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {communities.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  <code className="rounded bg-muted px-1.5 text-xs text-muted-foreground">/c/{c.slug}</code>
                  {c.deletedAt && <Badge variant="destructive">{t("deleted")}</Badge>}
                </div>
                <div className="text-sm text-muted-foreground">{t("members", { count: c.memberCount })}</div>
                <div className="text-xs text-muted-foreground">
                  {t("createdAt", { date: format.dateTime(c.createdAt, { dateStyle: "medium" }) })}
                  {c.deletedAt && ` · ${t("purgeAt", { date: format.dateTime(new Date(c.deletedAt.getTime() + COMMUNITY_PURGE_GRACE_DAYS * 86_400_000), { dateStyle: "medium" }) })}`}
                </div>
              </div>
              <CommunityRowActions id={c.id} name={c.name} deleted={Boolean(c.deletedAt)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
