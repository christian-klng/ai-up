"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertUser } from "@/server/auth/session";
import { addContentVersion, canEditContent, createContent, getAreaById, getContent } from "@/server/domain/knowledge";
import { buildStructuredVersionInput } from "@/server/domain/structured-entries";
import { getTemplateById, isTemplateAvailableForArea } from "@/server/domain/templates";
import { enqueueEvaluation } from "@/server/workflows/queue";
import type { AnswerIssue } from "@/lib/structures/validate";
import type { StructureEntryMeta } from "@/lib/structures/types";
import { logger } from "@/server/logger";
import { liveHash, markFlushed, readState, type BoardState } from "@/server/whiteboards/state";
import type { StructureAnswers } from "@/lib/structures/types";
import { isLiveBoardElement, storedBoardOf } from "@/lib/structures/live-boards";

export type SaveStructuredEntryResult =
  | { ok: true; contentId: string; areaSlug: string }
  | { ok: false; issues: AnswerIssue[] };

const inputSchema = z.object({
  areaId: z.string().uuid(),
  templateId: z.string().uuid().optional(),
  contentId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  answers: z.unknown(),
  changeNote: z.string().trim().max(500).optional(),
  upgrade: z.boolean().optional(),
  imageMediaId: z.string().uuid().nullable().optional(),
});

/**
 * Creates or edits a structured entry. Create fills against the chosen
 * template's current definition; edit fills against the entry's own snapshot.
 * With `upgrade: true` an edit re-snapshots to the template's current version
 * (the client migrated the answers; validation runs against the new definition).
 */
export async function saveStructuredEntryAction(input: {
  areaId: string;
  templateId?: string;
  contentId?: string;
  title: string;
  answers: unknown;
  changeNote?: string;
  upgrade?: boolean;
  imageMediaId?: string | null;
}): Promise<SaveStructuredEntryResult> {
  const user = await assertUser();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: [{ key: "", code: "invalid" }] };
  const d = parsed.data;
  const area = await getAreaById(user.communityId, d.areaId);
  if (!area) return { ok: false, issues: [{ key: "", code: "invalid" }] };

  let snapshot: Pick<StructureEntryMeta, "structureId" | "structureVersion" | "definition">;
  let prevEnrichment: StructureEntryMeta["enrichment"];
  let prevAnswers: StructureEntryMeta["answers"] | undefined;

  if (d.contentId) {
    const existing = await getContent(user.communityId, d.contentId);
    if (!existing || existing.areaId !== area.id || existing.type !== "structured") return { ok: false, issues: [{ key: "", code: "invalid" }] };
    if (!canEditContent(user, existing)) return { ok: false, issues: [{ key: "", code: "invalid" }] };
    const prev = existing.version?.meta.structure;
    if (!prev) return { ok: false, issues: [{ key: "", code: "invalid" }] };
    snapshot = prev;
    prevEnrichment = prev.enrichment;
    prevAnswers = prev.answers;
    if (d.upgrade) {
      const template = await getTemplateById(user.communityId, prev.structureId);
      if (template && template.version > prev.structureVersion) {
        snapshot = { structureId: template.id, structureVersion: template.version, definition: template.definition };
      }
    }
  } else {
    if (!d.templateId) return { ok: false, issues: [{ key: "", code: "invalid" }] };
    const template = await getTemplateById(user.communityId, d.templateId);
    if (!template || !(await isTemplateAvailableForArea(area.id, template.id))) return { ok: false, issues: [{ key: "", code: "invalid" }] };
    snapshot = { structureId: template.id, structureVersion: template.version, definition: template.definition };
  }

  // Boards of an existing entry are edited live, never through the form: take the running session's
  // state (or the stored board), so a form save cannot overwrite what others are drawing right now.
  let answers = d.answers;
  const liveKeys: string[] = [];
  /** key → session state and the hash of what this save takes from it */
  const liveStates = new Map<string, { state: BoardState; hash: string }>();
  if (d.contentId && typeof answers === "object" && answers !== null) {
    const merged: StructureAnswers = { ...(answers as StructureAnswers) };
    for (const el of snapshot.definition.elements) {
      if (!isLiveBoardElement(el)) continue;
      const live = await readState({ contentId: d.contentId, key: el.key });
      if (live) {
        merged[el.key] = storedBoardOf(el, live.items);
        liveKeys.push(el.key);
        liveStates.set(el.key, { state: live, hash: liveHash(el, live.items) });
      } else if (prevAnswers?.[el.key] !== undefined) merged[el.key] = prevAnswers[el.key];
      else delete merged[el.key];
    }
    answers = merged;
  }

  const built = await buildStructuredVersionInput(snapshot, d.title, answers, { changeNote: d.changeNote ?? null, prevEnrichment, imageMediaId: d.imageMediaId ?? null, prevAnswers, actorId: user.id, trustedWhiteboardKeys: liveKeys });
  if (!built.ok) return { ok: false, issues: built.issues };

  try {
    if (d.contentId) {
      await addContentVersion(user.communityId, d.contentId, built.input, user.id, { kind: "user" }, { liveBoards: "keep" });
      // The session's state is saved with this version – no second version for it when the session ends.
      for (const [key, live] of liveStates) await markFlushed({ contentId: d.contentId, key }, live.state.seq, live.hash);
      revalidatePath(`/knowledge/${area.slug}`, "layout");
      return { ok: true, contentId: d.contentId, areaSlug: area.slug };
    }
    const created = await createContent(user.communityId, area.id, "structured", built.input, user.id);
    revalidatePath(`/knowledge/${area.slug}`, "layout");
    revalidatePath("/", "layout");
    return { ok: true, contentId: created.id, areaSlug: area.slug };
  } catch (err) {
    logger.error({ err }, "structured entry save failed");
    return { ok: false, issues: [{ key: "", code: "invalid" }] };
  }
}

/** Queues a fresh criteria check for one entry (author or admin; e.g. after a template change). */
export async function reevaluateEntryAction(contentId: string): Promise<{ ok: boolean }> {
  const user = await assertUser();
  const content = await getContent(user.communityId, contentId);
  if (!content || !content.currentVersionId || !canEditContent(user, content)) return { ok: false };
  await enqueueEvaluation(content.id, content.currentVersionId);
  return { ok: true };
}
