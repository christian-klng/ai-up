import { and, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { knowledgeAreas, landingPageVersions, mediaFiles, sitePages, users, type Community, type LandingPageVersion, type MediaFile } from "@/server/db/schema";
import {
  validateLandingDefinition,
  collectLandingMediaIds,
  collectPostsCollectionIds,
  usesEventSections,
  type LandingDefinition,
  type LandingValidationIssue,
  type SitePage,
} from "@/lib/landing-schema";
import { RESERVED_PAGE_SLUGS } from "@/lib/site-pages";
import { getEventsWidgetUrl } from "./integrations";

/**
 * Public site pages domain (landing, imprint, privacy and the custom pages of site-pages.ts): one
 * definition per page stored as append-only versions (current = highest version, restore =
 * copy-forward – same principle as content/workflow versions). All pages share the schema and the
 * "landing" image pool.
 */

/** Which page a version belongs to: one of the three fixed pages or a custom page (by id). */
export type PageRef = SitePage | { sitePageId: string };

function pageWhere(communityId: string, ref: PageRef): SQL | undefined {
  return typeof ref === "string"
    ? and(eq(landingPageVersions.communityId, communityId), eq(landingPageVersions.page, ref), isNull(landingPageVersions.sitePageId))
    : and(eq(landingPageVersions.communityId, communityId), eq(landingPageVersions.sitePageId, ref.sitePageId));
}

/** Short form for logs and audit details. */
export function pageLabel(ref: PageRef): string {
  return typeof ref === "string" ? ref : `custom:${ref.sitePageId}`;
}

export type LandingVersionListItem = Pick<LandingPageVersion, "id" | "version" | "source" | "changeNote" | "createdAt"> & {
  changedByName: string | null;
};

/** Whether a page is publicly served, from the per-page flags on the community. */
export function isPageEnabled(settings: Pick<Community, "landingEnabled" | "imprintEnabled" | "privacyEnabled">, page: SitePage): boolean {
  return page === "landing" ? settings.landingEnabled : page === "imprint" ? settings.imprintEnabled : settings.privacyEnabled;
}

/** The communities column holding the enabled flag for a page. */
export function pageEnabledColumn(page: SitePage): "landingEnabled" | "imprintEnabled" | "privacyEnabled" {
  return page === "landing" ? "landingEnabled" : page === "imprint" ? "imprintEnabled" : "privacyEnabled";
}

export async function getCurrentLandingVersion(communityId: string, page: PageRef): Promise<LandingPageVersion | undefined> {
  return db.query.landingPageVersions.findFirst({ where: pageWhere(communityId, page), orderBy: desc(landingPageVersions.version) });
}

export async function getLandingVersion(communityId: string, page: PageRef, version: number): Promise<LandingPageVersion | undefined> {
  return db.query.landingPageVersions.findFirst({ where: and(pageWhere(communityId, page), eq(landingPageVersions.version, version)) });
}

export async function listLandingVersions(communityId: string, page: PageRef, limit = 50): Promise<LandingVersionListItem[]> {
  const rows = await db
    .select({
      id: landingPageVersions.id,
      version: landingPageVersions.version,
      source: landingPageVersions.source,
      changeNote: landingPageVersions.changeNote,
      createdAt: landingPageVersions.createdAt,
      changedByName: users.name,
    })
    .from(landingPageVersions)
    .leftJoin(users, eq(users.id, landingPageVersions.changedBy))
    .where(pageWhere(communityId, page))
    .orderBy(desc(landingPageVersions.version))
    .limit(limit);
  return rows;
}

export type LandingMediaItem = Pick<MediaFile, "id" | "originalName" | "mime" | "size" | "width" | "height" | "createdAt">;

/** Publicly served images usable on any site page (purpose "landing" – one shared pool). */
export async function listLandingMedia(communityId: string): Promise<LandingMediaItem[]> {
  return db
    .select({
      id: mediaFiles.id,
      originalName: mediaFiles.originalName,
      mime: mediaFiles.mime,
      size: mediaFiles.size,
      width: mediaFiles.width,
      height: mediaFiles.height,
      createdAt: mediaFiles.createdAt,
    })
    .from(mediaFiles)
    .where(and(eq(mediaFiles.communityId, communityId), eq(mediaFiles.purpose, "landing")))
    .orderBy(desc(mediaFiles.createdAt))
    .limit(100);
}

export type SaveLandingResult =
  | { ok: true; row: LandingPageVersion; warnings: string[] }
  | { ok: false; issues: LandingValidationIssue[] };

/** Validates and appends a new version for one page (hard gate for UI and MCP alike). */
export async function saveLandingVersion(
  communityId: string,
  page: PageRef,
  definition: unknown,
  actorId: string,
  source: "ui" | "mcp",
  changeNote?: string | null,
): Promise<SaveLandingResult> {
  const validated = validateLandingDefinition(definition);
  if (!validated.ok) return { ok: false, issues: validated.issues };
  const warnings = await landingWarnings(communityId, validated.definition);
  const row = await insertNextVersion(communityId, page, validated.definition, actorId, source, changeNote ?? null);
  return { ok: true, row, warnings };
}

/** Restores an older version by copying it forward as a new version (history stays intact). */
export async function restoreLandingVersion(
  communityId: string,
  page: PageRef,
  version: number,
  actorId: string,
  source: "ui" | "mcp",
  note?: string | null,
): Promise<LandingPageVersion | undefined> {
  const v = await getLandingVersion(communityId, page, version);
  if (!v) return undefined;
  return insertNextVersion(communityId, page, v.definition, actorId, source, note ?? `restored version ${version}`);
}

async function insertNextVersion(communityId: string, page: PageRef, definition: LandingDefinition, actorId: string, source: "ui" | "mcp", changeNote: string | null) {
  const target = typeof page === "string" ? { page, sitePageId: null } : { page: "custom", sitePageId: page.sitePageId };
  // The unique indexes on (community, page, version) resp. (site page, version) catch concurrent
  // writers; one retry is enough here.
  for (let attempt = 0; ; attempt++) {
    const current = await getCurrentLandingVersion(communityId, page);
    try {
      const [row] = await db
        .insert(landingPageVersions)
        .values({ communityId, ...target, version: (current?.version ?? 0) + 1, definition, source, changeNote, changedBy: actorId })
        .returning();
      return row;
    } catch (err) {
      if (attempt >= 1) throw err;
    }
  }
}

/** Everything that is valid but would not show on the public page. */
export async function landingWarnings(communityId: string, definition: LandingDefinition): Promise<string[]> {
  const [media, events, posts, links] = await Promise.all([
    mediaWarnings(definition),
    eventWarnings(communityId, definition),
    postsWarnings(communityId, definition),
    linkWarnings(communityId, definition),
  ]);
  return [...media, ...events, ...posts, ...links];
}

/** Warns about referenced media that will not load on a public page (wrong purpose or missing). */
async function mediaWarnings(definition: LandingDefinition): Promise<string[]> {
  const ids = collectLandingMediaIds(definition);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: mediaFiles.id, purpose: mediaFiles.purpose })
    .from(mediaFiles)
    .where(inArray(mediaFiles.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r.purpose]));
  const warnings: string[] = [];
  for (const id of ids) {
    const purpose = byId.get(id);
    if (!purpose) warnings.push(`media ${id} does not exist`);
    else if (purpose !== "landing" && purpose !== "logo") {
      warnings.push(`media ${id} has purpose "${purpose}" and is not publicly served – upload page images under Admin → Web pages`);
    }
  }
  return warnings;
}

