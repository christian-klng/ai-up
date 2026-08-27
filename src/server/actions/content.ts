"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertUser } from "@/server/auth/session";
import {
  addContentVersion,
  canEditContent,
  getAreaById,
  getContent,
  restoreContentVersion,
  setContentPinned,
  softDeleteContent,
  type ContentVersionInput,
} from "@/server/domain/knowledge";
import { getMedia } from "@/server/media/storage";
import { fetchLinkPreview } from "@/server/webreader/link-preview";
import { assertPublicUrl } from "@/server/webreader/safe-fetch";
import type { ContentVersionMeta } from "@/server/db/schema";
import { detectVideoSource } from "@/lib/video";
import { logger } from "@/server/logger";

export type ContentFormState =
  | { status: "idle" }
  | { status: "saved"; contentId: string; areaSlug: string }
  | { status: "error"; code: "titleRequired" | "bodyRequired" | "mediaRequired" | "urlInvalid" | "forbidden" | "unexpected" };

const httpUrl = z.string().trim().url().refine((u) => /^https?:\/\//i.test(u));

const schema = z.object({
  contentId: z.string().uuid(),
  areaId: z.string().uuid(),
  type: z.enum(["markdown", "image", "video", "link"]),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(200_000).optional(),
  mediaId: z.string().uuid().optional(),
  url: z.string().trim().max(2000).optional(),
  alt: z.string().trim().max(500).optional(),
  changeNote: z.string().trim().max(500).optional(),
});

/**
 * Adds a new version to a legacy free-type entry (markdown/image/video/link).
 * Creation goes exclusively through templates (saveStructuredEntryAction) —
 * this action only keeps pre-template entries editable.
 */
export async function saveContentAction(_prev: ContentFormState, formData: FormData): Promise<ContentFormState> {
  const user = await assertUser();
  const parsed = schema.safeParse({
    contentId: formData.get("contentId") || undefined,
    areaId: formData.get("areaId"),
    type: formData.get("type"),
    title: formData.get("title"),
    // Browsers submit textarea content with CRLF – normalize to LF for clean diffs.
    body: typeof formData.get("body") === "string" ? String(formData.get("body")).replace(/\r\n?/g, "\n") || undefined : undefined,
    mediaId: formData.get("mediaId") || undefined,
    url: formData.get("url") || undefined,
    alt: formData.get("alt") || undefined,
    changeNote: formData.get("changeNote") || undefined,
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { status: "error", code: field === "title" ? "titleRequired" : "unexpected" };
  }
  const d = parsed.data;
  const area = await getAreaById(d.areaId);
  if (!area) return { status: "error", code: "unexpected" };

  // Build version input by type
  const input: ContentVersionInput = { title: d.title, changeNote: d.changeNote ?? null, meta: {} };
  const meta: ContentVersionMeta = {};
  try {
    switch (d.type) {
      case "markdown": {
        if (!d.body?.trim()) return { status: "error", code: "bodyRequired" };
        input.bodyMarkdown = d.body;
        break;
      }
      case "image": {
        if (d.mediaId) {
          const media = await getMedia(d.mediaId);
          if (!media || media.kind !== "image") return { status: "error", code: "mediaRequired" };
          input.mediaId = media.id;
          meta.width = media.width ?? undefined;
          meta.height = media.height ?? undefined;
        } else if (d.url) {
          const ok = httpUrl.safeParse(d.url);
          if (!ok.success) return { status: "error", code: "urlInvalid" };
          await assertPublicUrl(ok.data);
          input.url = ok.data;
        } else return { status: "error", code: "mediaRequired" };
        meta.alt = d.alt;
        input.bodyMarkdown = d.body?.trim() || null;
        break;
      }
      case "video": {
        if (d.mediaId) {
          const media = await getMedia(d.mediaId);
          if (!media || media.kind !== "video") return { status: "error", code: "mediaRequired" };
          input.mediaId = media.id;
          meta.provider = "file";
        } else if (d.url) {
          const ok = httpUrl.safeParse(d.url);
          if (!ok.success) return { status: "error", code: "urlInvalid" };
          const src = detectVideoSource(ok.data);
          if (!src) return { status: "error", code: "urlInvalid" };
          input.url = ok.data;
          if (src.provider === "url") {
            await assertPublicUrl(ok.data);
            meta.provider = "url";
          } else {
            meta.provider = src.provider;
            meta.embedId = src.embedId;
          }
        } else return { status: "error", code: "mediaRequired" };
        input.bodyMarkdown = d.body?.trim() || null;
        break;
      }
      case "link": {
        const ok = httpUrl.safeParse(d.url ?? "");
        if (!ok.success) return { status: "error", code: "urlInvalid" };
        input.url = ok.data;
        input.bodyMarkdown = d.body?.trim() || null;
        meta.preview = await fetchLinkPreview(ok.data);
        break;
      }
    }
  } catch (err) {
    logger.warn({ err }, "content input validation failed");
    return { status: "error", code: "urlInvalid" };
  }
  input.meta = meta;

  try {
    const existing = await getContent(d.contentId);
    if (!existing || existing.type !== d.type) return { status: "error", code: "unexpected" };
    if (!canEditContent(user, existing)) return { status: "error", code: "forbidden" };
    await addContentVersion(d.contentId, input, user.id);
    revalidatePath(`/knowledge/${area.slug}`, "layout");
    return { status: "saved", contentId: d.contentId, areaSlug: area.slug };
  } catch (err) {
    logger.error({ err }, "content save failed");
    return { status: "error", code: "unexpected" };
  }
}

export async function deleteContentAction(contentId: string): Promise<{ ok: boolean; areaSlug?: string }> {
  const user = await assertUser();
  const existing = await getContent(contentId);
  if (!existing || !canEditContent(user, existing)) return { ok: false };
  const area = await getAreaById(existing.areaId);
  await softDeleteContent(contentId, user.id);
  revalidatePath("/", "layout");
  return { ok: true, areaSlug: area?.slug };
}

export async function restoreVersionAction(contentId: string, versionId: string, note: string): Promise<{ ok: boolean }> {
  const user = await assertUser();
  const existing = await getContent(contentId);
  if (!existing || !canEditContent(user, existing)) return { ok: false };
  const res = await restoreContentVersion(contentId, versionId, user.id, note);
  revalidatePath("/", "layout");
  return { ok: !!res };
}

export async function togglePinAction(contentId: string, pinned: boolean): Promise<void> {
  const user = await assertUser();
  if (user.role !== "admin") return;
  await setContentPinned(contentId, pinned);
  revalidatePath("/", "layout");
}
