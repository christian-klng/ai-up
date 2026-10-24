import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, communities, landingPageVersions, sitePages, type Community, type CustomSitePage } from "@/server/db/schema";
import { SITE_PAGES, validateLandingDefinition, type LandingDefinition, type LandingValidationIssue, type SitePage } from "@/lib/landing-schema";
import { MAX_CUSTOM_PAGES, PAGE_TITLE_MAX, pageSlugProblem, starterCollection, starterDefinition, starterTemplate, type SitePageKind } from "@/lib/site-pages";
import { getCurrentLandingVersion, isPageEnabled, type PageRef } from "./landing";
import { createArea } from "./knowledge";
import { saveTemplate, setAreaTemplates } from "./templates";
import { setCollectionPublic } from "./posts";
import { logger } from "@/server/logger";

/**
 * Custom public pages at "/<slug>" (docs/eigene-seiten.md): up to MAX_CUSTOM_PAGES per community on
 * top of landing, imprint and privacy. Content and history live in landing_page_versions like
 * those of the fixed pages; this module owns the page rows (address, title, switches, order).
 */

export type SitePageError = "page_limit" | "slug_invalid" | "slug_reserved" | "slug_taken" | "title_invalid" | "definition_invalid";
export type SitePageResult = { ok: true; page: CustomSitePage } | { ok: false; error: SitePageError; issues?: LandingValidationIssue[] };

export async function listSitePages(communityId: string): Promise<CustomSitePage[]> {
  return db.select().from(sitePages).where(eq(sitePages.communityId, communityId)).orderBy(asc(sitePages.sortOrder), asc(sitePages.createdAt));
}

export async function getSitePageBySlug(communityId: string, slug: string): Promise<CustomSitePage | undefined> {
  return db.query.sitePages.findFirst({ where: and(eq(sitePages.communityId, communityId), eq(sitePages.slug, slug)) });
}

export async function getSitePageById(communityId: string, id: string): Promise<CustomSitePage | undefined> {
  return db.query.sitePages.findFirst({ where: and(eq(sitePages.communityId, communityId), eq(sitePages.id, id)) });
}

/** Links for the public header: published pages marked for the navigation, in admin order. */
export async function listNavPages(communityId: string): Promise<{ title: string; href: string }[]> {
  const rows = await listSitePages(communityId);
  return rows.filter((p) => p.enabled && p.showInNav).map((p) => ({ title: p.title, href: `/${p.slug}` }));
}

function slugError(slug: string): SitePageError | null {
  const problem = pageSlugProblem(slug);
  return problem === "invalid" ? "slug_invalid" : problem === "reserved" ? "slug_reserved" : null;
}

function titleOk(title: string): boolean {
  const t = title.trim();
  return t.length > 0 && t.length <= PAGE_TITLE_MAX;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export type CreateSitePageInput = { slug: string; title: string; showInNav?: boolean; definition: unknown };

/**
 * Creates a page (switched off) with its first version. The limit is checked under a lock on the
 * community row, so the UI and an MCP client cannot end up at six pages together.
 */
export async function createSitePage(communityId: string, input: CreateSitePageInput, actorId: string, source: "ui" | "mcp"): Promise<SitePageResult> {
  const slug = input.slug.trim();
  const sErr = slugError(slug);
  if (sErr) return { ok: false, error: sErr };
  if (!titleOk(input.title)) return { ok: false, error: "title_invalid" };
  const validated = validateLandingDefinition(input.definition);
  if (!validated.ok) return { ok: false, error: "definition_invalid", issues: validated.issues };
  try {
    const page = await db.transaction(async (tx) => {
      await tx.execute(sql`select ${communities.id} from ${communities} where ${communities.id} = ${communityId} for update`);
      const [{ n }] = await tx.select({ n: count() }).from(sitePages).where(eq(sitePages.communityId, communityId));
      if (n >= MAX_CUSTOM_PAGES) return null;
      const [{ max }] = await tx
        .select({ max: sql<number>`coalesce(max(${sitePages.sortOrder}), -1)::int` })
        .from(sitePages)
        .where(eq(sitePages.communityId, communityId));
      const [row] = await tx
        .insert(sitePages)
        .values({ communityId, slug, title: input.title.trim(), showInNav: input.showInNav ?? false, sortOrder: max + 1, createdBy: actorId })
        .returning();
      await tx.insert(landingPageVersions).values({
        communityId,
        page: "custom",
        sitePageId: row.id,
        version: 1,
        definition: validated.definition,
        source,
        changeNote: "created",
        changedBy: actorId,
      });
      return row;
    });
    if (!page) return { ok: false, error: "page_limit" };
    await db.insert(auditLog).values({ communityId, actorId, action: "site_page.created", targetType: "site_page", targetId: page.id, details: { slug, source } });
    return { ok: true, page };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "slug_taken" };
    throw err;
  }
}

/**
 * Creates a page of one of the starter kinds. Blog and changelog also get a collection (shown on
 * public pages) with a matching template – each setup step on its own, so a failing template still
 * leaves a usable page behind (same idea as createCommunityWithSetup).
 */
