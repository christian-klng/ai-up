import { and, asc, desc, eq, ilike, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  auditLog,
  contentVersions,
  contents,
  knowledgeAreas,
  mediaFiles,
  users,
  type Content,
  type ContentType,
  type ContentVersion,
  type ContentVersionMeta,
  type KnowledgeArea,
  type MediaFile,
} from "@/server/db/schema";
import { emitDomainEvent, type ContentEventPayload, type EventOrigin } from "@/server/events/bus";
import type { CollectionLayout, CollectionSort } from "@/lib/collection-layouts";
import { flattenAnswersText } from "@/lib/structures/markdown";
import { slugify } from "@/lib/slug";

// ---------------------------------------------------------------------------
// Knowledge areas
// ---------------------------------------------------------------------------

export type AreaWithCount = KnowledgeArea & { contentCount: number };

export async function listAreas(): Promise<AreaWithCount[]> {
  const rows = await db
    .select({
      area: knowledgeAreas,
      // Note: column refs inside a correlated subquery render unqualified – qualify with the table explicitly.
      contentCount: sql<number>`(select count(*)::int from ${contents} c where c.area_id = ${knowledgeAreas}."id" and c.deleted_at is null)`,
    })
    .from(knowledgeAreas)
    .orderBy(asc(knowledgeAreas.sortOrder), asc(knowledgeAreas.name));
  return rows.map((r) => ({ ...r.area, contentCount: r.contentCount }));
}

export async function getAreaBySlug(slug: string): Promise<KnowledgeArea | undefined> {
  return db.query.knowledgeAreas.findFirst({ where: eq(knowledgeAreas.slug, slug) });
}

export async function getAreaById(id: string): Promise<KnowledgeArea | undefined> {
  return db.query.knowledgeAreas.findFirst({ where: eq(knowledgeAreas.id, id) });
}

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  let slug = slugify(base);
  for (let i = 2; i < 100; i++) {
    const clash = await db.query.knowledgeAreas.findFirst({
      where: excludeId ? and(eq(knowledgeAreas.slug, slug), ne(knowledgeAreas.id, excludeId)) : eq(knowledgeAreas.slug, slug),
      columns: { id: true },
    });
    if (!clash) return slug;
    slug = `${slugify(base)}-${i}`;
  }
  return `${slugify(base)}-${Date.now().toString(36)}`;
}

export type AreaInput = { name: string; purpose: string; description?: string | null; icon?: string; layout?: CollectionLayout; sortMode?: CollectionSort };

