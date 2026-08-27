"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/server/auth/session";
import { getAreaById } from "@/server/domain/knowledge";
import { deleteTemplate, getTemplateById, saveTemplate, setAreaTemplates } from "@/server/domain/templates";
import { validateStructure, type ValidationIssue } from "@/lib/structures/validate";

export type SaveTemplateResult = { ok: true; templateId: string; version: number; warnings: ValidationIssue[] } | { ok: false; issues: ValidationIssue[] };

const saveSchema = z.object({
  templateId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  icon: z.string().trim().max(50).optional(),
  definition: z.unknown(),
  changeNote: z.string().trim().max(500).optional(),
});

export async function saveTemplateAction(input: { templateId?: string; name: string; description?: string; icon?: string; definition: unknown; changeNote?: string }): Promise<SaveTemplateResult> {
  const admin = await assertAdmin();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: [{ path: "", message: "invalid input" }] };
  const d = parsed.data;
  const result = validateStructure(d.definition);
  if (!result.def) return { ok: false, issues: result.issues };
  const saved = await saveTemplate({ id: d.templateId, name: d.name, description: d.description || null, icon: d.icon, definition: result.def }, admin.id, d.changeNote);
  if ("error" in saved) return { ok: false, issues: [{ path: "", message: saved.error === "system" ? "system templates are managed by the application" : "template not found" }] };
  revalidatePath("/admin/templates");
  revalidatePath("/admin/knowledge");
  revalidatePath("/knowledge", "layout");
  return { ok: true, templateId: saved.id, version: saved.version, warnings: result.warnings };
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
