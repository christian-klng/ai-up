import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { listSpaces } from "@/server/domain/meetings";
import { PageHeader } from "@/components/common/page-header";
import { AreaIcon } from "@/components/knowledge/area-icon";
import { LiveDot } from "@/components/meetings/meeting-badges";
import { Button } from "@/components/ui/button";

export default async function MeetingsIndexPage() {
  const user = await requireUser();
  const [t, tc, tAdmin, spaces] = await Promise.all([getTranslations("meetings"), getTranslations("common"), getTranslations("admin.meetings"), listSpaces()]);
  return (
    <div>
      <PageHeader title={t("title")} description={t("intro")} />
      {spaces.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">{t("noSpaces")}</p>
          {user.role === "admin" && (
            <Button asChild className="mt-4">
              <Link href="/admin/meetings">{t("noSpacesAdminHint")}</Link>
            </Button>
          )}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {spaces.map((s) => (
            <li key={s.id}>
              <Link href={`/meetings/${s.slug}`} className="group flex h-full flex-col gap-3 rounded-lg border bg-card p-5 transition-colors hover:bg-accent/40">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <AreaIcon icon={s.icon} className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 truncate font-medium group-hover:underline">
                      {s.name}
                      {s.liveCount > 0 && <LiveDot />}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {tAdmin("meetingCount", { count: s.meetingCount })}
                      {s.liveCount > 0 && ` · ${t("liveNow", { count: s.liveCount })}`}
                    </span>
                  </span>
                </div>
                <p className="line-clamp-3 text-sm text-muted-foreground">{s.purpose}</p>
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
