import { getTranslations } from "next-intl/server";
import type { Community } from "@/server/db/schema";
import { collectPostsCollectionIds, usesEventSections, type LandingDefinition } from "@/lib/landing-schema";
import { getEventsWidgetUrl } from "@/server/domain/integrations";
import { resolvePostFeeds } from "@/server/domain/posts";
import { resolveSectionForms } from "@/server/domain/collection-forms";
import { listNavPages } from "@/server/domain/site-pages";
import { LandingShell, type LandingLabels } from "./landing-shell";

/** Labels of the public shell; the admin inline editor builds the same set on the client. */
export async function landingLabels(): Promise<LandingLabels> {
  const [t, tCommon] = await Promise.all([getTranslations("landing"), getTranslations("common")]);
  return {
    toApp: t("toApp"),
    signIn: t("signIn"),
    register: t("register"),
    menu: tCommon("menu"),
    eventsUnavailable: t("eventsUnavailable"),
    orderStatusHint: t("orderStatusHint"),
    teamDetails: t("teamDetails"),
    noPosts: t("noPosts"),
    olderPosts: t("olderPosts"),
    newerPosts: t("newerPosts"),
    postsUnavailable: t("postsUnavailable"),
    formUnavailable: t("formUnavailable"),
    formOpen: t("formOpen"),
  };
}

/** Server wrapper for every public page (landing, imprint, privacy, custom pages, posts): resolves labels, navigation and posts. */
export async function LandingView({
  definition,
  settings,
  signedIn,
  pageSlug,
  listPage,
  children,
}: {
  definition: LandingDefinition;
  settings: Community;
  signedIn: boolean;
  /** Custom page being rendered – post links prefer it */
  pageSlug?: string;
  /** `?page=` of the posts list */
  listPage?: number;
  /** Replaces the sections (single post) */
  children?: React.ReactNode;
}) {
  const [labels, eventsUrl, nav, posts, forms] = await Promise.all([
    landingLabels(),
    usesEventSections(definition) ? getEventsWidgetUrl(settings.id) : null,
    listNavPages(settings.id),
    !children && collectPostsCollectionIds(definition).length > 0 ? resolvePostFeeds(settings.id, definition, { locale: settings.defaultLocale, pageSlug, listPage }) : undefined,
    children ? undefined : resolveSectionForms(settings.id, definition),
  ]);
  return (
    <LandingShell definition={definition} settings={settings} signedIn={signedIn} eventsUrl={eventsUrl} labels={labels} nav={nav} posts={posts} forms={forms}>
      {children}
    </LandingShell>
  );
}
