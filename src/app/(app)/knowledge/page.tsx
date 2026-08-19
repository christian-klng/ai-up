import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { listAreas } from "@/server/domain/knowledge";
import { PageHeader } from "@/components/common/page-header";
import { AreaIcon } from "@/components/knowledge/area-icon";
import { Button } from "@/components/ui/button";

export default async function KnowledgeIndexPage() {
  const user = await requireUser();
  const [t, tc, tAdmin, areas] = await Promise.all([getTranslations("knowledge"), getTranslations("common"), getTranslations("admin.knowledge"), listAreas()]);

  return (
    <div>
      <PageHeader title={t("title")} description={t("intro")} />
      {areas.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">{t("noAreas")}</p>
          {user.role === "admin" && (
            <Button asChild className="mt-4">
              <Link href="/admin/knowledge">{t("noAreasAdminHint")}</Link>
            </Button>
          )}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {areas.map((a) => (
            <li key={a.id}>
              <Link href={`/knowledge/${a.slug}`} className="group flex h-full flex-col gap-3 rounded-lg border bg-card p-5 transition-colors hover:bg-accent/40">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <AreaIcon icon={a.icon} className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium group-hover:underline">{a.name}</span>
                    <span className="block text-xs text-muted-foreground">{tAdmin("contentCount", { count: a.contentCount })}</span>
                  </span>
                </div>
                <p className="line-clamp-3 text-sm text-muted-foreground">{a.purpose}</p>
                <span className="mt-auto inline-flex items-center gap-1 text-sm text-primary">
                  {tc("open")} <ArrowRight className="size-3.5" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