export async function createSitePageWithSetup(
  community: Pick<Community, "id" | "defaultLocale">,
  kind: SitePageKind,
  input: { slug: string; title: string; showInNav?: boolean },
  actorId: string,
  source: "ui" | "mcp",
): Promise<SitePageResult & { collectionId?: string }> {
  const communityId = community.id;
  const locale = community.defaultLocale;
  // Cheap checks first, so a full limit does not leave an orphaned collection behind.
  const sErr = slugError(input.slug.trim());
  if (sErr) return { ok: false, error: sErr };
  if (!titleOk(input.title)) return { ok: false, error: "title_invalid" };
  if ((await listSitePages(communityId)).length >= MAX_CUSTOM_PAGES) return { ok: false, error: "page_limit" };
  if (await getSitePageBySlug(communityId, input.slug.trim())) return { ok: false, error: "slug_taken" };

  let collectionId: string | undefined;
  if (kind === "blog" || kind === "changelog") {
    const area = await createArea(communityId, { ...starterCollection(kind, locale), layout: kind === "blog" ? "blog" : "list", sortMode: "newest" }, actorId);
    collectionId = area.id;
    try {
      await setCollectionPublic(communityId, area.id, true, actorId);
    } catch (err) {
      logger.error({ err, communityId, areaId: area.id }, "site page setup: marking the collection public failed");
    }
    try {
      const tpl = starterTemplate(kind, locale);
      const saved = await saveTemplate(communityId, tpl, actorId, "created with a site page");
      if (!("error" in saved)) await setAreaTemplates(communityId, area.id, [saved.id], actorId);
    } catch (err) {
      logger.error({ err, communityId, areaId: area.id }, "site page setup: template failed");
    }
  }
  const res = await createSitePage(communityId, { ...input, definition: starterDefinition(kind, input.title.trim(), locale, collectionId) }, actorId, source);
  return { ...res, collectionId };
}

export type SitePageSettings = { slug?: string; title?: string; showInNav?: boolean; sortOrder?: number };

/** Merge semantics: omitted fields keep their value. */
export async function updateSitePageSettings(communityId: string, id: string, patch: SitePageSettings, actorId: string): Promise<SitePageResult | undefined> {
  const existing = await getSitePageById(communityId, id);
  if (!existing) return undefined;
  const next: Partial<CustomSitePage> = {};
  if (patch.slug !== undefined && patch.slug.trim() !== existing.slug) {
    const sErr = slugError(patch.slug.trim());
    if (sErr) return { ok: false, error: sErr };
    next.slug = patch.slug.trim();
  }
  if (patch.title !== undefined) {
    if (!titleOk(patch.title)) return { ok: false, error: "title_invalid" };
    next.title = patch.title.trim();
  }
  if (patch.showInNav !== undefined) next.showInNav = patch.showInNav;
  if (patch.sortOrder !== undefined) next.sortOrder = patch.sortOrder;
  if (Object.keys(next).length === 0) return { ok: true, page: existing };
  try {
    const [row] = await db.update(sitePages).set(next).where(and(eq(sitePages.id, id), eq(sitePages.communityId, communityId))).returning();
    await db.insert(auditLog).values({ communityId, actorId, action: "site_page.updated", targetType: "site_page", targetId: id, details: next });
    return { ok: true, page: row };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "slug_taken" };
    throw err;
  }
}

export async function setSitePageEnabled(communityId: string, id: string, enabled: boolean): Promise<CustomSitePage | undefined> {
  const [row] = await db.update(sitePages).set({ enabled }).where(and(eq(sitePages.id, id), eq(sitePages.communityId, communityId))).returning();
  return row;
}

/** Swaps the page with its neighbour in the admin/navigation order. */
export async function moveSitePage(communityId: string, id: string, direction: "up" | "down"): Promise<void> {
  const pages = await listSitePages(communityId);
  const i = pages.findIndex((p) => p.id === id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= pages.length) return;
  const reordered = [...pages];
  [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
  await db.transaction(async (tx) => {
    for (const [index, p] of reordered.entries()) {
      if (p.sortOrder !== index) await tx.update(sitePages).set({ sortOrder: index }).where(eq(sitePages.id, p.id));
    }
  });
}

/** Deletes the page and its versions (cascade). A collection created with it stays. */
export async function deleteSitePage(communityId: string, id: string, actorId: string): Promise<boolean> {
  const [row] = await db.delete(sitePages).where(and(eq(sitePages.id, id), eq(sitePages.communityId, communityId))).returning();
  if (!row) return false;
  await db.insert(auditLog).values({ communityId, actorId, action: "site_page.deleted", targetType: "site_page", targetId: id, details: { slug: row.slug } });
  return true;
}

/** One page as the admin UI, the MCP tools and the routes see it – fixed or custom. */
export type ResolvedPage = {
  ref: PageRef;
  /** "landing" | "imprint" | "privacy" | the custom slug */
  name: string;
  url: string;
  enabled: boolean;
  sitePage: CustomSitePage | null;
};

const FIXED_URLS: Record<SitePage, string> = { landing: "/", imprint: "/imprint", privacy: "/privacy" };

export function fixedPageUrl(page: SitePage): string {
  return FIXED_URLS[page];
}

/** Resolves "landing" | "imprint" | "privacy" or a custom page slug (the names cannot collide, see RESERVED_PAGE_SLUGS). */
export async function resolvePage(community: Community, name: string): Promise<ResolvedPage | undefined> {
  if ((SITE_PAGES as readonly string[]).includes(name)) {
    const page = name as SitePage;
    return { ref: page, name: page, url: FIXED_URLS[page], enabled: isPageEnabled(community, page), sitePage: null };
  }
  const sitePage = await getSitePageBySlug(community.id, name);
  if (!sitePage) return undefined;
  return { ref: { sitePageId: sitePage.id }, name: sitePage.slug, url: `/${sitePage.slug}`, enabled: sitePage.enabled, sitePage };
}

/** The published definition of a custom page, or undefined when it is missing or switched off. */
export async function getPublishedSitePage(communityId: string, slug: string): Promise<{ page: CustomSitePage; definition: LandingDefinition } | undefined> {
  const page = await getSitePageBySlug(communityId, slug);
  if (!page?.enabled || pageSlugProblem(slug)) return undefined;
  const current = await getCurrentLandingVersion(communityId, { sitePageId: page.id });
  return current ? { page, definition: current.definition } : undefined;
}