export async function createArea(input: AreaInput, actorId: string): Promise<KnowledgeArea> {
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${knowledgeAreas.sortOrder}), -1)::int` }).from(knowledgeAreas);
  const [row] = await db
    .insert(knowledgeAreas)
    .values({
      name: input.name.trim(),
      slug: await uniqueSlug(input.name),
      purpose: input.purpose.trim(),
      description: input.description?.trim() || null,
      icon: input.icon ?? "book",
      layout: input.layout ?? "grid",
      sortMode: input.sortMode ?? "updated",
      sortOrder: max + 1,
      createdBy: actorId,
    })
    .returning();
  await db.insert(auditLog).values({ actorId, action: "knowledge_area.created", targetType: "knowledge_area", targetId: row.id, details: { name: row.name } });
  return row;
}

export async function updateArea(id: string, input: AreaInput, actorId: string): Promise<KnowledgeArea | undefined> {
  const existing = await getAreaById(id);
  if (!existing) return undefined;
  const [row] = await db
    .update(knowledgeAreas)
    .set({
      name: input.name.trim(),
      slug: existing.name.trim() === input.name.trim() ? existing.slug : await uniqueSlug(input.name, id),
      purpose: input.purpose.trim(),
      description: input.description?.trim() || null,
      icon: input.icon ?? existing.icon,
      layout: input.layout ?? existing.layout,
      sortMode: input.sortMode ?? existing.sortMode,
    })
    .where(eq(knowledgeAreas.id, id))
    .returning();
  await db.insert(auditLog).values({ actorId, action: "knowledge_area.updated", targetType: "knowledge_area", targetId: id, details: { name: row.name } });
  return row;
}

/** Deletes an area. Returns false if it still contains contents. */
export async function deleteArea(id: string, actorId: string): Promise<boolean> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contents)
    .where(and(eq(contents.areaId, id), isNull(contents.deletedAt)));
  if (count > 0) return false;
  await db.delete(knowledgeAreas).where(eq(knowledgeAreas.id, id));
  await db.insert(auditLog).values({ actorId, action: "knowledge_area.deleted", targetType: "knowledge_area", targetId: id });
  return true;
}

export async function moveArea(id: string, direction: "up" | "down"): Promise<void> {
  const all = await db.query.knowledgeAreas.findMany({ orderBy: [asc(knowledgeAreas.sortOrder), asc(knowledgeAreas.name)] });
  const idx = all.findIndex((a) => a.id === id);
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= all.length) return;
  const reordered = [...all];
  [reordered[idx], reordered[swap]] = [reordered[swap], reordered[idx]];
  await db.transaction(async (tx) => {
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i].sortOrder !== i) await tx.update(knowledgeAreas).set({ sortOrder: i }).where(eq(knowledgeAreas.id, reordered[i].id));
    }
  });
}

// ---------------------------------------------------------------------------
// Contents & versions
// ---------------------------------------------------------------------------

export type ContentVersionInput = {
  title: string;
  bodyMarkdown?: string | null;
  mediaId?: string | null;
  url?: string | null;
  meta?: ContentVersionMeta;
  changeNote?: string | null;
};

export type ContentListItem = Content & {
  version: ContentVersion | null;
  media: MediaFile | null;
  author: { id: string; name: string; avatarMediaId: string | null } | null;
};

function buildSearchText(type: ContentType, v: ContentVersionInput): string {
  // Structured entries index the flattened answers instead of the generated markdown (no mermaid noise).
  const body = type === "structured" && v.meta?.structure ? flattenAnswersText(v.meta.structure.definition, v.meta.structure.answers, v.meta.structure.enrichment) : (v.bodyMarkdown ?? "");
  const parts = [v.title, body, v.url ?? "", v.meta?.preview?.title ?? "", v.meta?.preview?.description ?? "", v.meta?.alt ?? "", type];
  return parts.filter(Boolean).join("\n").slice(0, 20000);
}

async function contentEventPayload(content: Content, input: ContentVersionInput, versionNo: number, actorId: string | null, origin: EventOrigin): Promise<ContentEventPayload> {
  const [area, author] = await Promise.all([getAreaById(content.areaId), content.authorId ? db.query.users.findFirst({ where: eq(users.id, content.authorId), columns: { name: true } }) : null]);
  return {
    content: {
      id: content.id,
      type: content.type,
      title: content.title,
      url: input.url ?? null,
      body: input.bodyMarkdown ?? null,
      areaId: content.areaId,
      areaSlug: area?.slug ?? "",
      areaName: area?.name ?? "",
      areaPurpose: area?.purpose ?? "",
      authorId: content.authorId,
      authorName: author?.name ?? null,
      versionNo,
      href: `/knowledge/${area?.slug ?? content.areaId}/${content.id}`,
    },
    actorId,
    origin,
  };
}

export async function createContent(areaId: string, type: ContentType, input: ContentVersionInput, authorId: string | null, origin: EventOrigin = { kind: "user" }): Promise<Content> {
  const result = await db.transaction(async (tx) => {
    const [content] = await tx
      .insert(contents)
      .values({ areaId, type, title: input.title.trim(), authorId, lastEditedBy: authorId, searchText: buildSearchText(type, input), versionCount: 1 })
      .returning();
    const [version] = await tx
      .insert(contentVersions)
      .values({
        contentId: content.id,
        versionNo: 1,
        title: input.title.trim(),
        bodyMarkdown: input.bodyMarkdown ?? null,
        mediaId: input.mediaId ?? null,
        url: input.url ?? null,
        meta: input.meta ?? {},
        changeNote: input.changeNote ?? null,
        createdBy: authorId,
      })
      .returning();
    const [updated] = await tx.update(contents).set({ currentVersionId: version.id }).where(eq(contents.id, content.id)).returning();
    return updated;
  });
  emitDomainEvent("content.created", await contentEventPayload(result, input, 1, authorId, origin));
  return result;
}

/** Appends a new version (edits are never destructive). */
export async function addContentVersion(contentId: string, input: ContentVersionInput, editorId: string, origin: EventOrigin = { kind: "user" }): Promise<Content | undefined> {
  const existing = await db.query.contents.findFirst({ where: and(eq(contents.id, contentId), isNull(contents.deletedAt)) });
  if (!existing) return undefined;
  const nextNo = existing.versionCount + 1;
  const result = await db.transaction(async (tx) => {
    const [version] = await tx
      .insert(contentVersions)
      .values({
        contentId,
        versionNo: nextNo,
        title: input.title.trim(),
        bodyMarkdown: input.bodyMarkdown ?? null,
        mediaId: input.mediaId ?? null,
        url: input.url ?? null,
        meta: input.meta ?? {},
        changeNote: input.changeNote ?? null,
        createdBy: editorId,
      })
      .returning();
    const [updated] = await tx
      .update(contents)
      .set({ title: input.title.trim(), currentVersionId: version.id, versionCount: nextNo, lastEditedBy: editorId, searchText: buildSearchText(existing.type, input) })
      .where(eq(contents.id, contentId))
      .returning();
    return updated;
  });
  emitDomainEvent("content.updated", await contentEventPayload(result, input, nextNo, editorId, origin));
  return result;
}

/** Restores an older version by copying it into a new version (history stays intact). */
export async function restoreContentVersion(contentId: string, versionId: string, editorId: string, note: string): Promise<Content | undefined> {
  const v = await db.query.contentVersions.findFirst({ where: and(eq(contentVersions.id, versionId), eq(contentVersions.contentId, contentId)) });
  if (!v) return undefined;
  return addContentVersion(contentId, { title: v.title, bodyMarkdown: v.bodyMarkdown, mediaId: v.mediaId, url: v.url, meta: v.meta, changeNote: note }, editorId);
}

export async function softDeleteContent(contentId: string, actorId: string): Promise<Content | undefined> {
  const [row] = await db.update(contents).set({ deletedAt: new Date() }).where(and(eq(contents.id, contentId), isNull(contents.deletedAt))).returning();
  if (row) {
    await db.insert(auditLog).values({ actorId, action: "content.deleted", targetType: "content", targetId: contentId });
    emitDomainEvent("content.deleted", { contentId, areaId: row.areaId, actorId });
  }
  return row;
}

export async function setContentPinned(contentId: string, pinned: boolean): Promise<void> {
  await db.update(contents).set({ pinned }).where(eq(contents.id, contentId));
}

export async function getContent(contentId: string): Promise<ContentListItem | undefined> {
  const rows = await db
    .select({ content: contents, version: contentVersions, media: mediaFiles, author: { id: users.id, name: users.name, avatarMediaId: users.avatarMediaId } })
    .from(contents)
    .leftJoin(contentVersions, eq(contentVersions.id, contents.currentVersionId))
    .leftJoin(mediaFiles, eq(mediaFiles.id, contentVersions.mediaId))
    .leftJoin(users, eq(users.id, contents.authorId))
    .where(and(eq(contents.id, contentId), isNull(contents.deletedAt)))
    .limit(1);
  const r = rows[0];
  if (!r) return undefined;
  return { ...r.content, version: r.version, media: r.media, author: r.author?.id ? r.author : null };
}

export type ListContentsOptions = { areaId?: string; type?: ContentType; query?: string; limit?: number; offset?: number; sort?: CollectionSort };

/** Pinned entries always first; the tail order follows the collection's sort mode. */
function contentOrderBy(sort: CollectionSort) {
  switch (sort) {
    case "newest":
      return [desc(contents.pinned), desc(contents.createdAt)];
    case "oldest":
      return [desc(contents.pinned), asc(contents.createdAt)];
    case "title":
      return [desc(contents.pinned), asc(sql`lower(${contents.title})`)];
    default:
      return [desc(contents.pinned), desc(contents.updatedAt)];
  }
}

export async function listContents(opts: ListContentsOptions = {}): Promise<ContentListItem[]> {
  const conds = [isNull(contents.deletedAt)];
  if (opts.areaId) conds.push(eq(contents.areaId, opts.areaId));
  if (opts.type) conds.push(eq(contents.type, opts.type));
  if (opts.query?.trim()) conds.push(ilike(contents.searchText, `%${opts.query.trim()}%`));
  const rows = await db
    .select({ content: contents, version: contentVersions, media: mediaFiles, author: { id: users.id, name: users.name, avatarMediaId: users.avatarMediaId } })
    .from(contents)
    .leftJoin(contentVersions, eq(contentVersions.id, contents.currentVersionId))
    .leftJoin(mediaFiles, eq(mediaFiles.id, contentVersions.mediaId))
    .leftJoin(users, eq(users.id, contents.authorId))
    .where(and(...conds))
    .orderBy(...contentOrderBy(opts.sort ?? "updated"))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
  return rows.map((r) => ({ ...r.content, version: r.version, media: r.media, author: r.author?.id ? r.author : null }));
}

/** Non-deleted content count per type for one area (types without entries are absent). */
export async function countContentsByType(areaId: string): Promise<Partial<Record<ContentType, number>>> {
  const rows = await db
    .select({ type: contents.type, count: sql<number>`count(*)::int` })
    .from(contents)
    .where(and(eq(contents.areaId, areaId), isNull(contents.deletedAt)))
    .groupBy(contents.type);
  return Object.fromEntries(rows.map((r) => [r.type, r.count]));
}

export type VersionWithMeta = ContentVersion & { media: MediaFile | null; createdByUser: { id: string; name: string; avatarMediaId: string | null } | null };

export async function listContentVersions(contentId: string): Promise<VersionWithMeta[]> {
  const rows = await db
    .select({ version: contentVersions, media: mediaFiles, user: { id: users.id, name: users.name, avatarMediaId: users.avatarMediaId } })
    .from(contentVersions)
    .leftJoin(mediaFiles, eq(mediaFiles.id, contentVersions.mediaId))
    .leftJoin(users, eq(users.id, contentVersions.createdBy))
    .where(eq(contentVersions.contentId, contentId))
    .orderBy(desc(contentVersions.versionNo));
  return rows.map((r) => ({ ...r.version, media: r.media, createdByUser: r.user?.id ? r.user : null }));
}

export async function getContentVersion(contentId: string, versionId: string): Promise<VersionWithMeta | undefined> {
  const all = await listContentVersions(contentId);
  return all.find((v) => v.id === versionId);
}

export function canEditContent(user: { id: string; role: string }, content: { authorId: string | null }): boolean {
  return user.role === "admin" || content.authorId === user.id;
}
