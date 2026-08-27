import type { ContentVersionInput } from "@/server/domain/knowledge";
import { getMedia } from "@/server/media/storage";
import { fetchLinkPreview } from "@/server/webreader/link-preview";
import { assertPublicUrl } from "@/server/webreader/safe-fetch";
import { logger } from "@/server/logger";
import { detectVideoSource } from "@/lib/video";
import { renderStructureMarkdown } from "@/lib/structures/markdown";
import { fillProcessSeeds, isMediaLikeAnswer } from "@/lib/structures/types";
import type { ImageAnswer, LinkAnswer, StructureAnswers, StructureElementEnrichment, StructureEnrichment, StructureEntryMeta, VideoAnswer } from "@/lib/structures/types";
import { validateStructureAnswers, type AnswerIssue } from "@/lib/structures/validate";

// ---------------------------------------------------------------------------
// Shared write path for structured entries (server action, MCP and worker):
// validate answers against the definition snapshot, enrich media/link answers
// server-side (previews, embed ids, upload probes), render Markdown.
// ---------------------------------------------------------------------------

export type BuildStructuredVersionResult = { ok: true; input: ContentVersionInput } | { ok: false; issues: AnswerIssue[] };

/**
 * Validates + enriches answers for one entry version. `snapshot` carries the
 * template id/version/definition the answers are filled against; `prevEnrichment`
 * (from the previous version) lets unchanged link previews be reused.
 */
export async function buildStructuredVersionInput(
  snapshot: Pick<StructureEntryMeta, "structureId" | "structureVersion" | "definition">,
  title: string,
  rawAnswers: unknown,
  opts: { changeNote?: string | null; prevEnrichment?: StructureEnrichment } = {},
): Promise<BuildStructuredVersionResult> {
  const seeded = typeof rawAnswers === "object" && rawAnswers !== null ? fillProcessSeeds(snapshot.definition, rawAnswers as StructureAnswers) : rawAnswers;
  const res = validateStructureAnswers(snapshot.definition, seeded);
  if (!res.ok) return { ok: false, issues: res.issues };

  const enrichResult = await enrichStructureAnswers(snapshot.definition, res.answers, opts.prevEnrichment);
  if (!enrichResult.ok) return { ok: false, issues: enrichResult.issues };

  const meta: StructureEntryMeta = {
    structureId: snapshot.structureId,
    structureVersion: snapshot.structureVersion,
    definition: snapshot.definition,
    answers: res.answers,
    ...(Object.keys(enrichResult.enrichment).length > 0 ? { enrichment: enrichResult.enrichment } : {}),
  };
  return {
    ok: true,
    input: {
      title,
      bodyMarkdown: renderStructureMarkdown(meta.definition, meta.answers, meta.enrichment),
      meta: { structure: meta },
      changeNote: opts.changeNote ?? null,
    },
  };
}

type EnrichResult = { ok: true; enrichment: StructureEnrichment } | { ok: false; issues: AnswerIssue[] };

async function enrichStructureAnswers(
  def: StructureEntryMeta["definition"],
  answers: StructureAnswers,
  prevEnrichment?: StructureEnrichment,
): Promise<EnrichResult> {
  const enrichment: StructureEnrichment = {};
  const issues: AnswerIssue[] = [];

  for (const el of def.elements) {
    const value = answers[el.key];
    if (value === undefined || !isMediaLikeAnswer(value)) continue;

    if (el.type === "image") {
      const v = value as ImageAnswer;
      if (v.mediaId) {
        const media = await getMedia(v.mediaId);
        if (!media || media.kind !== "image") {
          issues.push({ key: el.key, code: "mediaInvalid" });
          continue;
        }
        const e: StructureElementEnrichment = {};
        if (media.width) e.width = media.width;
        if (media.height) e.height = media.height;
        if (Object.keys(e).length > 0) enrichment[el.key] = e;
      } else if (v.url) {
        try {
          await assertPublicUrl(v.url);
        } catch {
          issues.push({ key: el.key, code: "urlInvalid" });
        }
      }
    } else if (el.type === "video") {
      const v = value as VideoAnswer;
      if (v.mediaId) {
        const media = await getMedia(v.mediaId);
        if (!media || media.kind !== "video") {
          issues.push({ key: el.key, code: "mediaInvalid" });
          continue;
        }
        enrichment[el.key] = { provider: "file" };
      } else if (v.url) {
        const src = detectVideoSource(v.url);
        if (!src) {
          issues.push({ key: el.key, code: "urlInvalid" });
          continue;
        }
        if (src.provider === "url") {
          try {
            await assertPublicUrl(v.url);
          } catch {
            issues.push({ key: el.key, code: "urlInvalid" });
            continue;
          }
          enrichment[el.key] = { url: v.url, provider: "url" };
        } else {
          enrichment[el.key] = { url: v.url, provider: src.provider, embedId: src.embedId };
        }
      }
    } else if (el.type === "link") {
      const v = value as LinkAnswer;
      if (!v.url) continue;
      const prev = prevEnrichment?.[el.key];
      if (prev?.url === v.url && prev.preview) {
        enrichment[el.key] = prev;
        continue;
      }
      try {
        await assertPublicUrl(v.url);
      } catch {
        issues.push({ key: el.key, code: "urlInvalid" });
        continue;
      }
      try {
        const preview = await fetchLinkPreview(v.url);
        enrichment[el.key] = { url: v.url, ...(preview && Object.keys(preview).length > 0 ? { preview } : {}) };
      } catch (err) {
        // preview is best-effort — a failed fetch must not block saving (same tolerance as the old link editor)
        logger.warn({ err, url: v.url }, "link preview fetch failed");
        enrichment[el.key] = { url: v.url };
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, enrichment };
}
