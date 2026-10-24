import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, contentMedia, contentVersions, contents, knowledgeAreas, landingPageVersions, mediaFiles, sitePages, type ContentVersion, type KnowledgeArea } from "@/server/db/schema";
import { collectPostsCollectionIds, type LandingDefinition } from "@/lib/landing-schema";
import { RESERVED_POST_SLUGS } from "@/lib/site-pages";
import { firstImageMediaId, postExcerpt } from "@/lib/posts";
import { renderStructureMarkdown } from "@/lib/structures/markdown";
import { isMediaLikeAnswer, type ImageAnswer } from "@/lib/structures/types";
import { visibleElements } from "@/lib/structures/visibility";
import { slugify } from "@/lib/slug";
import { env } from "@/server/env";
import { getAreaById, getContent, refreshContentMedia } from "./knowledge";

type Locale = "de" | "en";

/**
 * Entries as posts on public pages (blog, changelog – docs/eigene-seiten.md 7). Two keys must turn:
 * the collection is public_on_site, and an admin published the entry. Everything public shows the
 * entry's current version.
 */

export async function setCollectionPublic(communityId: string, areaId: string, value: boolean, actorId: string): Promise<KnowledgeArea | undefined> {
  const [row] = await db
    .update(knowledgeAreas)
    .set({ publicOnSite: value })
    .where(and(eq(knowledgeAreas.id, areaId), eq(knowledgeAreas.communityId, communityId)))
    .returning();
  if (row) await db.insert(auditLog).values({ communityId, actorId, action: "knowledge_area.public_toggled", targetType: "knowledge_area", targetId: areaId, details: { publicOnSite: value } });
  return row;
}

/** Post slug from the title, unique within the collection ("title", "title-2", …). */
async function uniquePostSlug(areaId: string, title: string): Promise<string> {
  const base = slugify(title) || "post";
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? base : `${base.slice(0, 55)}-${i}`;
    if (RESERVED_POST_SLUGS.has(candidate)) continue;
    const taken = await db.query.contents.findFirst({ where: and(eq(contents.areaId, areaId), eq(contents.slug, candidate)), columns: { id: true } });
    if (!taken) return candidate;
  }
}

export type PublishError = "not_found" | "collection_not_public";

/**
 * Publishes or withdraws an entry. Publishing needs a public collection; withdrawing always works.
 * The slug is made once and kept, so a published address survives later title changes.
 */
export async function setContentPublished(
  communityId: string,
  contentId: string,
  published: boolean,
  actorId: string,
): Promise<{ ok: true; publishedAt: Date | null; slug: string | null; areaSlug: string } | { ok: false; error: PublishError }> {
  const content = await getContent(communityId, contentId);
  if (!content) return { ok: false, error: "not_found" };
  const area = await getAreaById(communityId, content.areaId);
  if (!area) return { ok: false, error: "not_found" };
  if (published && !area.publicOnSite) return { ok: false, error: "collection_not_public" };
  const slug = published ? (content.slug ?? (await uniquePostSlug(area.id, content.title))) : content.slug;
  const publishedAt = published ? (content.publishedAt ?? new Date()) : null;
  await db.transaction(async (tx) => {
    await tx.update(contents).set({ publishedAt, slug }).where(eq(contents.id, contentId));
    // Entries written before content_media existed have no rows yet.
    if (published && content.version) await refreshContentMedia(tx, contentId, content.version);
  });
  await db.insert(auditLog).values({ communityId, actorId, action: published ? "content.published" : "content.unpublished", targetType: "content", targetId: contentId, details: { slug } });
  return { ok: true, publishedAt, slug, areaSlug: area.slug };
}

/**
 * Whether an upload may be served without a session because a published post shows it: the current
 * version of a published, non-deleted entry in a public collection points at it, and it is a
 * content upload of that same community – never a message attachment or someone else's file.
 */
