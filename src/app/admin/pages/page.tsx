import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/server/auth/session";
import { getAppSettings } from "@/server/domain/settings";
import { getCurrentLandingVersion, isPageEnabled, listLandingMedia, listLandingVersions } from "@/server/domain/landing";
import { SITE_PAGES } from "@/lib/landing-schema";
import { PageHeader } from "@/components/common/page-header";
import { LandingAdmin, type PageState } from "./landing-admin";

export default async function AdminPagesPage() {
  await requireAdmin();
  const [t, settings, media] = await Promise.all([getTranslations("admin.landing"), getAppSettings(), listLandingMedia()]);
  const pages = Object.fromEntries(
    await Promise.all(
      SITE_PAGES.map(async (page) => {
        const [current, versions] = await Promise.all([getCurrentLandingVersion(page), listLandingVersions(page)]);
        const state: PageState = {
          enabled: isPageEnabled(settings, page),
          definition: current?.definition ?? null,
          currentVersion: current?.version ?? null,
          versions: versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() })),
        };
        return [page, state] as const;
      }),
    ),
  ) as Record<(typeof SITE_PAGES)[number], PageState>;

  return (
    <div className="max-w-3xl">
      <PageHeader title={t("title")} description={t("intro")} />
      <LandingAdmin
        pages={pages}
        settings={settings}
        media={media.map((m) => ({ id: m.id, originalName: m.originalName, width: m.width, height: m.height }))}
      />
    </div>
  );
}
