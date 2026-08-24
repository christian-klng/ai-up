"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertUser } from "@/server/auth/session";
import { addContentVersion, canEditContent, createContent, getAreaById, getContent } from "@/server/domain/knowledge";
import { getStructureByAreaId } from "@/server/domain/structures";
import { renderStructureMarkdown } from "@/lib/structures/markdown";
import { validateStructureAnswers, type AnswerIssue } from "@/lib/structures/validate";
import type { StructureEntryMeta } from "@/lib/structures/types";
import { logger } from "@/server/logger";

export type SaveStructuredEntryResult =
  | { ok: true; contentId: string; areaSlug: string }
  | { ok: false; issues: AnswerIssue[] };

const inputSchema = z.object({
  areaId: z.string().uuid(),
  contentId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  answers: z.unknown(),
  changeNote: z.string().trim().max(500).optional(),
});

/** Creates or edits a structured entry: validate answers against the definition snapshot, render Markdown, store both. */
export async function saveStructuredEntryAction(input: { areaId: string; contentId?: string; title: string; answers: unknown; changeNote?: string }): Promise<SaveStructuredEntryResult> {
  const user = await assertUser();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: [{ key: "", code: "invalid" }] };
  const d = parsed.data;
  const area = await getAreaById(d.areaId);
  if (!area) return { ok: false, issues: [{ key: "", code: "invalid" }] };

  // Create fills against the collection's current structure; edit fills against
  // the entry's own snapshot (structure changes never break existing entries).
  let snapshot: StructureEntryMeta | null = null;
  if (d.contentId) {
    const existing = await getContent(d.contentId);
    if (!existing || existing.areaId !== area.id || existing.type !== "structured") return { ok: false, issues: [{ key: "", code: "invalid" }] };
    if (!canEditContent(user, existing)) return { ok: false, issues: [{ key: "", code: "invalid" }] };
    const prev = existing.version?.meta.structure;
    if (!prev) return { ok: false, issues: [{ key: "", code: "invalid" }] };
    snapshot = prev;
  } else {
    const structure = await getStructureByAreaId(area.id);
    if (!structure) return { ok: false, issues: [{ key: "", code: "invalid" }] };
    snapshot = { structureId: structure.id, structureVersion: structure.version, definition: structure.definition, answers: {} };
  }

  const res = validateStructureAnswers(snapshot.definition, d.answers);
  if (!res.ok) return { ok: false, issues: res.issues };

  const meta: StructureEntryMeta = { ...snapshot, answers: res.answers };
  const bodyMarkdown = renderStructureMarkdown(meta.definition, meta.answers);

  try {
    if (d.contentId) {
      await addContentVersion(d.contentId, { title: d.title, bodyMarkdown, meta: { structure: meta }, changeNote: d.changeNote ?? null }, user.id);
      revalidatePath(`/knowledge/${area.slug}`, "layout");
      return { ok: true, contentId: d.contentId, areaSlug: area.slug };
    }
    const created = await createContent(area.id, "structured", { title: d.title, bodyMarkdown, meta: { structure: meta } }, user.id);
    revalidatePath(`/knowledge/${area.slug}`, "layout");
    revalidatePath("/", "layout");
    return { ok: true, contentId: created.id, areaSlug: area.slug };
  } catch (err) {
    logger.error({ err }, "structured entry save failed");
    return { ok: false, issues: [{ key: "", code: "invalid" }] };
  }
}
