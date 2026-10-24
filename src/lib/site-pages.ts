import type { LandingDefinition } from "./landing-schema";
import type { StructureDefinition } from "./structures/types";

/**
 * Custom public pages at "/<slug>" (docs/eigene-seiten.md). Pure – used by the proxy, the routes,
 * the domain layer, the admin UI and the MCP tools alike.
 */

/** Custom pages per community, on top of landing, imprint and privacy. */
export const MAX_CUSTOM_PAGES = 5;

export const PAGE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PAGE_SLUG_MAX = 60;
export const PAGE_TITLE_MAX = 40;

/**
 * Every top-level path segment the app uses itself. A custom page must never take one of these:
 * the static route would win and the page would silently disappear. `site-pages.test.ts` checks
 * that every directory directly under src/app is listed – add new top-level routes here.
 */
export const RESERVED_PAGE_SLUGS: ReadonlySet<string> = new Set([
  // app
  "home",
  "knowledge",
  "meetings",
  "members",
  "messages",
  "notifications",
  "profile",
  "workflows",
  "agents",
  "communities",
  "admin",
  // auth and public flows
  "login",
  "register",
  "pending",
  "invite",
  "join",
  "auth",
  "c",
  "imprint",
  "privacy",
  // technical
  "api",
  "_next",
  "vendor",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  // page names – keeps the MCP `page` parameter unambiguous
  "landing",
  // kept free for later
  "settings",
  "search",
  "help",
  "docs",
  "status",
]);

/** Post slugs that collide with routes below a custom page. */
export const RESERVED_POST_SLUGS: ReadonlySet<string> = new Set(["feed.xml"]);

export type PageSlugProblem = "invalid" | "reserved";

export function pageSlugProblem(slug: string): PageSlugProblem | null {
  if (!slug || slug.length > PAGE_SLUG_MAX || !PAGE_SLUG_RE.test(slug)) return "invalid";
  if (RESERVED_PAGE_SLUGS.has(slug)) return "reserved";
  return null;
}

/**
 * Paths the proxy lets through without a session because they may be a custom page or one of its
 * posts: one or two segments, the first shaped like a page slug and not reserved. Whether the page
 * exists is the route's business (404 otherwise) – the proxy has no database.
 */
export function isCustomPagePath(pathname: string): boolean {
  const parts = pathname.split("/").slice(1);
  if (parts.length < 1 || parts.length > 2 || parts.some((p) => p === "")) return false;
  return pageSlugProblem(parts[0]) === null;
}

/** Kinds offered when a page is created; blog and changelog also get a collection and a template. */
export const SITE_PAGE_KINDS = ["blank", "features", "blog", "changelog"] as const;
export type SitePageKind = (typeof SITE_PAGE_KINDS)[number];

type Locale = "de" | "en";
type Localized = Record<Locale, string>;

const STARTER: Record<string, Localized> = {
  blankBody: { de: "Hier entsteht eine neue Seite.", en: "A new page is on its way." },
  featuresHeadline: { de: "Was dich erwartet", en: "What you get" },
  featuresSubline: { de: "Die wichtigsten Funktionen auf einen Blick.", en: "The most important features at a glance." },
  featuresItemTitle: { de: "Funktion", en: "Feature" },
  featuresItemText: { de: "Beschreibe hier in ein, zwei Sätzen, was diese Funktion leistet.", en: "Describe in a sentence or two what this feature does." },
  ctaHeadline: { de: "Neugierig geworden?", en: "Curious?" },
  ctaButton: { de: "Jetzt registrieren", en: "Sign up now" },
  blogSubline: { de: "Neuigkeiten, Anleitungen und Einblicke.", en: "News, guides and insights." },
  changelogSubline: { de: "Was sich zuletzt verändert hat.", en: "What changed recently." },
  emptyPosts: { de: "Hier erscheinen bald die ersten Beiträge.", en: "The first posts will appear here soon." },
  blogCollection: { de: "Blog", en: "Blog" },
  blogPurpose: { de: "Beiträge für den öffentlichen Blog. Veröffentlichte Einträge erscheinen auf der Webseite.", en: "Posts for the public blog. Published entries appear on the website." },
  changelogCollection: { de: "Changelog", en: "Changelog" },
  changelogPurpose: { de: "Änderungen für den öffentlichen Changelog. Veröffentlichte Einträge erscheinen auf der Webseite.", en: "Changes for the public changelog. Published entries appear on the website." },
};