export async function isPublishedEntryMedia(mediaId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: contentMedia.mediaId })
    .from(contentMedia)
    .innerJoin(contents, eq(contents.id, contentMedia.contentId))
    .innerJoin(knowledgeAreas, eq(knowledgeAreas.id, contents.areaId))
    .innerJoin(mediaFiles, eq(mediaFiles.id, contentMedia.mediaId))
    .where(
      and(
        eq(contentMedia.mediaId, mediaId),
        isNotNull(contents.publishedAt),
        isNull(contents.deletedAt),
        eq(knowledgeAreas.publicOnSite, true),
        eq(mediaFiles.purpose, "content"),
        eq(mediaFiles.communityId, knowledgeAreas.communityId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export type Post = {
  id: string;
  title: string;
  slug: string;
  publishedAt: string;
  updatedAt: string;
  /** publishedAt as the page shows it (community language, app time zone) */
  dateLabel: string;
  excerpt: string;
  /** Cover image (upload or external URL), null when the entry has none */
  coverSrc: string | null;
  /** Article markdown: the entry rendered as prose, without its cover */
  markdown: string;
};

function toPost(content: { id: string; title: string; slug: string | null; publishedAt: Date | null; updatedAt: Date }, version: ContentVersion | null, locale: Locale): Post {
  const s = version?.meta?.structure;
  let markdown = version?.bodyMarkdown ?? "";
  let coverSrc: string | null = null;
  if (s) {
    const cover = visibleElements(s.definition, s.answers).find((el) => {
      const a = s.answers[el.key];
      return el.type === "image" && isMediaLikeAnswer(a) && Boolean(a.mediaId || a.url);
    });
    if (cover) {
      const a = s.answers[cover.key] as ImageAnswer;
      coverSrc = a.mediaId ? `/api/files/${a.mediaId}` : (a.url ?? null);
    }
    markdown = renderStructureMarkdown(s.definition, s.answers, s.enrichment, { post: true, skipKeys: cover ? new Set([cover.key]) : undefined });
  } else {
    const first = version?.mediaId ?? firstImageMediaId(markdown);
    coverSrc = first ? `/api/files/${first}` : null;
  }
  const published = content.publishedAt ?? content.updatedAt;
  return {
    id: content.id,
    title: content.title,
    slug: content.slug ?? content.id,
    publishedAt: published.toISOString(),
    dateLabel: new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: env.APP_TIMEZONE }).format(published),
    updatedAt: content.updatedAt.toISOString(),
    excerpt: postExcerpt(markdown),
    coverSrc,
    markdown,
  };
}

function publishedWhere(communityId: string, areaId: string) {
  return and(
    eq(contents.areaId, areaId),
    eq(knowledgeAreas.communityId, communityId),
    eq(knowledgeAreas.publicOnSite, true),
    isNotNull(contents.publishedAt),
    isNotNull(contents.slug),
    isNull(contents.deletedAt),
  );
}

/** Published posts of a public collection, newest first; empty for a collection that is not public. */
export async function listPublishedPosts(communityId: string, areaId: string, opts: { limit: number; offset?: number; locale: Locale }): Promise<{ items: Post[]; total: number }> {
  const where = publishedWhere(communityId, areaId);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({ content: contents, version: contentVersions })
      .from(contents)
      .innerJoin(knowledgeAreas, eq(knowledgeAreas.id, contents.areaId))
      .leftJoin(contentVersions, eq(contentVersions.id, contents.currentVersionId))
      .where(where)
      .orderBy(desc(contents.publishedAt))
      .limit(opts.limit)
      .offset(opts.offset ?? 0),
    db.select({ total: count() }).from(contents).innerJoin(knowledgeAreas, eq(knowledgeAreas.id, contents.areaId)).where(where),
  ]);
  return { items: rows.map((r) => toPost(r.content, r.version, opts.locale)), total };
}

export async function getPublishedPost(communityId: string, areaId: string, slug: string, locale: Locale): Promise<Post | undefined> {
  const [row] = await db
    .select({ content: contents, version: contentVersions })
    .from(contents)
    .innerJoin(knowledgeAreas, eq(knowledgeAreas.id, contents.areaId))
    .leftJoin(contentVersions, eq(contentVersions.id, contents.currentVersionId))
    .where(and(publishedWhere(communityId, areaId), eq(contents.slug, slug)))
    .limit(1);
  return row ? toPost(row.content, row.version, locale) : undefined;
}

/**
 * The custom page whose posts section shows a collection – where post links point to. Prefers the
 * page being rendered; otherwise the first published page (in admin order) with such a section.
 */
export async function findPostsPageSlug(communityId: string, collectionId: string, preferSlug?: string | null): Promise<string | null> {
  const rows = await db
    .select({ slug: sitePages.slug, definition: landingPageVersions.definition })
    .from(sitePages)
    .innerJoin(
      landingPageVersions,
      and(
        eq(landingPageVersions.sitePageId, sitePages.id),
        eq(landingPageVersions.version, sql`(select max(v.version) from ${landingPageVersions} v where v.site_page_id = ${sitePages}."id")`),
      ),
    )
    .where(and(eq(sitePages.communityId, communityId), eq(sitePages.enabled, true)))
    .orderBy(sitePages.sortOrder);
  const matching = rows.filter((r) => collectPostsCollectionIds(r.definition).includes(collectionId)).map((r) => r.slug);
  if (preferSlug && matching.includes(preferSlug)) return preferSlug;
  return matching[0] ?? null;
}

/** Everything a posts section needs to render; resolved on the server, the shell stays client-safe. */
export type PostFeed = {
  items: Post[];
  /** Current page of the list (1-based) and whether older posts exist */
  page: number;
  hasMore: boolean;
  /** Custom page the posts live on ("/<basePath>/<slug>"); null = no page shows them, no links */
  basePath: string | null;
};

/** Feeds for every posts section of a definition whose collection is public, keyed by collection id. */
export async function resolvePostFeeds(
  communityId: string,
  definition: LandingDefinition,
  opts: { locale: Locale; pageSlug?: string | null; listPage?: number },
): Promise<Record<string, PostFeed>> {
  const feeds: Record<string, PostFeed> = {};
  for (const section of definition.sections) {
    if (section.type !== "posts" || feeds[section.collectionId]) continue;
    // Unknown or not public: no feed – the public page leaves the section out, the editor explains why.
    const area = await getAreaById(communityId, section.collectionId);
    if (!area?.publicOnSite) continue;
    const page = Math.max(1, opts.listPage ?? 1);
    const [{ items, total }, basePath] = await Promise.all([
      listPublishedPosts(communityId, section.collectionId, { limit: section.limit, offset: (page - 1) * section.limit, locale: opts.locale }),
      findPostsPageSlug(communityId, section.collectionId, opts.pageSlug),
    ]);
    feeds[section.collectionId] = { items, page, hasMore: page * section.limit < total, basePath };
  }
  return feeds;
}
