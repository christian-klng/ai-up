import { getTranslations } from "next-intl/server";
import { requirePagesAdmin } from "@/server/auth/session";
import { requireCommunity } from "@/server/auth/session";
import { getCurrentLandingVersion, isPageEnabled, listLandingMedia, listLandingVersions, type PageRef } from "@/server/domain/landing";
import { getEventsWidgetUrl } from "@/server/domain/integrations";
import { resolvePostFeeds } from "@/server/domain/posts";
import { fixedPageUrl, listNavPages, listSitePages } from "@/server/domain/site-pages";
import { SITE_PAGES } from "@/lib/landing-schema";
import { MAX_CUSTOM_PAGES, pageSlugProblem } from "@/lib/site-pages";
import { PageHeader } from "@/components/common/page-header";
import { LandingAdmin, type PageState } from "./landing-admin";

export default async function AdminPagesPage() {
  const user = await requirePagesAdmin();
  const [t, settings, media, eventsUrl, customPages, nav] = await Promise.all([
    getTranslations("admin.landing"),
    requireCommunity(),
    listLandingMedia(user.communityId),
    getEventsWidgetUrl(user.communityId),
    listSitePages(user.communityId),
    listNavPages(user.communityId),
  ]);

  const load = async (ref: PageRef, base: Omit<PageState, "definition" | "currentVersion" | "versions" | "posts">): Promise<PageState> => {
    const [current, versions] = await Promise.all([getCurrentLandingVersion(user.communityId, ref), listLandingVersions(user.communityId, ref)]);
    const posts = current ? await resolvePostFeeds(user.communityId, current.definition, { locale: settings.defaultLocale, pageSlug: base.custom?.slug }) : {};
    return {
      ...base,
      definition: current?.definition ?? null,
      currentVersion: current?.version ?? null,
      versions: versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() })),
      posts,
    };
  };

  const pages = await Promise.all([
    ...SITE_PAGES.map((page) => load(page, { key: { fixed: page }, url: fixedPageUrl(page), enabled: isPageEnabled(settings, page), custom: null })),
    ...customPages.map((p) =>
      load(
        { sitePageId: p.id },
        {
          key: { customId: p.id },
          url: `/${p.slug}`,
          enabled: p.enabled,
          custom: { id: p.id, slug: p.slug, title: p.title, showInNav: p.showInNav, slugReserved: pageSlugProblem(p.slug) !== null },
        },
      ),
    ),
  ]);

  return (
    <div className="max-w-3xl">
      <PageHeader title={t("title")} description={t("intro")} />
      <LandingAdmin
        pages={pages}
        maxCustomPages={MAX_CUSTOM_PAGES}
        settings={settings}
        eventsUrl={eventsUrl}
        nav={nav}
        media={media.map((m) => ({ id: m.id, originalName: m.originalName, width: m.width, height: m.height, size: m.size, createdAt: m.createdAt.toISOString() }))}
      />
    </div>
  );
}