function starterText(key: keyof typeof STARTER, locale: Locale): string {
  return STARTER[key][locale];
}

/** First version of a new page. `collectionId` is required for blog and changelog. */
export function starterDefinition(kind: SitePageKind, title: string, locale: Locale, collectionId?: string): LandingDefinition {
  const t = (key: keyof typeof STARTER) => starterText(key, locale);
  const meta = { title };
  const footer = { links: [] };
  switch (kind) {
    case "features":
      return {
        meta,
        footer,
        sections: [
          { type: "hero", headline: t("featuresHeadline"), subline: t("featuresSubline"), showLogo: false },
          {
            type: "features",
            items: (["sparkles", "zap", "users"] as const).map((icon) => ({ icon, title: t("featuresItemTitle"), text: t("featuresItemText") })),
          },
          { type: "cta", headline: t("ctaHeadline"), button: { label: t("ctaButton"), href: "/register" } },
        ],
      };
    case "blog":
    case "changelog":
      if (!collectionId) throw new Error(`${kind} pages need a collection`);
      return {
        meta,
        footer,
        sections: [
          { type: "hero", headline: title, subline: t(kind === "blog" ? "blogSubline" : "changelogSubline"), showLogo: false },
          { type: "posts", collectionId, layout: kind === "blog" ? "cards" : "timeline", limit: 10, emptyText: t("emptyPosts") },
        ],
      };
    default:
      return { meta, footer, sections: [{ type: "markdown", title, body: t("blankBody") }] };
  }
}

/** Collection created together with a blog or changelog page. */
export function starterCollection(kind: "blog" | "changelog", locale: Locale): { name: string; purpose: string; icon: string } {
  return kind === "blog"
    ? { name: starterText("blogCollection", locale), purpose: starterText("blogPurpose", locale), icon: "newspaper" }
    : { name: starterText("changelogCollection", locale), purpose: starterText("changelogPurpose", locale), icon: "clock" };
}

/** Template created together with a blog or changelog page; the post page reads it as an article. */
export function starterTemplate(kind: "blog" | "changelog", locale: Locale): { name: string; description: string; icon: string; definition: StructureDefinition } {
  const de = locale === "de";
  if (kind === "blog") {
    return {
      name: de ? "Blog-Artikel" : "Blog post",
      description: de ? "Beitrag mit Titelbild, Anreißer und Text." : "Post with cover image, teaser and text.",
      icon: "newspaper",
      definition: {
        formatVersion: 1,
        elements: [
          { key: "cover", type: "image", label: de ? "Titelbild" : "Cover image" },
          { key: "teaser", type: "textarea", label: de ? "Anreißer" : "Teaser", help: de ? "Ein, zwei Sätze für die Übersicht." : "One or two sentences for the overview.", maxLength: 300 },
          { key: "body", type: "markdown", label: de ? "Text" : "Text", required: true },
        ],
      },
    };
  }
  return {
    name: de ? "Changelog-Eintrag" : "Changelog entry",
    description: de ? "Version mit Zusammenfassung und einzelnen Änderungen." : "Version with summary and individual changes.",
    icon: "clock",
    definition: {
      formatVersion: 1,
      elements: [
        { key: "summary", type: "textarea", label: de ? "Zusammenfassung" : "Summary", maxLength: 500 },
        { key: "changes", type: "markdown", multiple: true, label: de ? "Änderungen" : "Changes", required: true },
      ],
    },
  };
}
