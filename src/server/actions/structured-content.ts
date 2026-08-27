"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertUser } from "@/server/auth/session";
import { addContentVersion, canEditContent, createContent, getAreaById, getContent } from "@/server/domain/knowledge";
import { buildStructuredVersionInput } from "@/server/domain/structured-entries";
import { getTemplateById, isTemplateAvailableForArea } from "@/server/domain/templates";
import type { AnswerIssue } from "@/lib/structures/validate";
import type { StructureEntryMeta } from "@/lib/structures/types";
import { logger } from "@/server/logger";

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
}): Promise<SaveStructuredEntryResult> {
  const user = await assertUser();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: [{ key: "", code: "invalid" }] };
  const d = parsed.data;
  const area = await getAreaById(d.areaId);
  if (!area) return { ok: false, issues: [{ key: "", code: "invalid" }] };

  let snapshot: Pick<StructureEntryMeta, "structureId" | "structureVersion" | "definition">;
  let prevEnrichment: StructureEntryMeta["enrichment"];

  if (d.contentId) {
    const existing = await getContent(d.contentId);
    if (!existing || existing.areaId !== area.id || existing.type !== "structured") return { ok: false, issues: [{ key: "", code: "invalid" }] };
    if (!canEditContent(user, existing)) return { ok: false, issues: [{ key: "", code: "invalid" }] };
    const prev = existing.version?.meta.structure;
    if (!prev) return { ok: false, issues: [{ key: "", code: "invalid" }] };
    snapshot = prev;
    prevEnrichment = prev.enrichment;
    if (d.upgrade) {
      const template = await getTemplateById(prev.structureId);
      if (template && template.version > prev.structureVersion) {
        snapshot = { structureId: template.id, structureVersion: template.version, definition: template.definition };
      }
    }
  } else {
    if (!d.templateId) return { ok: false, issues: [{ key: "", code: "invalid" }] };
    const template = await getTemplateById(d.templateId);
    if (!template || !(await isTemplateAvailableForArea(area.id, template.id))) return { ok: false, issues: [{ key: "", code: "invalid" }] };
    snapshot = { structureId: template.id, structureVersion: template.version, definition: template.definition };
  }

  const built = await buildStructuredVersionInput(snapshot, d.title, d.answers, { changeNote: d.changeNote ?? null, prevEnrichment });
  if (!built.ok) return { ok: false, issues: built.issues };

  try {
    if (d.contentId) {
      await addContentVersion(d.contentId, built.input, user.id);
      revalidatePath(`/knowledge/${area.slug}`, "layout");
      return { ok: true, contentId: d.contentId, areaSlug: area.slug };
    }
    const created = await createContent(area.id, "structured", built.input, user.id);
    revalidatePath(`/knowledge/${area.slug}`, "layout");
    revalidatePath("/", "layout");
    return { ok: true, contentId: created.id, areaSlug: area.slug };
  } catch (err) {
    logger.error({ err }, "structured entry save failed");
    return { ok: false, issues: [{ key: "", code: "invalid" }] };
  }
}
