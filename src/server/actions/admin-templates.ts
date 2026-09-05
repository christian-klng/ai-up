"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/server/auth/session";
import { getAreaById } from "@/server/domain/knowledge";
import { deleteTemplate, getTemplateById, saveTemplate, setAreaTemplates, setTemplateEvaluation } from "@/server/domain/templates";
import { deleteEvaluationsForTemplate, listContentIdsForTemplate } from "@/server/domain/evaluation";
import { enqueueEvaluation } from "@/server/workflows/queue";
import { validateEvaluation } from "@/lib/structures/evaluation";
import { validateStructure, type ValidationIssue } from "@/lib/structures/validate";

export type SaveTemplateResult = { ok: true; templateId: string; version: number; warnings: ValidationIssue[] } | { ok: false; issues: ValidationIssue[] };

const saveSchema = z.object({
  templateId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  icon: z.string().trim().max(50).optional(),
  definition: z.unknown(),
  evaluation: z.unknown().optional(),
  changeNote: z.string().trim().max(500).optional(),
});

export async function saveTemplateAction(input: {
  templateId?: string;
  name: string;
  description?: string;
  icon?: string;
  definition: unknown;
  evaluation?: unknown;
  changeNote?: string;
}): Promise<SaveTemplateResult> {
  const admin = await assertAdmin();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: [{ path: "", message: "invalid input" }] };
  const d = parsed.data;
  const result = validateStructure(d.definition);
  if (!result.def) return { ok: false, issues: result.issues };
  const evaluation = validateEvaluation(d.evaluation);
  if (!evaluation.evaluation) return { ok: false, issues: evaluation.issues };
  const saved = await saveTemplate(
    { id: d.templateId, name: d.name, description: d.description || null, icon: d.icon, definition: result.def, evaluation: evaluation.evaluation },
    admin.id,
    d.changeNote,
  );
  if ("error" in saved) return { ok: false, issues: [{ path: "", message: saved.error === "system" ? "system templates are managed by the application" : "template not found" }] };
  // Verdicts of criteria that no longer exist would linger in the entry popover.
  await deleteEvaluationsForTemplate(saved.id, evaluation.evaluation.criteria.map((c) => c.key));
  revalidatePath("/admin/templates");
  revalidatePath("/admin/knowledge");
  revalidatePath("/knowledge", "layout");
  return { ok: true, templateId: saved.id, version: saved.version, warnings: result.warnings };
}

/** Re-runs the criteria for every entry of this template (admin decision – can be many LLM calls). */
export async function reevaluateTemplateEntriesAction(templateId: string): Promise<{ ok: boolean; queued: number }> {
  await assertAdmin();
  const template = await getTemplateById(templateId);
  if (!template) return { ok: false, queued: 0 };
  if (template.evaluation.criteria.length === 0) return { ok: true, queued: 0 };
  const entries = await listContentIdsForTemplate(templateId);
  for (const e of entries) await enqueueEvaluation(e.contentId, e.versionId);
  return { ok: true, queued: entries.length };
}

export async function deleteTemplateAction(templateId: string): Promise<{ ok: boolean; reason?: "system" | "notFound" }> {
  const admin = await assertAdmin();
  const result = await deleteTemplate(templateId, admin.id);
  if (result.ok) {
    revalidatePath("/admin/templates");
    revalidatePath("/admin/knowledge");
    revalidatePath("/knowledge", "layout");
  }
  return result;
}

export async function setAreaTemplatesAction(areaId: string, templateIds: string[]): Promise<{ ok: boolean }> {
  const admin = await assertAdmin();
  const area = await getAreaById(areaId);
  if (!area) return { ok: false };
  const unique = [...new Set(templateIds)];
  for (const id of unique) {
    if (!(await getTemplateById(id))) return { ok: false };
  }
  await setAreaTemplates(area.id, unique, admin.id);
  revalidatePath("/admin/knowledge");
  revalidatePath(`/knowledge/${area.slug}`, "layout");
  return { ok: true };
}

/**
 * Saves only the criteria/model. Unlike the structure this also works for system templates –
 * their definition is seed-managed, their criteria are not.
 */
export async function saveTemplateEvaluationAction(templateId: string, evaluation: unknown): Promise<{ ok: boolean; issues?: ValidationIssue[] }> {
  const admin = await assertAdmin();
  const parsedId = z.string().uuid().safeParse(templateId);
  if (!parsedId.success) return { ok: false, issues: [{ path: "", message: "invalid input" }] };
  const parsed = validateEvaluation(evaluation);
  if (!parsed.evaluation) return { ok: false, issues: parsed.issues };
  const saved = await setTemplateEvaluation(parsedId.data, parsed.evaluation, admin.id);
  if (!saved) return { ok: false, issues: [{ path: "", message: "template not found" }] };
  await deleteEvaluationsForTemplate(saved.id, parsed.evaluation.criteria.map((c) => c.key));
  revalidatePath("/admin/templates");
  revalidatePath("/knowledge", "layout");
  return { ok: true };
}