/** Warns when a page relies on the event service although this community has none to load from. */
async function eventWarnings(communityId: string, definition: LandingDefinition): Promise<string[]> {
  if (!usesEventSections(definition)) return [];
  if (await getEventsWidgetUrl(communityId)) return [];
  return ["the page uses event sections (events, event, order-status), but no event service is connected for this community – these sections stay invisible until the operator connects one under Admin → Integrations"];
}

/** Posts sections need a collection of this community that is cleared for public pages. */
async function postsWarnings(communityId: string, definition: LandingDefinition): Promise<string[]> {
  const ids = collectPostsCollectionIds(definition);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: knowledgeAreas.id, name: knowledgeAreas.name, publicOnSite: knowledgeAreas.publicOnSite })
    .from(knowledgeAreas)
    .where(and(eq(knowledgeAreas.communityId, communityId), inArray(knowledgeAreas.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const warnings: string[] = [];
  for (const id of ids) {
    const area = byId.get(id);
    if (!area) warnings.push(`posts section: collection ${id} does not exist in this community – the section stays invisible`);
    else if (!area.publicOnSite) {
      warnings.push(`posts section: collection "${area.name}" is not shown on public pages – switch "Show on public pages" on under Admin → Collections (MCP: set_collection_public), otherwise the section stays invisible`);
    }
  }
  return warnings;
}

/** Internal hrefs of a definition (buttons, footer, team links). */
function internalHrefs(definition: LandingDefinition): string[] {
  const hrefs: string[] = definition.footer.links.map((l) => l.href);
  for (const s of definition.sections) {
    if (s.type === "hero") hrefs.push(...[s.primaryCta?.href, s.secondaryCta?.href].filter((h): h is string => Boolean(h)));
    if (s.type === "cta") hrefs.push(s.button.href);
    if (s.type === "team") for (const m of s.members) hrefs.push(...m.links.map((l) => l.href));
  }
  return hrefs.filter((h) => h.startsWith("/") && !h.startsWith("//"));
}

/**
 * Links to custom pages ("/blog", "/blog/some-post") whose page is missing or switched off – footer
 * links are free hrefs and would otherwise break silently when a page is renamed or disabled.
 */
async function linkWarnings(communityId: string, definition: LandingDefinition): Promise<string[]> {
  const slugs = new Set<string>();
  for (const href of internalHrefs(definition)) {
    const first = href.split(/[?#]/)[0].split("/")[1];
    if (first && !RESERVED_PAGE_SLUGS.has(first)) slugs.add(first);
  }
  if (slugs.size === 0) return [];
  const rows = await db
    .select({ slug: sitePages.slug, enabled: sitePages.enabled })
    .from(sitePages)
    .where(and(eq(sitePages.communityId, communityId), inArray(sitePages.slug, [...slugs])));
  const bySlug = new Map(rows.map((r) => [r.slug, r.enabled]));
  const warnings: string[] = [];
  for (const slug of slugs) {
    const enabled = bySlug.get(slug);
    if (enabled === undefined) warnings.push(`link to "/${slug}": there is no page with this address – the link leads to "not found"`);
    else if (!enabled) warnings.push(`link to "/${slug}": the page is switched off – the link leads to "not found" until it is published`);
  }
  return warnings;
}
